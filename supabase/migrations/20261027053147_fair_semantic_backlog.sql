-- Oldest due owner first; repeatedly active owners must not starve other backfills.
create or replace function public.semantic_backlog() returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('user_id',x.user_id,'scope',x.scope_key)),'[]') from(
 select first_scope.* from(
 select distinct on(s.user_id)s.user_id,s.scope_key,s.available_at from private.semantic_scopes s join public.context_preferences c on c.user_id=s.user_id and c.enabled
 left join private.semantic_runs r on r.user_id=s.user_id
 where s.needs_work and s.available_at<=now() and (r.user_id is null or r.status<>'processing' or r.started_at<=now()-interval '2 minutes')
 order by s.user_id,s.available_at,s.scope_key)first_scope order by available_at,user_id limit 4)x
$$;
notify pgrst,'reload schema';
