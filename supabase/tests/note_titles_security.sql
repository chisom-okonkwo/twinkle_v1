begin;
select set_config('test.title_owner',gen_random_uuid()::text,true),set_config('test.title_other',gen_random_uuid()::text,true),set_config('test.title_media',gen_random_uuid()::text,true),set_config('test.title_capture',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.title_owner')::uuid),(current_setting('test.title_other')::uuid);
insert into public.note_captures(id,user_id,kind,mime_type,byte_size,storage_path,verified_at)
values(current_setting('test.title_capture')::uuid,current_setting('test.title_owner')::uuid,'image','image/jpeg',100,current_setting('test.title_owner')||'/'||current_setting('test.title_capture')||'/source.jpg',now());
insert into storage.objects(bucket_id,name,metadata) select 'note-media',storage_path,'{"size":100}' from public.note_captures where id=current_setting('test.title_capture')::uuid;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.title_owner'),'role','authenticated')::text,true);
insert into public.context_preferences(user_id,enabled) values(auth.uid(),false);
insert into public.notes(content,title) values(E'First body line stays exactly here.\n\n- [x] Keep order\n','  Separate header  ');
select set_config('test.title_note',(select id::text from public.notes limit 1),true);
do $$ begin
 if not exists(select 1 from public.notes where title='Separate header' and content=E'First body line stays exactly here.\n\n- [x] Keep order\n') then raise exception 'Title and body were combined or rewritten'; end if;
 if not exists(select 1 from public.search_notes('"Separate header"') where id=current_setting('test.title_note')::uuid) then raise exception 'Explicit title not indexed'; end if;
 begin insert into public.notes(content,title) values('A body',repeat('a',301)); raise exception 'Oversized title accepted'; exception when invalid_parameter_value then null; end;
 begin insert into public.notes(content,title) values('A body',E'Control\x01'); raise exception 'Control title accepted'; exception when invalid_parameter_value then null; end;
 begin update public.notes set import_metadata='{}'; raise exception 'Provenance became writable'; exception when insufficient_privilege then null; end;
end $$;
select set_config('test.title_context_revision',(select revision::text from public.note_contexts where note_id=current_setting('test.title_note')::uuid),true);
update public.notes set title='A changed header' where id=current_setting('test.title_note')::uuid;
do $$ begin
 if exists(select 1 from public.search_notes('"Separate header"') where id=current_setting('test.title_note')::uuid) then raise exception 'Stale title remains searchable'; end if;
 if not exists(select 1 from public.search_notes('"A changed header"') where id=current_setting('test.title_note')::uuid) then raise exception 'Renamed title missing from search'; end if;
 if (select revision::text from public.note_contexts where note_id=current_setting('test.title_note')::uuid)<>current_setting('test.title_context_revision') then raise exception 'Title rename unnecessarily reprocessed body'; end if;
end $$;
select set_config('test.title_import',public.import_text_note('Original.json',E'Imported body preserved.\n- [ ] one\n- [x] two',jsonb_build_object('title','Original Keep heading','provider','google_keep','created_at','2020-01-01'))::text,true);
do $$ begin
 if (select title from public.notes where id=(current_setting('test.title_import')::jsonb->>'id')::uuid)<>'Original Keep heading' then raise exception 'New import title not editable'; end if;
end $$;
update public.notes set title='My edited Keep heading' where id=(current_setting('test.title_import')::jsonb->>'id')::uuid;
update public.notes set title='' where id=(current_setting('test.title_import')::jsonb->>'id')::uuid;
do $$ declare n public.notes; begin
 select * into n from public.notes where id=(current_setting('test.title_import')::jsonb->>'id')::uuid;
 if n.title<>'' or n.import_metadata->>'title'<>'Original Keep heading' or n.created_at<>'2020-01-01'::timestamptz then raise exception 'Clearing changed provenance/date or restored old title'; end if;
 if exists(select 1 from public.search_notes('"Original Keep heading"') where id=n.id) then raise exception 'Cleared metadata title still indexed'; end if;
 if public.import_text_note('Original.json',n.content,jsonb_build_object('title','Original Keep heading','provider','google_keep'))->>'status'<>'skipped' then raise exception 'Retitle broke duplicate skipping'; end if;
end $$;
select * from public.save_note_with_attachments(current_setting('test.title_media')::uuid,'',null,array[current_setting('test.title_capture')::uuid],current_setting('test.title_capture')::uuid,'My saved photo');
select set_config('test.title_media_version',(select updated_at::text from public.notes where id=current_setting('test.title_media')::uuid),true);
select * from public.save_note_with_attachments(current_setting('test.title_media')::uuid,'',current_setting('test.title_media_version')::timestamptz,array[current_setting('test.title_capture')::uuid],null,'Renamed photo');
do $$ declare n public.notes; begin
 select * into n from public.notes where id=current_setting('test.title_media')::uuid;
 if n.title<>'Renamed photo' or n.content<>'' or not n.has_attachments then raise exception 'Media-only retitle lost data'; end if;
 begin perform * from public.save_note_with_attachments(n.id,'',current_setting('test.title_media_version')::timestamptz,array[current_setting('test.title_capture')::uuid],null,'Stale retitle'); raise exception 'Stale title overwrote saved value'; exception when raise_exception then if sqlerrm<>'NOTE_CONFLICT' then raise; end if; end;
 perform * from public.save_note_with_attachments(n.id,'Added caption',n.updated_at,array[current_setting('test.title_capture')::uuid]);
 if (select title from public.notes where id=n.id)<>'Renamed photo' then raise exception 'Older caller erased title'; end if;
 if (select count(*) from public.list_note_attachments(n.id))<>1 then raise exception 'Retitle lost attachment'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.title_other'),'role','authenticated')::text,true);
do $$ begin
 if exists(select 1 from public.notes) or exists(select 1 from public.search_notes('Renamed photo')) then raise exception 'Cross-owner title leak'; end if;
 update public.notes set title='Intruder' where id=current_setting('test.title_note')::uuid;
 if found then raise exception 'Foreign retitle succeeded'; end if;
 begin perform * from public.save_note_with_attachments(current_setting('test.title_note')::uuid,'Other owner overwrite',null,'{}',null,'Intruder'); raise exception 'Foreign title RPC succeeded'; exception when raise_exception then if sqlerrm<>'NOTE_CONFLICT' then raise; end if; end;
end $$;
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ begin
 begin perform title from public.notes; raise exception 'Anonymous title read'; exception when insufficient_privilege then null; end;
end $$;
set constraints all immediate;
rollback;
