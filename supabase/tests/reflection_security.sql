-- Rollback-only synthetic ownership, chronology, CAS, response and failure tests.
begin;
select set_config('test.ref_owner',gen_random_uuid()::text,true),set_config('test.ref_other',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.ref_owner')::uuid),(current_setting('test.ref_other')::uuid);
insert into public.context_preferences(user_id,enabled) values(current_setting('test.ref_owner')::uuid,true),(current_setting('test.ref_other')::uuid,true);
insert into public.notes(id,user_id,title,content,created_at) values
('21000000-0000-4000-8000-000000000001',current_setting('test.ref_owner')::uuid,'Earlier applications','I hesitate to apply for internships because I lack experience.','2020-01-10Z'),
('21000000-0000-4000-8000-000000000002',current_setting('test.ref_owner')::uuid,'Later applications','I intend to apply for internships even while I feel inexperienced.',now()-interval '30 days'),
('21000000-0000-4000-8000-000000000003',current_setting('test.ref_owner')::uuid,'Sensitive','I wrote about grief after a death in the family.','2020-01-10Z');
insert into public.notes(id,user_id,content,import_metadata) values('21000000-0000-4000-8000-000000000004',current_setting('test.ref_owner')::uuid,'I hesitate to apply for internships.',jsonb_build_object('version',1,'format','txt','file_name','undated.txt','imported_at',now(),'date_basis','import'));
insert into public.note_relations(note_id,related_id,user_id,explanation,origin_quote,related_quote,score) values('21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000002',current_setting('test.ref_owner')::uuid,'Applications','I hesitate to apply for internships because I lack experience.','I intend to apply for internships even while I feel inexperienced.',95);
select set_config('test.ref_claim',public.claim_reflection_analysis(current_setting('test.ref_owner')::uuid,'note','21000000-0000-4000-8000-000000000001')::text,true);
do $$declare claim jsonb=current_setting('test.ref_claim')::jsonb;result jsonb;begin
 if claim->>'status'<>'claimed' or jsonb_array_length(claim->'notes')<>2 then raise exception 'Bounded dated input unavailable';end if;
 if public.claim_reflection_analysis(current_setting('test.ref_owner')::uuid,'note','21000000-0000-4000-8000-000000000001')->>'status'<>'processing' then raise exception 'Concurrent claim duplicated';end if;
 result=jsonb_build_array(jsonb_build_object('kind','change','earlier_id','21000000-0000-4000-8000-000000000001','later_id','21000000-0000-4000-8000-000000000002','earlier_quote','I hesitate to apply for internships because I lack experience.','later_quote','I intend to apply for internships even while I feel inexperienced.','observation','The earlier note describes hesitation; the later note states an intention to apply while still feeling inexperienced.'));
 if not public.finish_reflection_analysis(current_setting('test.ref_owner')::uuid,'note','21000000-0000-4000-8000-000000000001',(claim->>'token')::uuid,claim->>'hash',result) then raise exception 'Valid evidence not saved';end if;
 if public.claim_reflection_analysis(current_setting('test.ref_owner')::uuid,'note','21000000-0000-4000-8000-000000000001')->>'status'<>'cached' then raise exception 'Unchanged work not cached';end if;
 if public.claim_reflection_analysis(current_setting('test.ref_owner')::uuid,'prompt','21000000-0000-4000-8000-000000000003')->>'status'<>'unavailable' then raise exception 'Sensitive content not suppressed';end if;
 if public.claim_reflection_analysis(current_setting('test.ref_owner')::uuid,'prompt','21000000-0000-4000-8000-000000000004')->>'status'<>'too_recent' then raise exception 'Unknown import date was treated as historical';end if;
end $$;
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.ref_owner'),'role','authenticated')::text,true);
do $$declare s jsonb;begin
 s=public.read_reflection_experience('note','21000000-0000-4000-8000-000000000001');
 if s->>'status'<>'completed' or jsonb_array_length(s->'comparisons')<>1 then raise exception 'Owned comparison inaccessible';end if;
 begin perform public.claim_reflection_analysis(current_setting('test.ref_owner')::uuid,'note','21000000-0000-4000-8000-000000000001');raise exception 'Client processing allowed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.ref_other'),'role','authenticated')::text,true);
do $$begin
 begin perform public.read_reflection_experience('note','21000000-0000-4000-8000-000000000001');raise exception 'Foreign comparison visible';exception when raise_exception then if sqlerrm<>'NOT_FOUND' then raise;end if;end;
end $$;
reset role;select set_config('request.jwt.claims','{}',true);
select set_config('test.ref_prompt',public.claim_reflection_analysis(current_setting('test.ref_owner')::uuid,'prompt','21000000-0000-4000-8000-000000000001')::text,true);
do $$declare c jsonb=current_setting('test.ref_prompt')::jsonb;begin
 if c->>'status'<>'claimed' then raise exception 'Eligible prompt not claimed';end if;
 if not public.finish_reflection_analysis(current_setting('test.ref_owner')::uuid,'prompt','21000000-0000-4000-8000-000000000001',(c->>'token')::uuid,c->>'hash',jsonb_build_object('question','How do you view internship applications now?','quote','I hesitate to apply for internships because I lack experience.')) then raise exception 'Prompt not saved';end if;
 if public.claim_reflection_analysis(current_setting('test.ref_owner')::uuid,'prompt','21000000-0000-4000-8000-000000000002')->>'status'<>'cooldown' then raise exception 'Question cooldown missing';end if;
end $$;
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.ref_owner'),'role','authenticated')::text,true);
select set_config('test.ref_prompt_id',(public.read_reflection_experience('note','21000000-0000-4000-8000-000000000001')->'prompt'->>'id'),true);
select set_config('test.ref_response',public.answer_reflective_prompt(current_setting('test.ref_prompt_id')::uuid,'I now plan to apply while learning more.')::text,true);
do $$declare response_id uuid=current_setting('test.ref_response')::uuid;begin
 if public.answer_reflective_prompt(current_setting('test.ref_prompt_id')::uuid,'I now plan to apply while learning more.')<>response_id then raise exception 'Response retry duplicated';end if;
 begin perform public.answer_reflective_prompt(current_setting('test.ref_prompt_id')::uuid,'A changed draft after a lost network response.');raise exception 'Changed retry was silently discarded';exception when raise_exception then if sqlerrm<>'RESPONSE_ALREADY_SAVED' then raise;end if;end;
 if (select content from public.notes where id='21000000-0000-4000-8000-000000000001')<>'I hesitate to apply for internships because I lack experience.' then raise exception 'Historical note overwritten';end if;
 if not exists(select 1 from public.search_notes('learning') where id=response_id) then raise exception 'Reflection not searchable';end if;
 if not exists(select 1 from public.note_reflections where response_note_id=response_id and question='How do you view internship applications now?') then raise exception 'Question association lost';end if;
 if not exists(select 1 from jsonb_array_elements(public.read_reflection_experience('note','21000000-0000-4000-8000-000000000001')->'notes') n where n->>'id'=response_id::text) then raise exception 'Authored response unavailable for future comparisons';end if;
 update public.notes set content='I now intend to apply and keep learning.' where id=response_id;
 if jsonb_array_length(public.read_reflection_experience('note','21000000-0000-4000-8000-000000000001')->'responses')<>1 then raise exception 'Response not retrievable';end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.ref_other'),'role','authenticated')::text,true);
do $$begin
 if exists(select 1 from public.note_reflections) then raise exception 'Foreign response links visible';end if;
 if exists(select 1 from public.notes where id=current_setting('test.ref_response')::uuid) then raise exception 'Foreign response readable';end if;
 begin perform public.answer_reflective_prompt(current_setting('test.ref_prompt_id')::uuid,'Foreign answer');raise exception 'Foreign prompt answer permitted';exception when raise_exception then if sqlerrm<>'PROMPT_CHANGED' then raise;end if;end;
end $$;
reset role;select set_config('request.jwt.claims','{}',true);
-- Material edits remove cached comparisons. Delayed results cannot revive them.
update public.notes set content='A different subject about cycling.' where id='21000000-0000-4000-8000-000000000002';
do $$declare c jsonb=current_setting('test.ref_claim')::jsonb;begin
 if exists(select 1 from private.reflection_runs where user_id=current_setting('test.ref_owner')::uuid) then raise exception 'Stale comparison survived edit';end if;
 if public.finish_reflection_analysis(current_setting('test.ref_owner')::uuid,'note','21000000-0000-4000-8000-000000000001',(c->>'token')::uuid,c->>'hash','[]') then raise exception 'Delayed result revived old comparison';end if;
end $$;
-- Keep a user's authored response when deleting the source, but remove its link.
delete from public.notes where id='21000000-0000-4000-8000-000000000001';
do $$begin
 if exists(select 1 from public.note_reflections where user_id=current_setting('test.ref_owner')::uuid) then raise exception 'Deleted original retained association';end if;
 if not exists(select 1 from public.notes where id=current_setting('test.ref_response')::uuid) then raise exception 'Author response unexpectedly deleted';end if;
end $$;
set constraints all immediate;
rollback;
