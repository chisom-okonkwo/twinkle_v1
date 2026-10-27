begin;
select set_config('test.sem_perf',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.sem_perf')::uuid);
insert into public.context_preferences(user_id,enabled) values(current_setting('test.sem_perf')::uuid,false);
insert into public.notes(user_id,title,content) select current_setting('test.sem_perf')::uuid,'Synthetic thought '||i,'A distinct original synthetic thought for owner-scoped retrieval benchmark item '||i from generate_series(1,1000)i;
update public.context_preferences set enabled=true where user_id=current_setting('test.sem_perf')::uuid;
update private.note_embeddings e set embedding=array_prepend(x.v,array_prepend(sqrt(1-x.v*x.v),array_fill(0.0,array[1534])))::extensions.vector,status='ready'
from(select note_id,(row_number()over(order by note_id)::double precision/1001) as v from private.note_embeddings where user_id=current_setting('test.sem_perf')::uuid)x where e.note_id=x.note_id;
set local role service_role;select set_config('request.jwt.claims','{}',true);
do $$declare started timestamptz=clock_timestamp();result jsonb;target uuid;begin
 select note_id into target from private.note_embeddings where user_id=current_setting('test.sem_perf')::uuid order by note_id limit 1;
 result=public.semantic_neighbours(target,current_setting('test.sem_perf')::uuid,12);
 if jsonb_array_length(result)<>12 then raise exception 'Unbounded retrieval';end if;
 perform set_config('test.sem_perf_ms',(extract(epoch from clock_timestamp()-started)*1000)::text,true);
 if clock_timestamp()-started>interval '3 seconds' then raise exception 'Exact owner retrieval exceeded three seconds';end if;
end $$;
select current_setting('test.sem_perf_ms')::numeric as exact_1000_notes_ms;
set local role authenticated;select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.sem_perf'),'role','authenticated')::text,true);
do $$declare started timestamptz=clock_timestamp();result jsonb;begin
 result=public.note_theme_snapshot('recent');
 if result#>>'{date_coverage,in_period}'<>'1000' or result->>'all_time_group_count'<>'0' then raise exception 'Large-collection date coverage incorrect';end if;
 perform set_config('test.sem_view_ms',(extract(epoch from clock_timestamp()-started)*1000)::text,true);
 if clock_timestamp()-started>interval '5 seconds' then raise exception 'Theme date-view read exceeded five seconds';end if;
end $$;
select current_setting('test.sem_view_ms')::numeric as recent_view_1000_notes_ms;
set constraints all immediate;rollback;
