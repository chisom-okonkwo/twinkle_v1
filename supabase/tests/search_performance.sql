-- Repeatable synthetic benchmark. No real notes are read; fixtures roll back.
begin;
select set_config('test.search_owner',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.search_owner')::uuid);
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.search_owner'),'role','authenticated')::text,true);
insert into public.notes(content)
 select 'Collection fragment '||i||E'\n'||repeat('A thought about creative practice, books, lanterns and the night sky. ',8)||
   case when i=500 then 'The needleobservatory opens on Saturday.' else 'A constellation is worth drawing.' end
 from generate_series(1,1000) i;
do $$
declare started timestamptz; selective_ms numeric; broad_ms numeric; page_ms numeric; plan jsonb;
begin
 started=clock_timestamp(); perform * from public.search_notes('needleobservatory');
 selective_ms=extract(epoch from clock_timestamp()-started)*1000;
 started=clock_timestamp(); perform * from public.search_notes('creative lantern');
 broad_ms=extract(epoch from clock_timestamp()-started)*1000;
 started=clock_timestamp(); perform * from public.search_notes('creative lantern',21,200);
 page_ms=extract(epoch from clock_timestamp()-started)*1000;
 execute $plan$explain(analyze,format json) select d.note_id from public.note_search_documents d
 where d.user_id=(select auth.uid()) and d.document @@ plainto_tsquery('english','needleobservatory')$plan$ into plan;
 perform set_config('test.search_metrics',jsonb_build_object('notes',1000,'selective_ms',round(selective_ms,2),'broad_ms',round(broad_ms,2),'page_200_ms',round(page_ms,2),'gin_used',plan::text like '%note_search_words%','plan',plan)::text,true);
 if selective_ms>2000 or broad_ms>2000 or page_ms>2000 then raise exception 'Synthetic search exceeded 2 seconds'; end if;
end $$;
select current_setting('test.search_metrics')::jsonb as benchmark;
rollback;
