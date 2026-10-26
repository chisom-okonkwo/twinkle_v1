-- Attaching originals never requires AI extraction. Verification is server-only.
alter table public.note_captures add column verified_at timestamptz;
update public.note_captures set verified_at=created_at where status in ('ready','saved');
alter table public.notes add column has_attachments boolean not null default false;
-- Keep existing notes' modification times unchanged during this metadata backfill.
alter table public.notes disable trigger notes_updated_at;
update public.notes n set has_attachments=true where exists(select 1 from public.note_attachments a where a.note_id=n.id);
alter table public.notes enable trigger notes_updated_at;
alter table public.notes drop constraint notes_content_check;
alter table public.notes add constraint notes_content_check check(char_length(btrim(content,E' \t\n\r'))<=100000 and (char_length(btrim(content,E' \t\n\r'))>0 or has_attachments));

create or replace function private.attach_note_capture() returns trigger language plpgsql security definer set search_path='' as $$
declare capture public.note_captures;
begin
 if new.source_capture_id is null then return new; end if;
 if auth.uid() is null or auth.uid()<>new.user_id then raise exception 'Capture owner mismatch'; end if;
 select * into capture from public.note_captures where id=new.source_capture_id for update;
 if capture.id is null or capture.user_id is distinct from new.user_id or capture.kind<>new.capture_method or not(capture.status='ready' or (capture.status in ('pending','failed') and capture.verified_at is not null)) or capture.expires_at<now() then raise exception 'Capture is unavailable or not ready'; end if;
 if not exists(select 1 from storage.objects where bucket_id='note-media' and name=capture.storage_path) then raise exception 'Source media is missing'; end if;
 new.has_attachments=true;
 update public.note_captures set status='saved',result=null where id=capture.id;
 return new;
end $$;

-- Replace the earlier signature; existing callers may omit the new optional argument.
drop function public.save_note_with_attachments(uuid,text,timestamptz,uuid[]);
drop function private.save_note_with_attachments(uuid,text,timestamptz,uuid[]);
create or replace function private.save_note_with_attachments(target_id uuid,body text,expected_updated_at timestamptz default null,capture_ids uuid[] default '{}',initial_capture_id uuid default null)
returns public.notes language plpgsql security definer set search_path='' as $$
declare owner_id uuid=auth.uid(); n public.notes; selected_ids uuid[]; current_ids uuid[]; c public.note_captures; initial_kind text;
begin
 if owner_id is null then raise insufficient_privilege using message='Sign in to save your note.'; end if;
 if target_id is null or body is null or (btrim(body,E' \t\r\n')='' and cardinality(capture_ids)=0) or char_length(body)>100000 or capture_ids is null or cardinality(capture_ids)>10 or array_position(capture_ids,null) is not null then raise invalid_parameter_value using message='Add text or an attachment, with up to 10 photos or recordings.'; end if;
 select coalesce(array_agg(distinct x order by x),'{}') into selected_ids from unnest(capture_ids) x;
 if cardinality(selected_ids)<>cardinality(capture_ids) then raise invalid_parameter_value using message='A source can be attached only once.'; end if;
 select * into n from public.notes where id=target_id and user_id=owner_id for update;
 if found then
  select coalesce(array_agg(a.capture_id order by a.capture_id),'{}') into current_ids from public.note_attachments a where a.note_id=n.id and a.user_id=owner_id;
  if n.content=body and selected_ids=current_ids then return n; end if;
  if expected_updated_at is null or n.updated_at<>expected_updated_at then raise exception 'NOTE_CONFLICT'; end if;
  -- Take normal update/derived-data locks before locking any new captures.
  update public.notes set content=body,has_attachments=cardinality(selected_ids)>0,
   source_capture_id=case when source_capture_id=any(selected_ids) then source_capture_id else null end,
   capture_method=case when source_capture_id is not null and not(source_capture_id=any(selected_ids)) then 'text' else capture_method end
   where id=n.id and user_id=owner_id returning * into n;
 else
  if expected_updated_at is not null or exists(select 1 from public.notes where id=target_id) then raise exception 'NOTE_CONFLICT'; end if;
  if initial_capture_id is not null then
   if not(initial_capture_id=any(selected_ids)) then raise invalid_parameter_value using message='The original source must belong to this note.'; end if;
   select kind into initial_kind from public.note_captures where id=initial_capture_id and user_id=owner_id;
   if initial_kind is null then raise insufficient_privilege using message='Source unavailable.'; end if;
  end if;
  insert into public.notes(id,user_id,content,has_attachments,capture_method,source_capture_id)
   values(target_id,owner_id,body,cardinality(selected_ids)>0,coalesce(initial_kind,'text'),initial_capture_id) returning * into n;
 end if;
 -- Locks and the unique capture key prevent concurrent reuse in another note.
 for c in select * from public.note_captures where id=any(selected_ids) order by id for update loop
  if c.user_id is distinct from owner_id then raise insufficient_privilege using message='Source unavailable.'; end if;
  if exists(select 1 from public.note_attachments a where a.capture_id=c.id and a.note_id=n.id and a.user_id=owner_id) then
   if c.status<>'saved' then raise exception 'Source unavailable.'; end if;
  elsif not(c.status='ready' or (c.status in ('pending','failed') and c.verified_at is not null)) or c.expires_at<now() or not exists(select 1 from storage.objects where bucket_id='note-media' and name=c.storage_path) then raise exception 'Process and review this source before attaching it.';
  end if;
 end loop;
 if (select count(*) from public.note_captures where id=any(selected_ids) and user_id=owner_id)<>cardinality(selected_ids) then raise insufficient_privilege using message='Source unavailable.'; end if;
 delete from public.note_attachments where note_id=n.id and user_id=owner_id and not(capture_id=any(selected_ids));
 insert into public.note_attachments(note_id,capture_id,user_id)
  select n.id,x,owner_id from unnest(selected_ids) x on conflict(capture_id) do nothing;
 if (select count(*) from public.note_attachments where note_id=n.id and user_id=owner_id)<>cardinality(selected_ids) then raise exception 'This source is already attached to a different note.'; end if;
 update public.note_captures set status='saved',result=null where id=any(selected_ids) and user_id=owner_id;
 return n;
end $$;

create or replace function public.save_note_with_attachments(target_id uuid,body text,expected_updated_at timestamptz default null,capture_ids uuid[] default '{}',initial_capture_id uuid default null)
returns setof public.notes language sql security invoker set search_path='' as $$
 select * from private.save_note_with_attachments(target_id,body,expected_updated_at,capture_ids,initial_capture_id)
$$;


revoke all on function private.save_note_with_attachments(uuid,text,timestamptz,uuid[],uuid) from public,anon,authenticated;
grant execute on function private.save_note_with_attachments(uuid,text,timestamptz,uuid[],uuid) to authenticated;
revoke all on function public.save_note_with_attachments(uuid,text,timestamptz,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.save_note_with_attachments(uuid,text,timestamptz,uuid[],uuid) to authenticated;

-- Prevent empty orphan notes even if a privileged implementation regresses.
create function private.check_attachment_flag() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid; flag boolean;
begin
 if tg_table_name='notes' then target=new.id;
 elsif tg_op='DELETE' then target=old.note_id;
 else target=new.note_id; end if;
 select has_attachments into flag from public.notes where id=target;
 if found and flag is distinct from exists(select 1 from public.note_attachments where note_id=target) then raise check_violation using message='A note must retain its saved attachments or some text.'; end if;
 return null;
end $$;
revoke all on function private.check_attachment_flag() from public,anon,authenticated;
create constraint trigger notes_attachment_flag after insert or update on public.notes deferrable initially deferred for each row execute function private.check_attachment_flag();
create constraint trigger attachments_note_flag after insert or delete on public.note_attachments deferrable initially deferred for each row execute function private.check_attachment_flag();

-- Media-only notes have no text to enrich; don't create empty AI work.
CREATE OR REPLACE FUNCTION private.sync_note_context()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare fingerprint text; enabled boolean;
begin
  if auth.uid() is not null and auth.uid()<>new.user_id then raise exception 'Context owner mismatch'; end if;
  fingerprint=private.note_context_hash(new.content);
  select p.enabled into enabled from public.context_preferences p where p.user_id=new.user_id for share;
  insert into public.note_contexts(note_id,user_id,source_hash,status) values(new.id,new.user_id,fingerprint,case when coalesce(enabled,false) and btrim(new.content,E' \t\r\n')<>'' then 'pending' else 'disabled' end)
  on conflict(note_id) do update set source_hash=excluded.source_hash,revision=public.note_contexts.revision+1,
    status=excluded.status,generated_context=null,processing_token=null,processing_started_at=null,attempts=0,error_code=null,prompt_revision=null
    where public.note_contexts.source_hash<>excluded.source_hash;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.claim_note_context(target_id uuid, caller_id uuid, manual boolean DEFAULT false, retry boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare context public.note_contexts; original text; used integer;
begin
  perform 1 from public.context_preferences where user_id=caller_id and enabled for share;
  if not found then raise exception 'CONTEXT_DISABLED'; end if;
  select c.* into context from public.note_contexts c where c.note_id=target_id and c.user_id=caller_id for update;
  if context.note_id is null then raise exception 'CONTEXT_NOT_FOUND'; end if;
  if context.status='completed' then return jsonb_build_object('status','completed'); end if;
  if context.status='processing' and context.processing_started_at>now()-interval '2 minutes' then return jsonb_build_object('status','processing'); end if;
  if context.status='disabled' and not manual then return jsonb_build_object('status','disabled'); end if;
  if context.status='failed' and not retry then return jsonb_build_object('status','failed'); end if;
  if context.attempts>=3 then raise exception 'CONTEXT_ATTEMPTS'; end if;
  select content into original from public.notes where id=target_id and user_id=caller_id;
  if original is null then raise exception 'CONTEXT_NOT_FOUND'; end if;
  if btrim(original,E' \t\r\n')='' then return jsonb_build_object('status','disabled'); end if;
  insert into private.context_budget as b values(caller_id,date_trunc('hour',now()),1)
  on conflict(user_id) do update set window_start=excluded.window_start,attempts=case when b.window_start=excluded.window_start then b.attempts+1 else 1 end returning attempts into used;
  if used>20 then raise exception 'CONTEXT_RATE_LIMIT'; end if;
  update public.note_contexts set status='processing',attempts=attempts+1,processing_started_at=now(),processing_token=gen_random_uuid(),error_code=null
  where note_id=target_id returning * into context;
  return jsonb_build_object('status','claimed','content',original,'source_hash',context.source_hash,'revision',context.revision,'token',context.processing_token);
end $function$
;
