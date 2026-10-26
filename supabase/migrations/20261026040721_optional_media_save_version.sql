-- Omitted versions represent new notes; existing notes still require their saved version.
create or replace function private.save_note_with_attachments(target_id uuid,body text,expected_updated_at timestamptz default null,capture_ids uuid[] default '{}')
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

create or replace function public.save_note_with_attachments(target_id uuid,body text,expected_updated_at timestamptz default null,capture_ids uuid[] default '{}')
returns setof public.notes language sql security invoker set search_path='' as $$
 select * from private.save_note_with_attachments(target_id,body,expected_updated_at,capture_ids)
$$;
