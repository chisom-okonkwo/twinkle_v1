-- One operational capture record per source file; all final notes remain in notes.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table public.note_captures (
  id uuid primary key,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  kind text not null check (kind in ('image','audio')),
  mime_type text not null check (mime_type in ('image/jpeg','audio/mp4','audio/webm')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  storage_path text not null unique,
  status text not null default 'pending' check (status in ('pending','processing','failed','ready','saved','deleting')),
  result jsonb,
  attempts integer not null default 0,
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  check ((kind='image' and mime_type='image/jpeg') or (kind='audio' and mime_type in ('audio/mp4','audio/webm')))
);
create index note_captures_owner_idx on public.note_captures(user_id, created_at desc);
create index note_captures_expiry_idx on public.note_captures(expires_at) where status <> 'saved';
alter table public.note_captures enable row level security;
revoke all on public.note_captures from public, anon, authenticated;
grant select on public.note_captures to authenticated;
grant insert (id,kind,mime_type,byte_size,storage_path) on public.note_captures to authenticated;
grant all on public.note_captures to service_role;
create policy "Owners read captures" on public.note_captures for select to authenticated using ((select auth.uid())=user_id);
create policy "Owners stage captures" on public.note_captures for insert to authenticated with check (
  (select auth.uid())=user_id and status='pending' and
  storage_path=user_id::text || '/' || id::text || '/source.' || case mime_type when 'image/jpeg' then 'jpg' when 'audio/mp4' then 'm4a' else 'webm' end
);

alter table public.notes add column source_capture_id uuid unique references public.note_captures(id);
alter table public.notes add constraint notes_capture_source_check check (
  (capture_method='text' and source_capture_id is null) or
  (capture_method in ('image','audio') and source_capture_id is not null)
);
grant insert (id,capture_method,source_capture_id) on public.notes to authenticated;

-- A private definer trigger is required to lock and transition the capture atomically
-- with note insertion. It explicitly checks auth.uid(); clients cannot execute it.
create function private.attach_note_capture() returns trigger language plpgsql security definer set search_path='' as $$
declare capture public.note_captures;
begin
  if new.source_capture_id is null then return new; end if;
  if auth.uid() is null or auth.uid() <> new.user_id then raise exception 'Capture owner mismatch'; end if;
  select * into capture from public.note_captures where id=new.source_capture_id for update;
  if capture.id is null or capture.user_id is distinct from new.user_id or capture.kind <> new.capture_method or capture.status <> 'ready' or capture.expires_at < now() then
    raise exception 'Capture is unavailable or not ready';
  end if;
  if not exists (select 1 from storage.objects where bucket_id='note-media' and name=capture.storage_path) then
    raise exception 'Source media is missing';
  end if;
  update public.note_captures set status='saved', result=null where id=capture.id;
  return new;
end $$;
revoke all on function private.attach_note_capture() from public,anon,authenticated;
create trigger notes_attach_capture before insert on public.notes for each row execute function private.attach_note_capture();

create function private.release_note_capture() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.note_captures set status='pending',expires_at=now() where id=old.source_capture_id;
  return old;
end $$;
revoke all on function private.release_note_capture() from public,anon,authenticated;
create trigger notes_release_capture after delete on public.notes for each row execute function private.release_note_capture();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('note-media','note-media',false,5242880,array['image/jpeg','audio/mp4','audio/webm']);
create policy "Owners upload staged media" on storage.objects for insert to authenticated with check (
  bucket_id='note-media' and exists (select 1 from public.note_captures c where c.storage_path=name and c.user_id=(select auth.uid()) and c.status='pending' and c.expires_at>now())
);
create policy "Owners read media" on storage.objects for select to authenticated using (
  bucket_id='note-media' and exists (select 1 from public.note_captures c where c.storage_path=name and c.user_id=(select auth.uid()) and c.status<>'deleting')
);
-- No client UPDATE/DELETE policies: the source is immutable, and saved originals
-- cannot be removed behind the note. The Edge Function handles explicit discard.

create table private.capture_budget(user_id uuid primary key, window_start timestamptz not null, attempts integer not null);
alter table private.capture_budget enable row level security;
revoke all on private.capture_budget from public,anon,authenticated;
grant all on private.capture_budget to service_role;
create function public.claim_note_capture(capture_id uuid,caller_id uuid) returns public.note_captures
language plpgsql security invoker set search_path='' as $$
declare capture public.note_captures; used integer;
begin
  select * into capture from public.note_captures where id=capture_id and user_id=caller_id for update;
  if capture.id is null then raise exception 'CAPTURE_NOT_FOUND'; end if;
  if capture.status in ('ready','saved') then return capture; end if;
  if capture.expires_at<now() or capture.status='deleting' then raise exception 'CAPTURE_EXPIRED'; end if;
  if capture.status='processing' and capture.processing_started_at>now()-interval '2 minutes' then raise exception 'CAPTURE_BUSY'; end if;
  if capture.attempts>=3 then raise exception 'CAPTURE_ATTEMPTS'; end if;
  insert into private.capture_budget as b values(caller_id,date_trunc('hour',now()),1)
    on conflict(user_id) do update set window_start=excluded.window_start,
    attempts=case when b.window_start=excluded.window_start then b.attempts+1 else 1 end returning attempts into used;
  if used>20 then raise exception 'CAPTURE_RATE_LIMIT'; end if;
  update public.note_captures set status='processing',attempts=attempts+1,processing_started_at=now() where id=capture_id returning * into capture;
  return capture;
end $$;
revoke all on function public.claim_note_capture(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_note_capture(uuid,uuid) to service_role;

create function public.claim_capture_deletion(capture_id uuid,caller_id uuid default null) returns public.note_captures
language plpgsql security invoker set search_path='' as $$
declare capture public.note_captures;
begin
  select * into capture from public.note_captures where id=capture_id for update;
  if capture.id is null then return null; end if;
  if caller_id is not null and capture.user_id is distinct from caller_id then raise exception 'CAPTURE_NOT_FOUND'; end if;
  if capture.status='saved' then raise exception 'CAPTURE_SAVED'; end if;
  if caller_id is null and capture.expires_at>now() and capture.user_id is not null then raise exception 'CAPTURE_NOT_EXPIRED'; end if;
  if capture.status='processing' and capture.processing_started_at>now()-interval '2 minutes' then raise exception 'CAPTURE_BUSY'; end if;
  update public.note_captures set status='deleting' where id=capture_id returning * into capture;
  return capture;
end $$;
revoke all on function public.claim_capture_deletion(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_capture_deletion(uuid,uuid) to service_role;

-- Cleanup uses a generated internal token, never a user or OpenAI credential.
create table private.capture_settings(id boolean primary key default true check(id),cleanup_token text not null, function_url text not null);
alter table private.capture_settings enable row level security;
revoke all on private.capture_settings from public,anon,authenticated;
grant select on private.capture_settings to service_role;
insert into private.capture_settings values(true,encode(extensions.gen_random_bytes(32),'hex'),'https://lvrmixdkkdrtssdtggnw.supabase.co/functions/v1/capture');
create function public.authorize_capture_cleanup(token text) returns boolean language sql security invoker set search_path='' as $$
  select exists(select 1 from private.capture_settings where cleanup_token=token);
$$;
revoke all on function public.authorize_capture_cleanup(text) from public,anon,authenticated;
grant execute on function public.authorize_capture_cleanup(text) to service_role;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.schedule('twinkle-capture-cleanup','17 * * * *',$job$
  select net.http_post(url:=function_url,headers:=jsonb_build_object('Content-Type','application/json','x-capture-cleanup-token',cleanup_token),body:='{"action":"cleanup"}'::jsonb,timeout_milliseconds:=60000) from private.capture_settings;
  delete from private.capture_budget where window_start<now()-interval '2 days';
$job$);
