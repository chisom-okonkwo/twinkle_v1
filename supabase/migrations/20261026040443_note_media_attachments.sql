-- Multiple private captures share the existing unified note, never its content.
alter table public.note_captures add constraint captures_id_owner_unique unique(id,user_id);
create table public.note_attachments (
 note_id uuid not null,
 capture_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 constraint note_attachments_note_owner_fkey foreign key(note_id,user_id) references public.notes(id,user_id) on delete cascade,
 constraint note_attachments_capture_owner_fkey foreign key(capture_id,user_id) references public.note_captures(id,user_id)
);
create index note_attachments_note_owner on public.note_attachments(note_id,user_id,created_at,capture_id);
create index note_attachments_owner on public.note_attachments(user_id);
alter table public.note_attachments enable row level security;
revoke all on public.note_attachments from public,anon,authenticated;
grant select on public.note_attachments to authenticated;
grant all on public.note_attachments to service_role;
create policy attachments_owner_read on public.note_attachments for select to authenticated using(user_id=(select auth.uid()));

-- Preserve every already-saved original. Legacy clients remain compatible.
insert into public.note_attachments(note_id,capture_id,user_id,created_at)
 select id,source_capture_id,user_id,created_at from public.notes where source_capture_id is not null;
create function private.register_original_attachment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.source_capture_id is not null then
  if auth.uid() is null or auth.uid()<>new.user_id then raise insufficient_privilege; end if;
  insert into public.note_attachments(note_id,capture_id,user_id) values(new.id,new.source_capture_id,new.user_id);
 end if;
 return null;
end $$;
revoke all on function private.register_original_attachment() from public,anon,authenticated;
create trigger notes_register_original after insert on public.notes for each row execute function private.register_original_attachment();

create function private.release_attachment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.notes where source_capture_id=old.capture_id) and not exists(select 1 from public.note_attachments where capture_id=old.capture_id) then
  update public.note_captures set status='pending',expires_at=now() where id=old.capture_id;
 end if;
 return null;
end $$;
revoke all on function private.release_attachment() from public,anon,authenticated;
create trigger attachments_release after delete on public.note_attachments for each row execute function private.release_attachment();

create function public.list_note_attachments(target_id uuid)
returns table(capture_id uuid,kind text,created_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select a.capture_id,c.kind,a.created_at from public.note_attachments a join public.note_captures c on c.id=a.capture_id and c.user_id=a.user_id
 where a.note_id=target_id and a.user_id=(select auth.uid()) order by a.created_at,a.capture_id limit 10
$$;
revoke all on function public.list_note_attachments(uuid) from public,anon,authenticated;
grant execute on function public.list_note_attachments(uuid) to authenticated;

-- One transaction saves text and the complete reviewed attachment set. A lost
-- response may be retried only when the current desired state still matches.
create function private.save_note_with_attachments(target_id uuid,body text,expected_updated_at timestamptz,capture_ids uuid[])
returns public.notes language plpgsql security definer set search_path='' as $$
declare owner_id uuid=auth.uid(); n public.notes; selected_ids uuid[]; current_ids uuid[]; c public.note_captures;
begin
 if owner_id is null then raise insufficient_privilege using message='Sign in to save your note.'; end if;
 if target_id is null or body is null or btrim(body,E' \t\r\n')='' or char_length(body)>100000 or capture_ids is null or cardinality(capture_ids)>10 or array_position(capture_ids,null) is not null then raise invalid_parameter_value using message='Add some text and up to 10 photos or recordings.'; end if;
 select coalesce(array_agg(distinct x order by x),'{}') into selected_ids from unnest(capture_ids) x;
 if cardinality(selected_ids)<>cardinality(capture_ids) then raise invalid_parameter_value using message='A source can be attached only once.'; end if;
 select * into n from public.notes where id=target_id and user_id=owner_id for update;
 if found then
  select coalesce(array_agg(a.capture_id order by a.capture_id),'{}') into current_ids from public.note_attachments a where a.note_id=n.id and a.user_id=owner_id;
  if n.content=body and selected_ids=current_ids then return n; end if;
  if expected_updated_at is null or n.updated_at<>expected_updated_at then raise exception 'NOTE_CONFLICT'; end if;
  -- Take normal update/derived-data locks before locking any new captures.
  update public.notes set content=body,
   source_capture_id=case when source_capture_id=any(selected_ids) then source_capture_id else null end,
   capture_method=case when source_capture_id is not null and not(source_capture_id=any(selected_ids)) then 'text' else capture_method end
   where id=n.id and user_id=owner_id returning * into n;
 else
  if expected_updated_at is not null or exists(select 1 from public.notes where id=target_id) then raise exception 'NOTE_CONFLICT'; end if;
  insert into public.notes(id,user_id,content) values(target_id,owner_id,body) returning * into n;
 end if;
 -- Locks and the unique capture key prevent concurrent reuse in another note.
 for c in select * from public.note_captures where id=any(selected_ids) order by id for update loop
  if c.user_id is distinct from owner_id then raise insufficient_privilege using message='Source unavailable.'; end if;
  if exists(select 1 from public.note_attachments a where a.capture_id=c.id and a.note_id=n.id and a.user_id=owner_id) then
   if c.status<>'saved' then raise exception 'Source unavailable.'; end if;
  elsif c.status<>'ready' or c.expires_at<now() or not exists(select 1 from storage.objects where bucket_id='note-media' and name=c.storage_path) then raise exception 'Process and review this source before attaching it.';
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
revoke all on function private.save_note_with_attachments(uuid,text,timestamptz,uuid[]) from public,anon,authenticated;
grant execute on function private.save_note_with_attachments(uuid,text,timestamptz,uuid[]) to authenticated;
create function public.save_note_with_attachments(target_id uuid,body text,expected_updated_at timestamptz,capture_ids uuid[])
returns setof public.notes language sql security invoker set search_path='' as $$
 select * from private.save_note_with_attachments(target_id,body,expected_updated_at,capture_ids)
$$;
revoke all on function public.save_note_with_attachments(uuid,text,timestamptz,uuid[]) from public,anon,authenticated;
grant execute on function public.save_note_with_attachments(uuid,text,timestamptz,uuid[]) to authenticated;
