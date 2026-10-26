-- Disposable fixtures, including Auth users, always roll back.
begin;
select set_config('test.owner_a',gen_random_uuid()::text,true);
select set_config('test.owner_b',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.owner_a')::uuid),(current_setting('test.owner_b')::uuid);
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_a'),'role','authenticated')::text,true);
insert into public.context_preferences(user_id,enabled) values(current_setting('test.owner_a')::uuid,true);
select set_config('test.import',public.import_text_note('a.md',E'  # Historical reflection\r\nWatercolour creativity comes from practicing every day. 🌻\n','{"title":"Creative practice journal","created_at":"2020-02-29","source_type":"book","source_name":"Practice book","source_url":"https://example.com/book","source_context":"Chapter two"}')::text,true);
do $$
declare result jsonb=current_setting('test.import')::jsonb; n public.notes;
begin
 if result->>'status'<>'imported' then raise exception 'Import failed'; end if;
 select * into n from public.notes where id=(result->>'id')::uuid;
 if n.content<>E'  # Historical reflection\r\nWatercolour creativity comes from practicing every day. 🌻\n' then raise exception 'Original changed'; end if;
 if n.created_at<>'2020-02-29T00:00:00Z' or n.updated_at<now()-interval '1 minute' or n.capture_method<>'text' then raise exception 'Wrong dates or capture method'; end if;
 if n.import_metadata->>'date_basis'<>'file' then raise exception 'Historical date not distinguished'; end if;
 if (select status from public.note_contexts where note_id=n.id)<>'disabled' then raise exception 'Bulk import queued AI'; end if;
 if (select name from public.note_sources where note_id=n.id)<>'Practice book' then raise exception 'Source lost'; end if;
 if not exists(select 1 from public.search_notes('"Creative practice journal"') where id=n.id) then raise exception 'Imported title phrase not searchable'; end if;
 if not exists(select 1 from public.search_notes('watercolour') where id=n.id) then raise exception 'Content not searchable'; end if;
 if not exists(select 1 from public.search_notes('"Practice book"') where id=n.id) then raise exception 'Source not searchable'; end if;
 if public.import_text_note('renamed.txt',n.content)->>'status'<>'skipped' then raise exception 'Exact duplicate not skipped'; end if;
 begin update public.notes set import_metadata='{}' where id=n.id; raise exception 'Provenance editable by client'; exception when insufficient_privilege then null; end;
 begin insert into public.notes(user_id,content,import_metadata) values(current_setting('test.owner_b')::uuid,'forged','{}'); raise exception 'Forged import inserted'; exception when insufficient_privilege then null; end;
end $$;
-- Existing typed notes are also considered, but similar topics are not duplicates.
insert into public.notes(content) values('Existing exact original');
do $$ begin
 if public.import_text_note('existing.txt','Existing exact original')->>'status'<>'skipped' then raise exception 'Existing note duplicate'; end if;
 if public.import_text_note('similar.txt','Creativity also comes from a different routine.')->>'status'<>'imported' then raise exception 'Similar topic incorrectly skipped'; end if;
end $$;
update public.notes set content='Edited historical reflection about painting.' where id=((current_setting('test.import')::jsonb)->>'id')::uuid;
do $$
declare result jsonb;
begin
 result=public.import_text_note('again.md',E'  # Historical reflection\r\nWatercolour creativity comes from practicing every day. 🌻\n');
 if result->>'status'<>'skipped' or result->>'id'<>current_setting('test.import')::jsonb->>'id' then raise exception 'Retry after edit duplicated original'; end if;
 if not exists(select 1 from public.search_notes('painting') where id=(result->>'id')::uuid) then raise exception 'Edited note not searchable'; end if;
 if exists(select 1 from public.search_notes('watercolour') where id=(result->>'id')::uuid) then raise exception 'Stale content in search'; end if;
 if (select status from public.note_contexts where note_id=(result->>'id')::uuid)<>'pending' then raise exception 'Ordinary edit no longer enrichable'; end if;
 if (select name from public.note_sources where note_id=(result->>'id')::uuid)<>'Practice book' then raise exception 'Edit overwrote source'; end if;
end $$;
select set_config('test.unknown',public.import_text_note('undated.txt','Unknown creation date, retain the import time.')::text,true);
do $$ declare n public.notes; begin
 select * into n from public.notes where id=(current_setting('test.unknown')::jsonb->>'id')::uuid;
 if n.created_at<>n.updated_at or n.import_metadata->>'date_basis'<>'import' or n.import_metadata->>'original_created_at' is not null then raise exception 'Unknown date fabricated'; end if;
 begin perform public.import_text_note('a.md','not empty','{"created_at":"2099-01-01"}'); raise exception 'Future metadata accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.import_text_note('a.pdf','unsupported'); raise exception 'Unsupported accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.import_text_note('a.md',repeat('a',100001)); raise exception 'Too long accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.import_text_note('a.md',repeat('🌻',70000)); raise exception 'Byte limit ignored'; exception when invalid_parameter_value then null; end;
 begin perform public.import_text_note('a.md','unsafe','{"source_type":"article","source_url":"javascript:alert(1)"}'); raise exception 'Unsafe URL accepted'; exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_b'),'role','authenticated')::text,true);
do $$ begin
 if exists(select 1 from public.notes where id=(current_setting('test.import')::jsonb->>'id')::uuid) or exists(select 1 from public.search_notes('Creative practice journal')) then raise exception 'Cross-user leak'; end if;
 update public.notes set content='Intruder' where id=(current_setting('test.import')::jsonb->>'id')::uuid;
 if found then raise exception 'Foreign note editable'; end if;
 if public.import_text_note('other.txt','Existing exact original')->>'status'<>'imported' then raise exception 'Duplicate detection leaked another owner'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_a'),'role','authenticated')::text,true);
delete from public.notes where id=(current_setting('test.import')::jsonb->>'id')::uuid;
do $$ begin
 if exists(select 1 from public.search_notes('Creative practice journal')) or exists(select 1 from public.note_contexts where note_id=(current_setting('test.import')::jsonb->>'id')::uuid) then raise exception 'Deleted import remains'; end if;
end $$;
-- On-demand analysis uses the existing consent-checked service path only.
set local role service_role;
do $$ begin
 if public.claim_note_context((current_setting('test.unknown')::jsonb->>'id')::uuid,current_setting('test.owner_a')::uuid,false)->>'status'<>'disabled' then raise exception 'Automatic imported analysis started'; end if;
 if public.claim_note_context((current_setting('test.unknown')::jsonb->>'id')::uuid,current_setting('test.owner_a')::uuid,true)->>'status'<>'claimed' then raise exception 'Manual imported analysis unavailable'; end if;
 if public.claim_related_notes((current_setting('test.unknown')::jsonb->>'id')::uuid,current_setting('test.owner_a')::uuid)->>'status'<>'waiting_context' then raise exception 'Related pipeline incompatible'; end if;
end $$;
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ begin
 begin perform public.import_text_note('a.md','Unauthorized'); raise exception 'Anonymous imported'; exception when insufficient_privilege then null; end;
end $$;
rollback;
