-- No provider calls. Failure, consent, exclusion, dismissal and lease recovery.
begin;
select set_config('test.rf_owner',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.rf_owner')::uuid);
insert into public.context_preferences(user_id,enabled) values(current_setting('test.rf_owner')::uuid,true);
insert into public.notes(id,user_id,content,created_at) values
('22000000-0000-4000-8000-000000000001',current_setting('test.rf_owner')::uuid,'I believe daily drawing is more useful than waiting for inspiration.',now()-interval '120 days'),
('22000000-0000-4000-8000-000000000002',current_setting('test.rf_owner')::uuid,'I am considering a design course and wonder how it might fit my schedule.',now()-interval '60 days'),
('22000000-0000-4000-8000-000000000003',current_setting('test.rf_owner')::uuid,'I believe drawing a little every day still helps more than waiting for inspiration.',now()-interval '30 days');
select set_config('test.rf_claim',public.claim_reflection_analysis(current_setting('test.rf_owner')::uuid,'prompt','22000000-0000-4000-8000-000000000001')::text,true);
select public.fail_reflection_analysis(current_setting('test.rf_owner')::uuid,'prompt','22000000-0000-4000-8000-000000000001',(current_setting('test.rf_claim')::jsonb->>'token')::uuid);
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.rf_owner'),'role','authenticated')::text,true);
do $$begin
 if public.read_reflection_experience('note','22000000-0000-4000-8000-000000000001')->>'prompt_status'<>'failed' then raise exception 'Failure not visible';end if;
 update public.notes set content='A fresh thought while AI is unavailable.' where id='22000000-0000-4000-8000-000000000003';
 if not exists(select 1 from public.notes where content='A fresh thought while AI is unavailable.') then raise exception 'AI failure interrupted note saving';end if;
end $$;
reset role;select set_config('request.jwt.claims','{}',true);
-- Simulate an interrupted new claim, then verify it is both visible and retryable.
select set_config('test.rf_claim',public.claim_reflection_analysis(current_setting('test.rf_owner')::uuid,'prompt','22000000-0000-4000-8000-000000000002')::text,true);
update private.reflective_prompts set started_at=now()-interval '3 minutes' where user_id=current_setting('test.rf_owner')::uuid and note_id='22000000-0000-4000-8000-000000000002';
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.rf_owner'),'role','authenticated')::text,true);
do $$declare s jsonb;begin
 s=public.read_reflection_experience('note','22000000-0000-4000-8000-000000000002');
 if s->>'prompt_status'<>'failed' or s->>'can_prompt'<>'true' then raise exception 'Interrupted prompt cannot be retried';end if;
end $$;
reset role;select set_config('request.jwt.claims','{}',true);
select set_config('test.rf_new',public.claim_reflection_analysis(current_setting('test.rf_owner')::uuid,'prompt','22000000-0000-4000-8000-000000000002')::text,true);
do $$declare old_claim jsonb=current_setting('test.rf_claim')::jsonb;new_claim jsonb=current_setting('test.rf_new')::jsonb;p jsonb=jsonb_build_object('question','How do you view the design course now?','quote','I am considering a design course and wonder how it might fit my schedule.');begin
 if new_claim->>'status'<>'claimed' or new_claim->>'token'=old_claim->>'token' then raise exception 'Lease not safely reclaimed';end if;
 if public.finish_reflection_analysis(current_setting('test.rf_owner')::uuid,'prompt','22000000-0000-4000-8000-000000000002',(old_claim->>'token')::uuid,old_claim->>'hash',p) then raise exception 'Stale token persisted question';end if;
 if not public.finish_reflection_analysis(current_setting('test.rf_owner')::uuid,'prompt','22000000-0000-4000-8000-000000000002',(new_claim->>'token')::uuid,new_claim->>'hash',p) then raise exception 'Reclaimed question not saved';end if;
end $$;
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.rf_owner'),'role','authenticated')::text,true);
select public.dismiss_reflective_prompt((public.read_reflection_experience('note','22000000-0000-4000-8000-000000000002')->'prompt'->>'id')::uuid);
update public.notes set title='Course thoughts' where id='22000000-0000-4000-8000-000000000002';
reset role;select set_config('request.jwt.claims','{}',true);
do $$begin
 if public.claim_reflection_analysis(current_setting('test.rf_owner')::uuid,'prompt','22000000-0000-4000-8000-000000000002')->>'status'<>'cached' then raise exception 'Dismissal did not survive edit';end if;
end $$;
update public.context_preferences set enabled=false where user_id=current_setting('test.rf_owner')::uuid;
do $$begin
 if exists(select 1 from private.reflection_runs where user_id=current_setting('test.rf_owner')::uuid) then raise exception 'Consent off retained comparisons';end if;
 if exists(select 1 from private.reflective_prompts where user_id=current_setting('test.rf_owner')::uuid and status in ('ready','processing','failed')) then raise exception 'Consent off retained generated question';end if;
 if public.claim_reflection_analysis(current_setting('test.rf_owner')::uuid,'prompt','22000000-0000-4000-8000-000000000001')->>'status'<>'unavailable' then raise exception 'Disabled AI processed';end if;
end $$;
update public.context_preferences set enabled=true where user_id=current_setting('test.rf_owner')::uuid;
insert into public.flashback_exclusions(note_id,user_id) values('22000000-0000-4000-8000-000000000003',current_setting('test.rf_owner')::uuid);
do $$begin
 if public.claim_reflection_analysis(current_setting('test.rf_owner')::uuid,'prompt','22000000-0000-4000-8000-000000000003')->>'status'<>'unavailable' then raise exception 'Excluded note processed';end if;
end $$;
set local role anon;select set_config('request.jwt.claims','{}',true);
do $$begin
 begin perform public.read_reflection_experience('note','22000000-0000-4000-8000-000000000001');raise exception 'Anonymous reflection visible';exception when insufficient_privilege then null;end;
end $$;
reset role;
set constraints all immediate;rollback;
