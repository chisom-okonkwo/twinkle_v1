begin;
select set_config('test.owner',gen_random_uuid()::text,true),set_config('test.session',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.owner')::uuid);
insert into public.notes(user_id,content,created_at,updated_at)
 select current_setting('test.owner')::uuid,'A steady creative practice helps me develop ideas without waiting for inspiration. I want to make room for meaningful work each morning. Synthetic reflection '||i,now()-(i+2)*interval '1 day',now()-(i+2)*interval '1 day' from generate_series(1,1000) i;
set local role service_role;
do $$ declare start_at timestamptz; candidates jsonb; elapsed interval;
begin
 start_at=clock_timestamp();candidates=public.discovery_candidates(current_setting('test.owner')::uuid,current_setting('test.session')::uuid);elapsed=clock_timestamp()-start_at;
 if jsonb_array_length(candidates)<>100 then raise exception 'Discovery candidate bound incorrect'; end if;
 if elapsed>interval '2 seconds' then raise exception 'Discovery retrieval too slow: %',elapsed; end if;
 perform set_config('test.elapsed_ms',(extract(epoch from elapsed)*1000)::text,true);
end $$;
select 'PASS: 1000-note discovery retrieval, 100 candidates, no AI' as result,current_setting('test.elapsed_ms') as elapsed_ms;
rollback;
