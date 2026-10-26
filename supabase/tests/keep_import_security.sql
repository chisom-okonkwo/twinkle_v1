-- Synthetic fixtures only. Never import personal Keep samples in automated tests.
begin;
select set_config('test.keep_owner',gen_random_uuid()::text,true);
select set_config('test.keep_other',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.keep_owner')::uuid),(current_setting('test.keep_other')::uuid);
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.keep_owner'),'role','authenticated')::text,true);
insert into public.context_preferences(user_id,enabled) values(current_setting('test.keep_owner')::uuid,true);
select set_config('test.keep_import',public.import_text_note('Reflection.json',E'  Quieter creative work.\n- [ ] Draft proposal\n- [x] Read chapter\n','{"provider":"google_keep","title":"Synthetic Keep reflection","created_at":"2020-01-01T12:00:00.123Z","original_updated_at":"2020-01-02T12:00:00.654Z"}')::text,true);
do $$
declare n public.notes; replay jsonb; before_count int; result jsonb;
begin
 select * into n from public.notes where id=(current_setting('test.keep_import')::jsonb->>'id')::uuid;
 if n.content<>E'  Quieter creative work.\n- [ ] Draft proposal\n- [x] Read chapter\n' or n.capture_method<>'text' then raise exception 'Keep text or checklist changed'; end if;
 if n.created_at<>'2020-01-01T12:00:00.123Z' or n.updated_at<now()-interval '1 minute' then raise exception 'Historical and import dates conflated'; end if;
 if n.import_metadata->>'filename'<>'Reflection.json' or n.import_metadata->>'provider'<>'google_keep' or n.import_metadata->>'title'<>'Synthetic Keep reflection' or n.import_metadata->>'original_updated_at'<>'2020-01-02T12:00:00.654Z' then raise exception 'Keep provenance lost'; end if;
 if (select status from public.note_contexts where note_id=n.id)<>'disabled' then raise exception 'Import started bulk AI'; end if;
 if not exists(select 1 from public.search_notes('"Synthetic Keep reflection"') where id=n.id) or not exists(select 1 from public.search_notes('proposal') where id=n.id) then raise exception 'Keep title or checklist not searchable'; end if;
 replay=public.import_text_note('Reflection.html',n.content,'{"provider":"google_keep","title":"Synthetic Keep reflection"}');
 if replay->>'status'<>'skipped' or replay->>'id'<>n.id::text then raise exception 'Cross-format repeat duplicated note'; end if;
 begin update public.notes set import_metadata='{}' where id=n.id; raise exception 'Client changed provenance'; exception when insufficient_privilege then null; end;
 select count(*) into before_count from public.notes;
 for item in 1..20 loop
  result=public.import_text_note('Thought '||item||'.json','Synthetic selected thought '||item,jsonb_build_object('provider','google_keep','title','Selected Keep thought '||item));
  if result->>'status'<>'imported' then raise exception 'Batch note missing'; end if;
  if public.import_text_note('Thought '||item||'.html','Synthetic selected thought '||item,'{"provider":"google_keep"}')->>'status'<>'skipped' then raise exception 'Batch retry duplicated'; end if;
 end loop;
 if (select count(*) from public.notes)<>before_count+20 then raise exception 'Batch count incorrect'; end if;
 begin perform public.import_text_note('a.json','Invalid provider'); raise exception 'Missing Keep provider accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.import_text_note('a.html','Invalid','{"provider":"another_app"}'); raise exception 'Unknown provider accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.import_text_note('a.json','Invalid','{"provider":"google_keep","original_updated_at":"tomorrow"}'); raise exception 'Ambiguous date accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.import_text_note('a.json','Invalid','{"provider":"google_keep","original_updated_at":"2099-01-01T12:00:00Z"}'); raise exception 'Future modification accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.import_text_note('a.json','Invalid','{"provider":"google_keep","created_at":"2020-01-02T12:00:00Z","original_updated_at":"2020-01-01T12:00:00Z"}'); raise exception 'Reversed dates accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.import_text_note('a.json','Invalid','{"provider":"google_keep","user_id":"forged"}'); raise exception 'Unvalidated metadata accepted'; exception when invalid_parameter_value then null; end;
 if (select count(*) from public.notes)<>before_count+20 then raise exception 'Rejected file corrupted batch'; end if;
 update public.notes set content='Edited in Twinkle: keep these local changes.' where id=n.id;
 if public.import_text_note('Renamed.json',n.content,'{"provider":"google_keep"}')->>'status'<>'skipped' then raise exception 'Repeat after edit duplicated'; end if;
 if (select content from public.notes where id=n.id)<>'Edited in Twinkle: keep these local changes.' or (select import_metadata->>'original_updated_at' from public.notes where id=n.id)<>'2020-01-02T12:00:00.654Z' then raise exception 'Replay overwrote edited words or original dates'; end if;
end $$;
select set_config('test.keep_html',public.import_text_note('Undated.html','HTML-only original words.','{"provider":"google_keep","title":"Undated HTML"}')::text,true);
do $$ declare n public.notes; begin
 select * into n from public.notes where id=(current_setting('test.keep_html')::jsonb->>'id')::uuid;
 if n.created_at<>n.updated_at or n.import_metadata->>'date_basis'<>'import' or n.import_metadata->>'original_created_at' is not null then raise exception 'HTML date fabricated'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.keep_other'),'role','authenticated')::text,true);
do $$ begin
 if exists(select 1 from public.notes where id=(current_setting('test.keep_import')::jsonb->>'id')::uuid) or exists(select 1 from public.search_notes('Synthetic Keep reflection')) then raise exception 'Keep import leaked across users'; end if;
 if public.import_text_note('Other.json',E'  Quieter creative work.\n- [ ] Draft proposal\n- [x] Read chapter\n','{"provider":"google_keep"}')->>'status'<>'imported' then raise exception 'Duplicate check leaked another user'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.keep_owner'),'role','authenticated')::text,true);
delete from public.notes where id=(current_setting('test.keep_import')::jsonb->>'id')::uuid;
do $$ begin
 if exists(select 1 from public.search_notes('Synthetic Keep reflection')) then raise exception 'Deleted Keep note still searchable'; end if;
end $$;
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ begin
 begin perform public.import_text_note('a.json','Unauthorized','{"provider":"google_keep"}'); raise exception 'Anonymous imported'; exception when insufficient_privilege then null; end;
end $$;
set constraints all immediate;
rollback;
