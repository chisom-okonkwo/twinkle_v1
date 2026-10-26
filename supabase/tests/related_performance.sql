-- Synthetic 1,000-note collection. Rollback; no model calls or notifications.
begin;
select set_config('test.owner',gen_random_uuid()::text,true);
select set_config('test.origin',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.owner')::uuid);
insert into public.notes(id,user_id,content) values(current_setting('test.origin')::uuid,current_setting('test.owner')::uuid,'Creativity grows through steady practice.');
insert into public.notes(user_id,content,created_at)
 select current_setting('test.owner')::uuid,
 case when i%20=0 then 'Creative work benefits from discipline and a dependable daily routine. ' else 'Garden observations and cooking ideas for an ordinary weekend. ' end || repeat('A longer synthetic note with a few practical details. ',15) || i,now()-i*interval '1 day'
 from generate_series(1,1000) i;
set local role service_role;
do $$ declare start_at timestamptz; results jsonb; elapsed interval;
begin
 start_at=clock_timestamp();
 results=public.related_note_candidates(current_setting('test.origin')::uuid,current_setting('test.owner')::uuid,array['creative work','discipline','daily routine','practice']);
 elapsed=clock_timestamp()-start_at;
 if jsonb_array_length(results)<>16 then raise exception 'Candidates not bounded or missing'; end if;
 if elapsed>interval '2 seconds' then raise exception 'Candidate retrieval too slow: %',elapsed; end if;
 perform set_config('test.elapsed_ms',(extract(epoch from elapsed)*1000)::text,true);
end $$;
select 'PASS: 1000-note candidate retrieval' as result, current_setting('test.elapsed_ms') as elapsed_ms;
rollback;
