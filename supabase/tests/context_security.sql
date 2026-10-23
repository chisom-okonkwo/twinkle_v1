-- Run as the database owner. Every test fixture is rolled back.
begin;
select set_config('test.owner_a',gen_random_uuid()::text,true);
select set_config('test.owner_b',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.owner_a')::uuid),(current_setting('test.owner_b')::uuid);
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_a'),'role','authenticated')::text,true);
with n as (insert into public.notes(content) values('Old note, not opted in') returning id) select set_config('test.old_note',id::text,true) from n;
insert into public.context_preferences(user_id,enabled) values(current_setting('test.owner_a')::uuid,true);
do $$ begin
  if (select status from public.note_contexts where note_id=current_setting('test.old_note')::uuid)<>'disabled' then raise exception 'Historical note was automatically enabled'; end if;
end $$;
with n as (insert into public.notes(content) values('Thinking of that internship') returning id) select set_config('test.note',id::text,true) from n;
update public.note_contexts set user_context='I want to remember this',answer='' where note_id=current_setting('test.note')::uuid;
do $$ begin
  if (select status from public.note_contexts where note_id=current_setting('test.note')::uuid)<>'pending' then raise exception 'New opted-in note was not pending'; end if;
  begin update public.note_contexts set generated_context='{}' where note_id=current_setting('test.note')::uuid; raise exception 'Client forged AI context'; exception when insufficient_privilege then null; end;
  begin perform public.claim_note_context(current_setting('test.note')::uuid,current_setting('test.owner_a')::uuid,true,true); raise exception 'Client called privileged claim'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_b'),'role','authenticated')::text,true);
do $$ declare changed integer; begin
  if exists(select 1 from public.note_contexts where note_id=current_setting('test.note')::uuid) then raise exception 'Cross-owner context read'; end if;
  update public.note_contexts set user_context='Intruder' where note_id=current_setting('test.note')::uuid; get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Cross-owner context write'; end if;
  if exists(select 1 from public.context_preferences where user_id=current_setting('test.owner_a')::uuid) then raise exception 'Cross-owner preference read'; end if;
end $$;
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform * from public.note_contexts; raise exception 'Anonymous context access'; exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
select set_config('test.first_claim',public.claim_note_context(current_setting('test.note')::uuid,current_setting('test.owner_a')::uuid)::text,true);
do $$ begin
  if public.claim_note_context(current_setting('test.note')::uuid,current_setting('test.owner_a')::uuid)->>'status'<>'processing' then raise exception 'Duplicate in-flight claim'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_a'),'role','authenticated')::text,true);
update public.notes set content='Now considering the project' where id=current_setting('test.note')::uuid;
set local role service_role;
do $$ declare c jsonb=current_setting('test.first_claim')::jsonb; begin
  if public.finish_note_context(current_setting('test.note')::uuid,current_setting('test.owner_a')::uuid,(c->>'revision')::bigint,(c->>'token')::uuid,'{}',null,'test') then raise exception 'Stale response overwrote edit'; end if;
  perform public.fail_note_context(current_setting('test.note')::uuid,current_setting('test.owner_a')::uuid,(c->>'revision')::bigint,(c->>'token')::uuid,'timeout');
  if (select status from public.note_contexts where note_id=current_setting('test.note')::uuid)<>'pending' then raise exception 'Stale failure overwrote edit'; end if;
  if (select user_context from public.note_contexts where note_id=current_setting('test.note')::uuid)<>'I want to remember this' then raise exception 'Edit erased user context'; end if;
end $$;
select set_config('test.second_claim',public.claim_note_context(current_setting('test.note')::uuid,current_setting('test.owner_a')::uuid)::text,true);
set local role authenticated;
update public.context_preferences set enabled=false where user_id=current_setting('test.owner_a')::uuid;
set local role service_role;
do $$ declare c jsonb=current_setting('test.second_claim')::jsonb; begin
  if public.finish_note_context(current_setting('test.note')::uuid,current_setting('test.owner_a')::uuid,(c->>'revision')::bigint,(c->>'token')::uuid,'{}',null,'test') then raise exception 'Opt-out did not invalidate response'; end if;
end $$;
set local role authenticated;
update public.context_preferences set enabled=true where user_id=current_setting('test.owner_a')::uuid;
set local role service_role;
do $$ begin
  if public.claim_note_context(current_setting('test.note')::uuid,current_setting('test.owner_a')::uuid)->>'status'<>'disabled' then raise exception 'Enabling reprocessed old notes'; end if;
end $$;
select set_config('test.third_claim',public.claim_note_context(current_setting('test.note')::uuid,current_setting('test.owner_a')::uuid,true,true)::text,true);
do $$ declare c jsonb=current_setting('test.third_claim')::jsonb; begin
  if not public.finish_note_context(current_setting('test.note')::uuid,current_setting('test.owner_a')::uuid,(c->>'revision')::bigint,(c->>'token')::uuid,'{}','{"kind":"project","anchor":"the project","question":"Which project were you referring to?"}','test') then raise exception 'Current context did not complete'; end if;
  if public.claim_note_context(current_setting('test.note')::uuid,current_setting('test.owner_a')::uuid,true,true)->>'status'<>'completed' then raise exception 'Unchanged completed context not cached'; end if;
end $$;
set local role authenticated;
update public.note_contexts set prompt_dismissed=true where note_id=current_setting('test.note')::uuid;
update public.notes set content='Now considering that internship' where id=current_setting('test.note')::uuid;
set local role service_role;
select set_config('test.last_claim',public.claim_note_context(current_setting('test.note')::uuid,current_setting('test.owner_a')::uuid)::text,true);
do $$ declare c jsonb=current_setting('test.last_claim')::jsonb; begin
  perform public.finish_note_context(current_setting('test.note')::uuid,current_setting('test.owner_a')::uuid,(c->>'revision')::bigint,(c->>'token')::uuid,'{}','{"kind":"internship","anchor":"that internship","question":"Which internship were you considering?"}','test');
  if not (select prompt_dismissed and prompt_revision is null and prompt_question='Which project were you referring to?' from public.note_contexts where note_id=current_setting('test.note')::uuid) then raise exception 'Dismissed prompt reappeared or second question replaced first'; end if;
  if (select user_context from public.note_contexts where note_id=current_setting('test.note')::uuid)<>'I want to remember this' then raise exception 'AI erased user context'; end if;
end $$;
set local role authenticated;
with n as (insert into public.notes(content) values('Original survives an AI timeout') returning id) select set_config('test.failure_note',id::text,true) from n;
set local role service_role;
select set_config('test.failure_claim',public.claim_note_context(current_setting('test.failure_note')::uuid,current_setting('test.owner_a')::uuid)::text,true);
do $$ declare c jsonb=current_setting('test.failure_claim')::jsonb; begin
  perform public.fail_note_context(current_setting('test.failure_note')::uuid,current_setting('test.owner_a')::uuid,(c->>'revision')::bigint,(c->>'token')::uuid,'timeout');
end $$;
set local role authenticated;
do $$ begin
  if (select content from public.notes where id=current_setting('test.failure_note')::uuid)<>'Original survives an AI timeout' then raise exception 'AI failure lost note'; end if;
  if (select status from public.note_contexts where note_id=current_setting('test.failure_note')::uuid)<>'failed' then raise exception 'Failure status missing'; end if;
end $$;
update public.notes set content='I can edit while AI is unavailable' where id=current_setting('test.failure_note')::uuid;
do $$ begin
  if (select generated_context is not null or status<>'pending' from public.note_contexts where note_id=current_setting('test.failure_note')::uuid) then raise exception 'Editing failed context did not invalidate and requeue'; end if;
end $$;
delete from public.notes where id in (current_setting('test.note')::uuid,current_setting('test.failure_note')::uuid);
do $$ begin
  if exists(select 1 from public.note_contexts where note_id=current_setting('test.note')::uuid) then raise exception 'Context did not cascade with note'; end if;
end $$;
rollback;
select 'PASS: opt-in, historical exclusion, RLS, stale/opt-out rejection, caching, prompt dismissal, user context preservation and cascade' as result;
