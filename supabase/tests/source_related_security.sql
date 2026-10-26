-- Database-owner test, synthetic fixtures, complete rollback. No AI or pushes.
begin;
select set_config('test.owner_a',gen_random_uuid()::text,true);
select set_config('test.owner_b',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.owner_a')::uuid),(current_setting('test.owner_b')::uuid);
select set_config('test.origin',gen_random_uuid()::text,true);
select set_config('test.target',gen_random_uuid()::text,true);
select set_config('test.foreign',gen_random_uuid()::text,true);
insert into public.notes(id,user_id,content,created_at) values
(current_setting('test.origin')::uuid,current_setting('test.owner_a')::uuid,'Creativity benefits from showing up consistently.',now()),
(current_setting('test.target')::uuid,current_setting('test.owner_a')::uuid,'Creative work grows through discipline and routine.',now()-interval '3 months'),
(current_setting('test.foreign')::uuid,current_setting('test.owner_b')::uuid,'Creative work in a private foreign collection.',now());
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_a'),'role','authenticated')::text,true);
select set_config('test.timestamp',(select updated_at::text from public.notes where id=current_setting('test.origin')::uuid),true);
update public.note_sources set source_type='book',name='The Creative Practice',url='https://example.com/essay',description='Chapter on a regular studio routine' where note_id=current_setting('test.origin')::uuid and version=1;
do $$ begin
 if not exists(select 1 from public.search_notes('Creative Practice') where id=current_setting('test.origin')::uuid and matched_context) then raise exception 'Source not searchable'; end if;
 if not exists(select 1 from public.search_notes('"The Creative Practice"')) then raise exception 'Source phrase missing'; end if;
 if exists(select 1 from public.search_notes('"Practice https"')) then raise exception 'Source phrase crossed fields'; end if;
 if (select updated_at from public.notes where id=current_setting('test.origin')::uuid)<>current_setting('test.timestamp')::timestamptz then raise exception 'Attribution changed note timestamp'; end if;
 if (select version from public.note_sources where note_id=current_setting('test.origin')::uuid)<>2 then raise exception 'No optimistic version'; end if;
 begin update public.note_sources set user_id=current_setting('test.owner_b')::uuid; raise exception 'Owner editable'; exception when insufficient_privilege then null; end;
 begin update public.note_sources set url='javascript:alert(1)' where note_id=current_setting('test.origin')::uuid; raise exception 'Dangerous URL accepted'; exception when check_violation then null; end;
 begin update public.note_sources set url='https://user:secret@example.com' where note_id=current_setting('test.origin')::uuid; raise exception 'Credentials URL accepted'; exception when check_violation then null; end;
 begin update public.note_sources set version=99; raise exception 'Version forgeable'; exception when insufficient_privilege then null; end;
 begin insert into public.note_relations(note_id,related_id,user_id,explanation,origin_quote,related_quote,score) values(current_setting('test.origin')::uuid,current_setting('test.target')::uuid,current_setting('test.owner_a')::uuid,'Forged','x','x',99); raise exception 'Client forged links'; exception when insufficient_privilege then null; end;
 begin perform public.claim_related_notes(current_setting('test.origin')::uuid,current_setting('test.owner_a')::uuid); raise exception 'Client invoked service function'; exception when insufficient_privilege then null; end;
end $$;
-- User source survives content edits and AI-derived context changes.
update public.notes set content='Creativity grows from showing up consistently.' where id=current_setting('test.origin')::uuid;
do $$ begin if (select name from public.note_sources where note_id=current_setting('test.origin')::uuid)<>'The Creative Practice' then raise exception 'Source lost on edit'; end if; end $$;
set local role service_role;
insert into public.context_preferences(user_id,enabled) values(current_setting('test.owner_a')::uuid,true);
update public.note_contexts set status='completed',generated_context='{}' where user_id=current_setting('test.owner_a')::uuid;
select set_config('test.claim',public.claim_related_notes(current_setting('test.origin')::uuid,current_setting('test.owner_a')::uuid)::text,true);
do $$ begin
 if current_setting('test.claim')::jsonb->>'status'<>'claimed' then raise exception 'No claim'; end if;
 if public.claim_related_notes(current_setting('test.origin')::uuid,current_setting('test.owner_a')::uuid)->>'status'<>'processing' then raise exception 'Duplicate claim'; end if;
 if public.finish_related_notes(current_setting('test.origin')::uuid,current_setting('test.owner_a')::uuid,gen_random_uuid(),(current_setting('test.claim')::jsonb->>'revision')::bigint,'[]','synthetic') then raise exception 'Wrong lease accepted'; end if;
 if not public.related_note_candidates(current_setting('test.origin')::uuid,current_setting('test.owner_a')::uuid,array['creative','discipline']) @> jsonb_build_array(jsonb_build_object('id',current_setting('test.target'))) then raise exception 'Old conceptual candidate missing'; end if;
 if public.related_note_candidates(current_setting('test.origin')::uuid,current_setting('test.owner_a')::uuid,array['creative']) @> jsonb_build_array(jsonb_build_object('id',current_setting('test.foreign'))) then raise exception 'Foreign candidate leaked'; end if;
end $$;
select public.finish_related_notes(current_setting('test.origin')::uuid,current_setting('test.owner_a')::uuid,(current_setting('test.claim')::jsonb->>'token')::uuid,(current_setting('test.claim')::jsonb->>'revision')::bigint,
jsonb_build_array(jsonb_build_object('id',current_setting('test.target'),'explanation','Both notes explore consistency and discipline in creative work.','origin_quote','Creativity grows from showing up consistently.','related_quote','Creative work grows through discipline and routine.','score',95)),'synthetic-test');
set local role authenticated;
do $$ begin
 if (select count(*) from public.read_related_notes(current_setting('test.origin')::uuid))<>1 then raise exception 'Related link not visible'; end if;
 if exists(select 1 from public.read_related_notes(current_setting('test.target')::uuid) where id=current_setting('test.target')::uuid) then raise exception 'Self related result'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_b'),'role','authenticated')::text,true);
do $$ begin
 if exists(select 1 from public.note_sources where note_id=current_setting('test.origin')::uuid) or exists(select 1 from public.note_relations) or exists(select 1 from public.read_related_notes(current_setting('test.origin')::uuid)) then raise exception 'Private relation/source leaked'; end if;
 update public.note_sources set name='Intruder' where note_id=current_setting('test.origin')::uuid;
 if found then raise exception 'Foreign source editable'; end if;
end $$;
set local role service_role;
do $$ begin if public.claim_related_notes(current_setting('test.origin')::uuid,current_setting('test.owner_a')::uuid)->>'status'<>'completed' then raise exception 'Cached analysis not reused'; end if; end $$;
set local role authenticated;
-- Stale in-flight work must not reappear after an edit, even with a previously valid lease.
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_a'),'role','authenticated')::text,true);
update public.notes set content='My creative experiment now concerns painting with watercolors.' where id=current_setting('test.target')::uuid;
do $$ begin if exists(select 1 from public.read_related_notes(current_setting('test.origin')::uuid)) then raise exception 'Stale relation survives edit'; end if; end $$;
set local role service_role;
do $$ begin
 if public.finish_related_notes(current_setting('test.origin')::uuid,current_setting('test.owner_a')::uuid,(current_setting('test.claim')::jsonb->>'token')::uuid,(current_setting('test.claim')::jsonb->>'revision')::bigint,'[]','synthetic') then raise exception 'Old processing response accepted'; end if;
 begin insert into public.note_relations values(current_setting('test.origin')::uuid,current_setting('test.foreign')::uuid,current_setting('test.owner_a')::uuid,'x','x','x',90); raise exception 'Cross-user FK accepted'; exception when foreign_key_violation then null; end;
end $$;
-- Failure/cooldown state is independent of original note save/read operations.
select set_config('test.failure_claim',public.claim_related_notes(current_setting('test.origin')::uuid,current_setting('test.owner_a')::uuid)::text,true);
update public.related_note_runs set status='failed' where note_id=current_setting('test.origin')::uuid;
do $$ begin if public.claim_related_notes(current_setting('test.origin')::uuid,current_setting('test.owner_a')::uuid,true)->>'status'<>'failed' then raise exception 'Retry cooldown ignored'; end if; end $$;
set local role authenticated;
update public.notes set content='The original note remains editable after an analysis failure.' where id=current_setting('test.origin')::uuid;
do $$ begin if not exists(select 1 from public.notes where id=current_setting('test.origin')::uuid and content='The original note remains editable after an analysis failure.') then raise exception 'AI failure interrupted notes'; end if; end $$;
set local role service_role;
update public.note_contexts set status='pending' where note_id=current_setting('test.origin')::uuid;
do $$ begin if public.claim_related_notes(current_setting('test.origin')::uuid,current_setting('test.owner_a')::uuid)->>'status'<>'waiting_context' then raise exception 'Did not wait for enrichment'; end if; end $$;
update public.context_preferences set enabled=false where user_id=current_setting('test.owner_a')::uuid;
do $$ begin if public.claim_related_notes(current_setting('test.origin')::uuid,current_setting('test.owner_a')::uuid)->>'status'<>'disabled' then raise exception 'AI opt-out ignored'; end if; end $$;
set local role authenticated;
update public.note_sources set source_type=null,name='',url='',description='' where note_id=current_setting('test.origin')::uuid;
do $$ begin if exists(select 1 from public.search_notes('Creative Practice')) then raise exception 'Removed source searchable'; end if; end $$;
delete from public.notes where id=current_setting('test.target')::uuid;
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ begin
 begin perform * from public.note_sources; raise exception 'Anonymous source access'; exception when insufficient_privilege then null; end;
 begin perform * from public.read_related_notes(current_setting('test.origin')::uuid); raise exception 'Anonymous relations access'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Account deletion must cascade through all new tables without resurrecting state.
delete from auth.users where id in(current_setting('test.owner_a')::uuid,current_setting('test.owner_b')::uuid);
do $$ begin if exists(select 1 from public.note_sources where user_id=current_setting('test.owner_a')::uuid) or exists(select 1 from public.note_relations where user_id=current_setting('test.owner_a')::uuid) then raise exception 'Cascade left private data'; end if; end $$;
rollback;
select 'PASS: source/search persistence, URL safety, CAS, related candidates, RLS, stale responses, consent, removal and deletion' as result;
