begin;
select set_config('test.work_owner',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.work_owner')::uuid);
insert into public.context_preferences(user_id,enabled) values(current_setting('test.work_owner')::uuid,true);
insert into public.notes(user_id,title,content) values(current_setting('test.work_owner')::uuid,'A short learning habit','Practise a little daily.');
do $$begin
 if not exists(select 1 from private.semantic_scopes where user_id=current_setting('test.work_owner')::uuid and scope_key='all' and needs_work) then raise exception 'Save left no durable work';end if;
 if public.authorize_semantic_worker(null) or public.authorize_semantic_worker(repeat('0',64)) then raise exception 'Invalid scheduler secret accepted';end if;
end $$;
set local role service_role;
select set_config('test.work_run',public.claim_semantic_run(current_setting('test.work_owner')::uuid)::text,true);
do $$declare u uuid=current_setting('test.work_owner')::uuid;t uuid=(current_setting('test.work_run')::jsonb->>'token')::uuid;begin
 if public.claim_semantic_run(u)->>'status'<>'processing' then raise exception 'Duplicate lease allowed';end if;
 update private.semantic_runs set embedding_attempts=512 where user_id=u;
 perform public.end_semantic_run(u,t);perform public.finish_semantic_work(u,'all',t);
 if not exists(select 1 from private.semantic_scopes where user_id=u and needs_work and available_at>=date_trunc('hour',now())+interval '1 hour') then raise exception 'Budget pause lost automatic continuation';end if;
end $$;
reset role;
update public.context_preferences set enabled=false where user_id=current_setting('test.work_owner')::uuid;
do $$begin if exists(select 1 from private.semantic_scopes where user_id=current_setting('test.work_owner')::uuid and needs_work) then raise exception 'Revoked consent retained work';end if;end $$;
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.work_owner'),'role','authenticated')::text,true);
do $$begin
 begin perform public.semantic_backlog();raise exception 'Client read private owner backlog';exception when insufficient_privilege then null;end;
 begin perform public.authorize_semantic_worker(repeat('0',64));raise exception 'Client probed worker secret';exception when insufficient_privilege then null;end;
 begin perform public.request_semantic_work(auth.uid(),'all');raise exception 'Client bypassed authenticated Edge endpoint';exception when insufficient_privilege then null;end;
end $$;
set constraints all immediate;rollback;

-- Scheduling fairness: select the oldest due owners, not the lowest UUIDs.
begin;
create temporary table fixture_owners(id uuid primary key,rank integer);
insert into fixture_owners select gen_random_uuid(),i from generate_series(1,6)i;
insert into auth.users(id) select id from fixture_owners;
insert into public.context_preferences(user_id,enabled) select id,true from fixture_owners;
insert into private.semantic_scopes(user_id,scope_key,needs_work,available_at) select id,'all',true,'2000-01-01'::timestamptz+rank*interval '1 minute' from fixture_owners;
do $$declare batch jsonb=public.semantic_backlog();begin
 if jsonb_array_length(batch)<>4 then raise exception 'Backlog batch is not bounded';end if;
 if exists(select 1 from fixture_owners f where rank<=4 and not exists(select 1 from jsonb_array_elements(batch)b where (b->>'user_id')::uuid=f.id)) then raise exception 'Oldest due owner starved';end if;
end $$;
rollback;
