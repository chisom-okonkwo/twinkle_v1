-- Materialize capture dates once and use bounded primary-key lookups.
-- Fresh imports can have stale planner statistics; do not repeatedly scan the owner collection.
create or replace function private.semantic_progress(owner_id uuid,bounds jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r private.semantic_runs;counts jsonb;jobs jsonb;state_name text;scope text=bounds->>'key';paused boolean;active boolean;
begin
 select * into r from private.semantic_runs where user_id=owner_id;
 with period_notes as materialized(
 select n.id,private.semantic_captured_at(n) as captured_at from public.notes n where n.user_id=owner_id
 ),eligible as materialized(
 select e.note_id,e.input_hash,e.status,done.outcome,done.note_id as done_id,done.input_hash as done_hash,done.prompt_version as done_version
 from period_notes n
 join lateral(select e.note_id,e.input_hash,e.status from private.note_embeddings e
 where e.note_id=n.id and e.user_id=owner_id and e.model='text-embedding-3-small' and e.input_version=1 limit 1)e on true
 left join lateral(select d.note_id,d.input_hash,d.prompt_version,d.outcome from private.semantic_scope_notes d
 where d.user_id=owner_id and d.note_id=n.id and d.scope_key=scope limit 1)done on true
 where bounds->>'start' is null or n.captured_at>=(bounds->>'start')::timestamptz and n.captured_at<(bounds->>'end')::timestamptz)

 select jsonb_build_object('total',count(*) filter(where status<>'excluded'),'indexed',count(*) filter(where status='ready'),'waiting',count(*) filter(where status in('pending','deferred')),'deferred',count(*) filter(where status='deferred'),'indexing',count(*) filter(where status='processing'),'index_failed',count(*) filter(where status='failed'),'excluded',count(*) filter(where status='excluded'),'unsupported',count(*) filter(where status='too_long'),
 'checked',count(*) filter(where status='ready' and done_hash=input_hash and done_version=3),'pending',count(*) filter(where status='ready' and (done_hash is null or done_hash<>input_hash or done_version<>3)),
 'no_candidates',count(*) filter(where done_hash=input_hash and done_version=3 and outcome='no_candidates')) into counts from eligible;
 select jsonb_build_object('validation_failed',count(*) filter(where status='failed'),'validating',count(*) filter(where status='processing'),'jobs_pending',count(*) filter(where status in('pending','validated')),
 'ai_empty',count(*) filter(where outcome='ai_empty' and status='completed'),'verification_rejected',count(*) filter(where outcome='verification_rejected' and status='completed'),'suppressed',count(*) filter(where outcome='suppressed' and status='completed'),'invalid_output',count(*) filter(where status='failed' and error_code like 'invalid_output%')) into jobs
 from private.semantic_group_jobs where user_id=owner_id and scope_key=scope and prompt_version=3 and status<>'stale';
 paused=r.window_start=date_trunc('hour',now()) and (r.embedding_attempts>=512 or r.validation_attempts>=24);
 active=r.status='processing' and r.started_at>now()-interval '2 minutes' and(r.current_scope=scope or (counts->>'indexing')::int>0);
 state_name=case when not exists(select 1 from public.context_preferences where user_id=owner_id and enabled) then 'disabled'
 when (counts->>'deferred')::int>0 and not exists(select 1 from private.note_embeddings where user_id=owner_id and status in('ready','pending','processing','failed')) then 'not_started'
 when active then 'processing' when paused and (counts->>'pending')::int+(counts->>'waiting')::int+(jobs->>'jobs_pending')::int>0 then 'paused'
 when (counts->>'index_failed')::int+(jobs->>'validation_failed')::int>0 or r.status='failed' and r.current_scope=scope then 'failed'
 when (counts->>'pending')::int+(counts->>'waiting')::int+(counts->>'indexing')::int+(jobs->>'jobs_pending')::int+(jobs->>'validating')::int>0 then 'pending' else 'ready' end;
 return counts||jobs||jsonb_build_object('status',state_name,'error_code',r.error_code,'budget_resume_at',case when paused then r.window_start+interval '1 hour' end,'scheduled',exists(select 1 from private.semantic_scopes where user_id=owner_id and scope_key=scope and needs_work),'scope',scope,'timezone',bounds->>'timezone');
end $$;
notify pgrst,'reload schema';
