begin;
select set_config('test.owner',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.owner')::uuid);
insert into public.notes(user_id,content) select current_setting('test.owner')::uuid,'Synthetic existing memory '||i||': creative work benefits from steady practice and reflection.' from generate_series(1,1000) i;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner'),'role','authenticated')::text,true);
insert into public.context_preferences(user_id,enabled) values(current_setting('test.owner')::uuid,true);
do $$ declare started timestamptz=clock_timestamp(); result jsonb;
begin
 for i in 1..20 loop
  result=public.import_text_note('Synthetic '||i||'.md','Synthetic imported reflection '||i||': I want to practice writing every morning, rather than wait for inspiration.','{"created_at":"2010-01-01"}');
  if result->>'status'<>'imported' then raise exception 'Batch not imported'; end if;
 end loop;
 if clock_timestamp()-started>interval '5 seconds' then raise exception '20 imports too slow'; end if;
 if (select count(*) from public.notes where import_metadata is not null)<>20 then raise exception 'Wrong import count'; end if;
 if exists(select 1 from public.note_contexts c join public.notes n on n.id=c.note_id where n.import_metadata is not null and c.status<>'disabled') then raise exception 'Batch started AI'; end if;
 if not exists(select 1 from public.search_notes('Synthetic 20')) then raise exception 'Batch not indexed'; end if;
 perform set_config('test.elapsed_ms',(extract(epoch from clock_timestamp()-started)*1000)::text,true);
end $$;
select 'PASS: 20 imports into a 1000-note collection, no AI' as result,current_setting('test.elapsed_ms') as elapsed_ms;
rollback;
