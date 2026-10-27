-- Date scopes reuse current vectors. Unknown original import dates are all-time only.
create function private.semantic_time_bounds(owner_id uuid,period text,range_start timestamptz default null,range_end timestamptz default null,zone text default null) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare tz text;begin_at timestamptz;end_at timestamptz;key text;today date;
begin
 tz=coalesce(zone,(select timezone from public.recall_preferences where user_id=owner_id),'UTC');
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then raise exception 'INVALID_TIMEZONE';end if;
 if period='all' then key='all';
 elsif period='recent' then today=(now() at time zone tz)::date;begin_at=(today-89)::timestamp at time zone tz;end_at=(today+1)::timestamp at time zone tz;
 elsif period='custom' and range_start is not null and range_end is not null and range_start<range_end then begin_at=range_start;end_at=range_end;
 else raise exception 'INVALID_RANGE';end if;
 if key is null then key=encode(extensions.digest(tz||':'||extract(epoch from begin_at)::text||':'||extract(epoch from end_at)::text,'sha256'),'hex');end if;
 return jsonb_build_object('key',key,'start',begin_at,'end',end_at,'timezone',tz);
end $$;
create or replace function public.prepare_semantic_scope(caller_id uuid,period text default 'all',range_start timestamptz default null,range_end timestamptz default null,zone text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare bounds jsonb;key text;
begin
 if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then raise exception 'CONTEXT_DISABLED';end if;
 bounds=private.semantic_time_bounds(caller_id,period,range_start,range_end,zone);key=bounds->>'key';
 if not exists(select 1 from private.semantic_scopes where user_id=caller_id and scope_key=key) and (select count(*) from private.semantic_scopes where user_id=caller_id)>31 then
  delete from private.semantic_scopes where user_id=caller_id and scope_key<>'all' and created_at<now()-interval '90 days';
  if (select count(*) from private.semantic_scopes where user_id=caller_id)>31 then raise exception 'SCOPE_LIMIT';end if;
 end if;
 insert into private.semantic_scopes(user_id,scope_key,range_start,range_end,timezone) values(caller_id,key,(bounds->>'start')::timestamptz,(bounds->>'end')::timestamptz,bounds->>'timezone') on conflict(user_id,scope_key) do nothing;
 return bounds;
end $$;
create or replace function private.visible_theme_members(owner_id uuid,period text) returns table(theme_id uuid,note_id uuid,quote text,created_at timestamptz,title text,preview text,capture_method text)
language sql stable security invoker set search_path='' as $$
 with bounds as(select private.semantic_time_bounds(owner_id,period) b)
 select distinct on(m.theme_id,n.id)m.theme_id,n.id,m.quote,private.semantic_captured_at(n),coalesce(nullif(n.title,''),nullif(left(split_part(btrim(n.content),E'\n',1),160),''),'Note with attachments'),left(n.content,600),n.capture_method
 from public.note_theme_members m join public.note_themes t on t.id=m.theme_id and t.user_id=m.user_id
 join public.notes n on n.id=m.note_id and n.user_id=m.user_id
 join private.note_embeddings e on e.note_id=n.id and e.user_id=n.user_id and e.input_hash=m.input_hash and e.status='ready' and e.model='text-embedding-3-small' and e.input_version=1
 join private.semantic_group_jobs j on j.id=m.job_id and j.user_id=m.user_id and j.status='completed' and j.prompt_version=3 cross join bounds
 where m.user_id=owner_id and not t.dismissed and t.engine_version=2 and private.semantic_eligible(n.id,owner_id)
 and exists(select 1 from public.context_preferences where user_id=owner_id and enabled)
 and(period='all' or private.semantic_captured_at(n)>=(bounds.b->>'start')::timestamptz and private.semantic_captured_at(n)<(bounds.b->>'end')::timestamptz)
 and not exists(select 1 from public.related_note_dismissals d join public.note_theme_members a on a.theme_id=m.theme_id and a.user_id=owner_id and a.note_id=d.note_a join public.note_theme_members b on b.theme_id=m.theme_id and b.user_id=owner_id and b.note_id=d.note_b where d.user_id=owner_id)
 order by m.theme_id,n.id,j.completed_at desc,m.scope_key
$$;
create function private.semantic_progress(owner_id uuid,bounds jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r private.semantic_runs;counts jsonb;jobs jsonb;state_name text;scope text=bounds->>'key';paused boolean;active boolean;
begin
 select * into r from private.semantic_runs where user_id=owner_id;
 with eligible as materialized(select e.*,d.outcome,d.note_id as done_id,d.input_hash as done_hash,d.prompt_version as done_version from private.note_embeddings e join public.notes n on n.id=e.note_id and n.user_id=e.user_id
 left join private.semantic_scope_notes d on d.user_id=e.user_id and d.note_id=e.note_id and d.scope_key=scope
 where e.user_id=owner_id and e.model='text-embedding-3-small' and e.input_version=1 and (bounds->>'start' is null or private.semantic_captured_at(n)>=(bounds->>'start')::timestamptz and private.semantic_captured_at(n)<(bounds->>'end')::timestamptz))
 select jsonb_build_object('total',count(*) filter(where status<>'excluded'),'indexed',count(*) filter(where status='ready'),'waiting',count(*) filter(where status in('pending','deferred')),'deferred',count(*) filter(where status='deferred'),'indexing',count(*) filter(where status='processing'),'index_failed',count(*) filter(where status='failed'),'excluded',count(*) filter(where status='excluded'),'unsupported',count(*) filter(where status='too_long'),
 'checked',count(*) filter(where status='ready' and done_hash=input_hash and done_version=3),'pending',count(*) filter(where status='ready' and (done_hash is null or done_hash<>input_hash or done_version<>3)),
 'no_candidates',count(*) filter(where done_hash=input_hash and done_version=3 and outcome='no_candidates')) into counts from eligible;
 select jsonb_build_object('validation_failed',count(*) filter(where status='failed'),'validating',count(*) filter(where status='processing'),'jobs_pending',count(*) filter(where status in('pending','validated')),
 'ai_empty',count(*) filter(where outcome='ai_empty' and status='completed'),'verification_rejected',count(*) filter(where outcome='verification_rejected' and status='completed'),'suppressed',count(*) filter(where outcome='suppressed' and status='completed'),'invalid_output',count(*) filter(where status='failed' and error_code like 'invalid_output%')) into jobs
 from private.semantic_group_jobs where user_id=owner_id and scope_key=scope and prompt_version=3 and status<>'stale';
 paused=r.window_start=date_trunc('hour',now()) and (r.embedding_attempts>=512 or r.validation_attempts>=24);
 active=r.status='processing' and r.started_at>now()-interval '2 minutes';
 state_name=case when not exists(select 1 from public.context_preferences where user_id=owner_id and enabled) then 'disabled'
 when (counts->>'deferred')::int>0 and not exists(select 1 from private.note_embeddings where user_id=owner_id and status in('ready','pending','processing','failed')) then 'not_started'
 when active then 'processing' when paused and (counts->>'pending')::int+(counts->>'waiting')::int+(jobs->>'jobs_pending')::int>0 then 'paused'
 when (counts->>'index_failed')::int+(jobs->>'validation_failed')::int>0 or r.status='failed' then 'failed'
 when (counts->>'pending')::int+(counts->>'waiting')::int+(counts->>'indexing')::int+(jobs->>'jobs_pending')::int+(jobs->>'validating')::int>0 then 'pending' else 'ready' end;
 return counts||jobs||jsonb_build_object('status',state_name,'error_code',r.error_code,'budget_resume_at',case when paused then r.window_start+interval '1 hour' end,'scope',scope,'timezone',bounds->>'timezone');
end $$;
create or replace function private.note_theme_snapshot(period text) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare owner_id uuid=auth.uid();bounds jsonb;progress jsonb;groups jsonb;hidden integer;
begin
 if owner_id is null then raise insufficient_privilege;end if;
 if period is null or period not in('all','recent') then raise invalid_parameter_value;end if;
 bounds=private.semantic_time_bounds(owner_id,period);progress=private.semantic_progress(owner_id,bounds);
 if progress->>'status'='disabled' then return progress||jsonb_build_object('themes','[]'::jsonb);end if;
 with members as materialized(select * from private.visible_theme_members(owner_id,period)),summary as(
 select m.theme_id,count(distinct m.note_id)::integer note_count,min(m.created_at) first_at,max(m.created_at) last_at,
 count(distinct m.note_id) filter(where m.created_at is null)::integer unknown_dates,
 count(distinct m.note_id) filter(where m.created_at is not null)>=3 and count(distinct (m.created_at at time zone (bounds->>'timezone'))::date)>=2 recurring
 from members m group by m.theme_id having count(distinct m.note_id)>=2),selected as(select * from summary order by note_count desc,last_at desc nulls last,theme_id limit 8)
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'label',coalesce(t.user_label,t.generated_label),'generated_label',t.generated_label,'description',t.description,'note_count',s.note_count,'first_at',s.first_at,'last_at',s.last_at,'unknown_dates',s.unknown_dates,'recurring',s.recurring,'months',
 coalesce((select jsonb_agg(to_jsonb(b) order by b.month) from(select to_char(m.created_at at time zone (bounds->>'timezone'),'YYYY-MM') as month,count(distinct m.note_id)::integer note_count from members m where m.theme_id=t.id and m.created_at is not null group by 1)b),'[]'::jsonb)) order by s.note_count desc,s.last_at desc nulls last,t.id),'[]') into groups from selected s join public.note_themes t on t.id=s.theme_id and t.user_id=owner_id;
 select count(*) into hidden from public.note_themes t where t.user_id=owner_id and (t.dismissed or not exists(select 1 from private.visible_theme_members(owner_id,period)m where m.theme_id=t.id));
 return progress||jsonb_build_object('themes',groups,'hidden_groups',hidden);
end $$;
create or replace function private.read_note_theme_members(target_id uuid,period text,page_offset integer) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare owner_id uuid=auth.uid(); result jsonb;
begin
 if owner_id is null then raise insufficient_privilege using message='Sign in to explore themes.'; end if;
 if period is null or period not in ('all','recent') or page_offset is null or page_offset not between 0 and 5000 then raise invalid_parameter_value using message='Invalid theme page.'; end if;
 with members as materialized(select * from private.visible_theme_members(owner_id,period) where theme_id=target_id)
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc nulls last,x.note_id),'[]') into result from (
 select * from members where (select count(distinct note_id) from members)>=2 order by created_at desc nulls last,note_id limit 21 offset page_offset) x;
 return result;
end $$;
revoke all on function private.semantic_time_bounds(uuid,text,timestamptz,timestamptz,text),private.semantic_progress(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.semantic_time_bounds(uuid,text,timestamptz,timestamptz,text),private.semantic_progress(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
