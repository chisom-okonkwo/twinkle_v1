-- Synthetic fixtures only, no AI calls, no scheduled or push processing. Everything rolls back.
begin;
select set_config('test.a',gen_random_uuid()::text,true),set_config('test.b',gen_random_uuid()::text,true);
select set_config('test.origin',gen_random_uuid()::text,true),set_config('test.old',gen_random_uuid()::text,true),set_config('test.second',gen_random_uuid()::text,true),set_config('test.topic',gen_random_uuid()::text,true),set_config('test.excluded',gen_random_uuid()::text,true),set_config('test.sensitive',gen_random_uuid()::text,true),set_config('test.foreign',gen_random_uuid()::text,true);
select set_config('test.session',gen_random_uuid()::text,true),set_config('test.request',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.a')::uuid),(current_setting('test.b')::uuid);
insert into public.notes(id,user_id,content,created_at,updated_at) values
(current_setting('test.old')::uuid,current_setting('test.a')::uuid,'Creativity often arrives through a regular practice rather than a sudden burst of inspiration.',now()-interval '100 days',now()-interval '100 days'),
(current_setting('test.second')::uuid,current_setting('test.a')::uuid,'I want to protect a daily block for deep work by switching off email and chat.',now()-interval '60 days',now()-interval '60 days'),
(current_setting('test.topic')::uuid,current_setting('test.a')::uuid,'A dependable writing routine helps me make room for creative ideas even on uninspired mornings.',now()-interval '30 days',now()-interval '30 days'),
(current_setting('test.excluded')::uuid,current_setting('test.a')::uuid,'Creativity benefits from a dependable daily routine and showing up to do the work.',now()-interval '80 days',now()-interval '80 days'),
(current_setting('test.sensitive')::uuid,current_setting('test.a')::uuid,'A creative routine helps me make sense of my thoughts after meeting with my therapist.',now()-interval '80 days',now()-interval '80 days'),
(current_setting('test.foreign')::uuid,current_setting('test.b')::uuid,'Creativity in a completely separate collection and a consistent routine for my artwork.',now()-interval '90 days',now()-interval '90 days'),
(current_setting('test.origin')::uuid,current_setting('test.a')::uuid,'Discipline might be the foundation of creative work, rather than waiting for inspiration.',now(),now());
update public.note_contexts c set status='completed',generated_context=jsonb_build_object('topics','[]'::jsonb,'details','[]'::jsonb,'intentions','[]'::jsonb,'concerns','[]'::jsonb,'open_questions','[]'::jsonb,'emotions','[]'::jsonb,'situation',jsonb_build_object('quote',n.content,'certainty','explicit')) from public.notes n where n.id=c.note_id and n.user_id in(current_setting('test.a')::uuid,current_setting('test.b')::uuid);
insert into public.flashback_exclusions(note_id,user_id) values(current_setting('test.excluded')::uuid,current_setting('test.a')::uuid);
update public.note_sources set source_type='book',name='The Creative Practice',description='A chapter about a daily studio routine.' where note_id=current_setting('test.topic')::uuid;
-- Sensitivity in user-added context and confirmed sources is also respected.
do $$ declare phrase text;
begin
 foreach phrase in array array['medical concern','private conversation','debt repayment','her therapist','financial question','self-harm'] loop
  update public.note_sources set source_type='other',name='Reference',description=phrase where note_id=current_setting('test.old')::uuid;
  if public.rediscovery_eligible(current_setting('test.old')::uuid,current_setting('test.a')::uuid) then raise exception 'Sensitive source missed: %',phrase; end if;
 end loop;
 foreach phrase in array array['creative practice','secretary wrote an agenda','a banknote drawing competition'] loop
  update public.note_sources set description=phrase where note_id=current_setting('test.old')::uuid;
  if not public.rediscovery_eligible(current_setting('test.old')::uuid,current_setting('test.a')::uuid) then raise exception 'Sensitivity substring false positive: %',phrase; end if;
 end loop;
 update public.note_sources set source_type=null,name='',description='' where note_id=current_setting('test.old')::uuid;
end $$;
insert into public.related_note_runs(note_id,user_id,status,library_revision,completed_at) values(current_setting('test.origin')::uuid,current_setting('test.a')::uuid,'completed',1,now());
insert into public.note_relations(note_id,related_id,user_id,explanation,origin_quote,related_quote,score)
 select current_setting('test.origin')::uuid,n.id,current_setting('test.a')::uuid,'Both notes explore routine and creative work.','Discipline might be the foundation of creative work, rather than waiting for inspiration.',n.content,95 from public.notes n where n.id in(current_setting('test.old')::uuid,current_setting('test.excluded')::uuid,current_setting('test.sensitive')::uuid);
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.a'),'role','authenticated')::text,true);
do $$ begin
 if not public.rediscovery_eligible(current_setting('test.old')::uuid,current_setting('test.a')::uuid) then raise exception 'Eligible note hidden'; end if;
 if public.rediscovery_eligible(current_setting('test.foreign')::uuid,current_setting('test.b')::uuid) then raise exception 'Owner bypass through eligibility'; end if;
 if (select count(*) from public.read_resurfaced_notes(current_setting('test.origin')::uuid))<>1 then raise exception 'Resurfacing did not exclude sensitive/excluded notes'; end if;
 if not exists(select 1 from public.search_notes('Creative Practice') where id=current_setting('test.topic')::uuid) then raise exception 'Source search reuse broken'; end if;
 begin perform public.discovery_candidates(current_setting('test.a')::uuid,current_setting('test.session')::uuid); raise exception 'Client called internal discovery'; exception when insufficient_privilege then null; end;
 begin insert into public.note_discovery_history(request_id,user_id,session_id,note_id,note_updated_at,mode) values(gen_random_uuid(),current_setting('test.a')::uuid,gen_random_uuid(),current_setting('test.old')::uuid,now(),'topic'); raise exception 'Client forged delivery history'; exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
select public.record_capture_rediscovery(current_setting('test.a')::uuid,current_setting('test.origin')::uuid,array[current_setting('test.old')::uuid]);
do $$ begin
 if (select count(*) from public.note_discovery_history where user_id=current_setting('test.a')::uuid and mode='capture')<>1 then raise exception 'Capture history not recorded'; end if;
 if not public.discovery_candidates(current_setting('test.a')::uuid,current_setting('test.session')::uuid) @> jsonb_build_array(jsonb_build_object('id',current_setting('test.old'))) then raise exception 'Recently seen fallback was unnecessarily excluded'; end if;
end $$;
set local role authenticated;
do $$ begin if (select count(*) from public.read_resurfaced_notes(current_setting('test.origin')::uuid))<>1 then raise exception 'Current capture card disappeared after recording seen'; end if; end $$;
select public.dismiss_note_connection(current_setting('test.origin')::uuid,current_setting('test.old')::uuid);
select public.dismiss_note_connection(current_setting('test.old')::uuid,current_setting('test.origin')::uuid);
do $$ begin
 if exists(select 1 from public.read_resurfaced_notes(current_setting('test.origin')::uuid)) then raise exception 'Dismissed pair resurfaced'; end if;
 if (select count(*) from public.related_note_dismissals)<>1 then raise exception 'Reversed pair duplicate'; end if;
 begin perform public.dismiss_note_connection(current_setting('test.origin')::uuid,current_setting('test.foreign')::uuid); raise exception 'Cross-user dismissal'; exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
-- Atomically reserve an available note, honoring recent history and same-session uniqueness.
select set_config('test.result',public.reserve_discovery(current_setting('test.a')::uuid,current_setting('test.session')::uuid,current_setting('test.request')::uuid,
 (select jsonb_agg(jsonb_build_object('id',n.id,'updated_at',n.updated_at,'source_hash',c.source_hash,'context_revision',c.revision,'user_version',c.user_version) order by (n.id=current_setting('test.old')::uuid),n.created_at) from public.notes n join public.note_contexts c on c.note_id=n.id where n.id in(current_setting('test.old')::uuid,current_setting('test.second')::uuid)), 'surprise')::text,true);
do $$ begin
 if current_setting('test.result')::jsonb->>'note_id'<>current_setting('test.second') then raise exception 'Wrong reserved note or cooldown ignored'; end if;
 if public.reserve_discovery(current_setting('test.a')::uuid,current_setting('test.session')::uuid,current_setting('test.request')::uuid,'[]','surprise')<>current_setting('test.result')::jsonb then raise exception 'Lost-response replay changed selection'; end if;
 if public.reserve_discovery(current_setting('test.a')::uuid,current_setting('test.session')::uuid,gen_random_uuid(),jsonb_build_array(jsonb_build_object('id',current_setting('test.second'),'updated_at',(select updated_at from public.notes where id=current_setting('test.second')::uuid))), 'topic') is not null then raise exception 'Same-session repeat'; end if;
 if exists(select 1 from private.recall_state where user_id=current_setting('test.a')::uuid) or exists(select 1 from private.push_deliveries where user_id=current_setting('test.a')::uuid) then raise exception 'Discovery changed notification state'; end if;
end $$;
-- Recall uses the same recent history, without altering its cadence/window settings.
do $$ declare scan jsonb;
begin
 scan=public.recall_service('scan',current_setting('test.a')::uuid);
 if scan->'candidates' @> jsonb_build_array(jsonb_build_object('id',current_setting('test.old'))) or scan->'candidates' @> jsonb_build_array(jsonb_build_object('id',current_setting('test.second'))) then raise exception 'Recall repeated a recent discovery'; end if;
end $$;
set local role authenticated;
update public.note_discovery_history set dismissed=true where request_id=current_setting('test.request')::uuid;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.b'),'role','authenticated')::text,true);
do $$ begin
 if exists(select 1 from public.note_discovery_history) or exists(select 1 from public.related_note_dismissals) or exists(select 1 from public.read_resurfaced_notes(current_setting('test.origin')::uuid)) then raise exception 'Cross-user feedback/results leak'; end if;
 update public.note_discovery_history set dismissed=false where request_id=current_setting('test.request')::uuid;
 if found then raise exception 'Foreign feedback editable'; end if;
end $$;
set local role service_role;
select set_config('request.jwt.claims','{}',true);
update public.note_discovery_history set shown_at=now()-interval '8 days' where request_id=current_setting('test.request')::uuid;
do $$ begin
 if public.discovery_card(current_setting('test.request')::uuid,current_setting('test.a')::uuid) is not null then raise exception 'Dismissed card readable'; end if;
 if public.discovery_candidates(current_setting('test.a')::uuid,gen_random_uuid()) @> jsonb_build_array(jsonb_build_object('id',current_setting('test.second'))) then raise exception 'Dismissal cooldown ignored'; end if;
 if public.reserve_discovery(current_setting('test.a')::uuid,gen_random_uuid(),gen_random_uuid(),jsonb_build_array(jsonb_build_object('id',current_setting('test.foreign'),'updated_at',(select updated_at from public.notes where id=current_setting('test.foreign')::uuid))), 'topic') is not null then raise exception 'Service reservation cross-owner'; end if;
end $$;
-- A prepared flashback is also retired if rediscovery wins a concurrent selection.
insert into public.flashbacks(user_id,note_id,source_hash,context_revision,user_version,quote,message,reason)
 select n.user_id,n.id,c.source_hash,c.revision,c.user_version,n.content,'Synthetic fixture','Synthetic fixture' from public.notes n join public.note_contexts c on c.note_id=n.id where n.id=current_setting('test.old')::uuid;
update public.note_discovery_history set shown_at=clock_timestamp() where user_id=current_setting('test.a')::uuid and note_id=current_setting('test.old')::uuid;
do $$ begin if exists(select 1 from public.flashbacks where user_id=current_setting('test.a')::uuid and status='ready') then raise exception 'Already seen thought retained a ready flashback'; end if; end $$;
-- An edit cannot be returned using a stale candidate version; deletion cascades all history/feedback.
select set_config('test.topic_version',(select updated_at::text from public.notes where id=current_setting('test.topic')::uuid),true);
update public.notes set content='An entirely different note about repairing a bicycle.' where id=current_setting('test.topic')::uuid;
do $$ begin if public.reserve_discovery(current_setting('test.a')::uuid,gen_random_uuid(),gen_random_uuid(),jsonb_build_array(jsonb_build_object('id',current_setting('test.topic'),'updated_at',current_setting('test.topic_version'))),'topic') is not null then raise exception 'Stale candidate accepted'; end if; end $$;
set local role anon;
do $$ begin
 begin perform * from public.read_resurfaced_notes(current_setting('test.origin')::uuid); raise exception 'Anonymous resurfacing'; exception when insufficient_privilege then null; end;
 begin perform * from public.note_discovery_history; raise exception 'Anonymous history'; exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from public.notes where id=current_setting('test.old')::uuid;
do $$ begin if exists(select 1 from public.related_note_dismissals where note_a=current_setting('test.old')::uuid or note_b=current_setting('test.old')::uuid) or exists(select 1 from public.note_discovery_history where note_id=current_setting('test.old')::uuid) then raise exception 'Deleted note survived feedback/history'; end if; end $$;
delete from auth.users where id in(current_setting('test.a')::uuid,current_setting('test.b')::uuid);
rollback;
select 'PASS: capture feedback/history, older-only/privacy/exclusions, discovery replay/repetition, source search, RLS, stale edits/deletes, notification independence' as result;
