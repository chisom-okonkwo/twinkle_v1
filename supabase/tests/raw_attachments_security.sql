begin;
select set_config('test.owner',gen_random_uuid()::text,true),set_config('test.photo',gen_random_uuid()::text,true),set_config('test.audio',gen_random_uuid()::text,true),set_config('test.note',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.owner')::uuid);
insert into public.note_captures(id,user_id,kind,mime_type,byte_size,storage_path,verified_at)
 select id,current_setting('test.owner')::uuid,kind,mime,100,current_setting('test.owner')||'/'||id||'/source.'||ext,now() from (values(current_setting('test.photo')::uuid,'image','image/jpeg','jpg'),(current_setting('test.audio')::uuid,'audio','audio/mp4','m4a')) v(id,kind,mime,ext);
insert into storage.objects(bucket_id,name,metadata) select 'note-media',storage_path,'{"size":100}' from public.note_captures where id in(current_setting('test.photo')::uuid,current_setting('test.audio')::uuid);
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner'),'role','authenticated')::text,true);
insert into public.context_preferences(user_id,enabled) values(current_setting('test.owner')::uuid,true);
select set_config('test.saved',(select to_jsonb(n)::text from public.save_note_with_attachments(current_setting('test.note')::uuid,'',null,array[current_setting('test.photo')::uuid,current_setting('test.audio')::uuid],current_setting('test.photo')::uuid) n),true);
set constraints all immediate;
do $$ declare n public.notes; begin
 select * into n from public.notes where id=current_setting('test.note')::uuid;
 if n.content<>'' or n.capture_method<>'image' or n.source_capture_id<>current_setting('test.photo')::uuid or not n.has_attachments then raise exception 'Media-only note did not preserve origin or empty text'; end if;
 if (select count(*) from public.list_note_attachments(n.id))<>2 then raise exception 'Raw mixed attachments not linked'; end if;
 if exists(select 1 from public.note_captures where id in(current_setting('test.photo')::uuid,current_setting('test.audio')::uuid) and(status<>'saved' or attempts<>0 or result is not null)) then raise exception 'Raw attachment incorrectly processed'; end if;
 if not exists(select 1 from public.search_notes('"Photo note"') where id=n.id) then raise exception 'Media-only title not searchable'; end if;
 if (select status from public.note_contexts where note_id=n.id)<>'disabled' then raise exception 'Empty note queued AI'; end if;
 begin update public.notes set has_attachments=false where id=n.id; raise exception 'Client changed media flag'; exception when insufficient_privilege then null; end;
 begin update public.note_captures set verified_at=null where id=current_setting('test.photo')::uuid; raise exception 'Client changed verification'; exception when insufficient_privilege then null; end;
 begin perform * from public.save_note_with_attachments(n.id,'',n.updated_at,'{}'); raise exception 'Empty orphan saved'; exception when invalid_parameter_value then null; end;
end $$;
set local role service_role;
do $$ begin
 if public.claim_note_context(current_setting('test.note')::uuid,current_setting('test.owner')::uuid,true)->>'status'<>'disabled' then raise exception 'Manual empty AI allowed'; end if;
 if exists(select 1 from private.capture_budget where user_id=current_setting('test.owner')::uuid) or exists(select 1 from private.context_budget where user_id=current_setting('test.owner')::uuid) then raise exception 'Attaching consumed an AI budget'; end if;
end $$;
set local role authenticated;
select * from public.save_note_with_attachments(current_setting('test.note')::uuid,'A caption about creative practice.',(current_setting('test.saved')::jsonb->>'updated_at')::timestamptz,array[current_setting('test.photo')::uuid,current_setting('test.audio')::uuid]);
do $$ begin
 if (select status from public.note_contexts where note_id=current_setting('test.note')::uuid)<>'pending' then raise exception 'Caption did not restore ordinary enrichment'; end if;
 if not exists(select 1 from public.search_notes('creative practice') where id=current_setting('test.note')::uuid) then raise exception 'Caption not searchable'; end if;
end $$;
set local role postgres;
-- Account deletion must release all files even when capture ownership becomes null.
select set_config('request.jwt.claims','{}',true);
delete from auth.users where id=current_setting('test.owner')::uuid;
do $$ begin
 if exists(select 1 from public.note_attachments where note_id=current_setting('test.note')::uuid) or exists(select 1 from public.notes where id=current_setting('test.note')::uuid) then raise exception 'Account cascade failed'; end if;
 if exists(select 1 from public.note_captures where id in(current_setting('test.photo')::uuid,current_setting('test.audio')::uuid) and status='saved') then raise exception 'Account deletion retained orphan saved media'; end if;
end $$;
set constraints all immediate;
rollback;
