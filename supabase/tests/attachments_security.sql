-- Database-owner regression suite; synthetic metadata only, all changes roll back.
begin;
select set_config('test.a',gen_random_uuid()::text,true),set_config('test.b',gen_random_uuid()::text,true),set_config('test.photo',gen_random_uuid()::text,true),set_config('test.audio',gen_random_uuid()::text,true),set_config('test.foreign',gen_random_uuid()::text,true),set_config('test.pending',gen_random_uuid()::text,true),set_config('test.new',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.a')::uuid),(current_setting('test.b')::uuid);
insert into public.note_captures(id,user_id,kind,mime_type,byte_size,storage_path,status,result)
 select id,owner,kind,mime,100,owner||'/'||id||'/source.'||ext,status,'{"text":"Synthetic reviewed words","empty":false,"warnings":[]}' from (values
 (current_setting('test.photo')::uuid,current_setting('test.a')::uuid,'image','image/jpeg','jpg','ready'),
 (current_setting('test.audio')::uuid,current_setting('test.a')::uuid,'audio','audio/mp4','m4a','ready'),
 (current_setting('test.foreign')::uuid,current_setting('test.b')::uuid,'image','image/jpeg','jpg','ready'),
 (current_setting('test.pending')::uuid,current_setting('test.a')::uuid,'image','image/jpeg','jpg','pending')) v(id,owner,kind,mime,ext,status);
insert into storage.objects(bucket_id,name,metadata) select 'note-media',storage_path,'{"size":100}' from public.note_captures where id in(current_setting('test.photo')::uuid,current_setting('test.audio')::uuid,current_setting('test.foreign')::uuid,current_setting('test.pending')::uuid);
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.a'),'role','authenticated')::text,true);
insert into public.context_preferences(user_id,enabled) values(current_setting('test.a')::uuid,true);
-- Legacy photo notes automatically gain the new attachment representation.
insert into public.notes(id,content,capture_method,source_capture_id) values(current_setting('test.photo')::uuid,E'Original words\nKeep these paragraphs.','image',current_setting('test.photo')::uuid);
select set_config('test.version',(select updated_at::text from public.notes where id=current_setting('test.photo')::uuid),true);
do $$ begin
 if (select count(*) from public.list_note_attachments(current_setting('test.photo')::uuid))<>1 then raise exception 'Legacy media missing'; end if;
 begin insert into public.note_attachments values(current_setting('test.photo')::uuid,current_setting('test.foreign')::uuid,current_setting('test.a')::uuid,now()); raise exception 'Direct client attachment write allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('test.saved',(select to_jsonb(n)::text from public.save_note_with_attachments(current_setting('test.photo')::uuid,E'Original words\nKeep these paragraphs.\n\nReviewed recording about watercolours.',current_setting('test.version')::timestamptz,array[current_setting('test.photo')::uuid,current_setting('test.audio')::uuid]) n),true);
do $$ declare n public.notes; begin
 select * into n from public.notes where id=current_setting('test.photo')::uuid;
 if n.content<>E'Original words\nKeep these paragraphs.\n\nReviewed recording about watercolours.' or n.capture_method<>'image' or n.source_capture_id<>n.id then raise exception 'Original note overwritten'; end if;
 if (select count(*) from public.list_note_attachments(n.id))<>2 then raise exception 'Mixed media not saved'; end if;
 if exists(select 1 from public.note_captures where id in(n.id,current_setting('test.audio')::uuid) and(status<>'saved' or result is not null)) then raise exception 'Capture state not committed'; end if;
 if not exists(select 1 from public.search_notes('watercolours') where id=n.id) then raise exception 'Added text not searchable'; end if;
 if (select revision from public.note_contexts where note_id=n.id)<>2 then raise exception 'Enrichment not refreshed'; end if;
 -- A response lost after commit must not duplicate or re-append text.
 perform * from public.save_note_with_attachments(n.id,n.content,current_setting('test.version')::timestamptz,array[n.id,current_setting('test.audio')::uuid]);
 if (select updated_at from public.notes where id=n.id)<>n.updated_at then raise exception 'Unchanged retry wrote again'; end if;
 begin perform * from public.save_note_with_attachments(n.id,'Stale overwrite',current_setting('test.version')::timestamptz,array[n.id]); raise exception 'Stale request accepted'; exception when raise_exception then if sqlerrm<>'NOTE_CONFLICT' then raise; end if; end;
 begin perform * from public.save_note_with_attachments(n.id,'Foreign media',n.updated_at,array[current_setting('test.foreign')::uuid]); raise exception 'Foreign attachment accepted'; exception when insufficient_privilege then null; end;
 begin perform * from public.save_note_with_attachments(n.id,'Unprocessed media',n.updated_at,array[current_setting('test.pending')::uuid]); raise exception 'Unprocessed attachment accepted'; exception when raise_exception then if sqlerrm<>'Process and review this source before attaching it.' then raise; end if; end;
 if (select content from public.notes where id=n.id)<>n.content or (select count(*) from public.list_note_attachments(n.id))<>2 then raise exception 'Failed save partially committed'; end if;
 begin perform * from public.save_note_with_attachments(current_setting('test.new')::uuid,'Reuse saved media',null,array[n.id]); raise exception 'Source reused'; exception when raise_exception then if sqlerrm<>'Process and review this source before attaching it.' then raise; end if; end;
 if exists(select 1 from public.notes where id=current_setting('test.new')::uuid) then raise exception 'Failed new save left partial note'; end if;
 begin perform * from public.save_note_with_attachments(n.id,'Too many',n.updated_at,array_fill(gen_random_uuid(),array[11])); raise exception 'Limit ignored'; exception when invalid_parameter_value then null; end;
 begin perform * from public.save_note_with_attachments(n.id,'Duplicate',n.updated_at,array[n.id,n.id]); raise exception 'Duplicate source accepted'; exception when invalid_parameter_value then null; end;
end $$;
-- Remove the legacy original, retaining the audio and all text.
select * from public.save_note_with_attachments(current_setting('test.photo')::uuid,current_setting('test.saved')::jsonb->>'content',(current_setting('test.saved')::jsonb->>'updated_at')::timestamptz,array[current_setting('test.audio')::uuid]);
do $$ begin
 if (select source_capture_id is not null or capture_method<>'text' from public.notes where id=current_setting('test.photo')::uuid) then raise exception 'Legacy pointer not detached'; end if;
 if (select status<>'pending' or expires_at>now() from public.note_captures where id=current_setting('test.photo')::uuid) then raise exception 'Removed media not queued for cleanup'; end if;
 if (select count(*) from public.list_note_attachments(current_setting('test.photo')::uuid))<>1 then raise exception 'Wrong remaining attachments'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.b'),'role','authenticated')::text,true);
do $$ begin
 if exists(select 1 from public.note_attachments where note_id=current_setting('test.photo')::uuid) or exists(select 1 from public.list_note_attachments(current_setting('test.photo')::uuid)) then raise exception 'Cross-owner attachment leak'; end if;
 if exists(select 1 from storage.objects where name like current_setting('test.a')||'/%') then raise exception 'Private media storage leak'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.a'),'role','authenticated')::text,true);
delete from public.notes where id=current_setting('test.photo')::uuid;
do $$ begin
 if exists(select 1 from public.note_attachments where note_id=current_setting('test.photo')::uuid) then raise exception 'Deleted note kept attachment links'; end if;
 if (select status<>'pending' or expires_at>now() from public.note_captures where id=current_setting('test.audio')::uuid) then raise exception 'Deleted audio not queued for cleanup'; end if;
end $$;
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ begin
 begin perform * from public.list_note_attachments(current_setting('test.photo')::uuid); raise exception 'Anonymous attachment read'; exception when insufficient_privilege then null; end;
 begin perform * from public.save_note_with_attachments(gen_random_uuid(),'Unauthorized'); raise exception 'Anonymous media save'; exception when insufficient_privilege then null; end;
end $$;
set constraints all immediate;
rollback;
