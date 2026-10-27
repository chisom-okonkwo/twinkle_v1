-- Independent membership verification changes the paid-result cache version.
alter table private.semantic_group_jobs alter column prompt_version set default 3;
alter table private.semantic_usage add column request_count integer not null default 1 check(request_count between 0 and 2);
drop function public.record_semantic_usage(uuid,uuid,text,text,integer,integer,integer);
create function public.record_semantic_usage(caller_id uuid,call_id uuid,kind text,model text,input_tokens integer,output_tokens integer default 0,elapsed_ms integer default 0,request_count integer default 1) returns void language sql security invoker set search_path='' as $$
 insert into private.semantic_usage(call_id,user_id,kind,model,input_tokens,output_tokens,elapsed_ms,request_count) values(call_id,caller_id,kind,model,input_tokens,output_tokens,elapsed_ms,request_count) on conflict(call_id) do nothing
$$;
revoke all on function public.record_semantic_usage(uuid,uuid,text,text,integer,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.record_semantic_usage(uuid,uuid,text,text,integer,integer,integer,integer) to service_role;
-- Preserve identities and user feedback; obsolete generated memberships are not current evidence.
delete from public.note_theme_members m using private.semantic_group_jobs j where m.job_id=j.id and j.prompt_version<3;
update private.semantic_group_jobs set status='stale',token=null where prompt_version<3;
create or replace function public.semantic_scope_anchors(caller_id uuid,scope text) returns jsonb language sql stable security invoker set search_path='' set statement_timeout='8s' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',x.note_id,'hash',x.input_hash)),'[]') from(
 select e.note_id,e.input_hash from private.note_embeddings e join public.notes n on n.id=e.note_id and n.user_id=e.user_id
 join private.semantic_scopes s on s.user_id=e.user_id and s.scope_key=scope
 left join private.semantic_scope_notes done on done.user_id=e.user_id and done.note_id=e.note_id and done.scope_key=scope
 where e.user_id=caller_id and e.model='text-embedding-3-small' and e.input_version=1 and e.status='ready' and private.semantic_eligible(e.note_id,caller_id)
 and (s.range_start is null or private.semantic_captured_at(n)>=s.range_start and private.semantic_captured_at(n)<s.range_end)
 and (done.note_id is null or done.prompt_version<3 or done.input_hash<>e.input_hash) order by n.updated_at desc,n.id limit 16)x
$$;
create or replace function public.mark_semantic_no_candidates(caller_id uuid,scope text,target_id uuid,expected_hash text) returns void language sql security invoker set search_path='' as $$
 insert into private.semantic_scope_notes(user_id,scope_key,note_id,input_hash,outcome,prompt_version)
 select caller_id,scope,target_id,expected_hash,'no_candidates',3 where exists(select 1 from private.note_embeddings e where e.note_id=target_id and e.user_id=caller_id and e.input_hash=expected_hash and e.status='ready' and e.model='text-embedding-3-small' and e.input_version=1)
 on conflict(user_id,scope_key,note_id) do update set input_hash=excluded.input_hash,outcome=excluded.outcome,prompt_version=excluded.prompt_version,checked_at=now()
$$;
create or replace function public.enqueue_semantic_group(caller_id uuid,scope text,cores jsonb,model_name text) returns uuid language plpgsql security invoker set search_path='' as $$
declare ids uuid[];hashes jsonb;cache text;chosen uuid;
begin
 if jsonb_typeof(cores)<>'array' or jsonb_array_length(cores) not between 1 and 4 or char_length(model_name) not between 1 and 100 then raise exception 'INVALID_CORES';end if;
 select array_agg(distinct id::uuid order by id::uuid) into ids from jsonb_array_elements(cores)c cross join lateral jsonb_array_elements_text(c)id;
 if cardinality(ids) not between 2 and 24 then raise exception 'INVALID_CORE_NOTES';end if;
 select jsonb_object_agg(e.note_id::text,e.input_hash) into hashes from private.note_embeddings e where e.user_id=caller_id and e.note_id=any(ids) and e.status='ready' and e.model='text-embedding-3-small' and e.input_version=1 and private.semantic_eligible(e.note_id,caller_id);
 if (select count(*) from jsonb_object_keys(hashes))<>cardinality(ids) then raise exception 'STALE_CORE';end if;
 cache=encode(extensions.digest(model_name||':prompt-v3:'||hashes::text||':'||cores::text,'sha256'),'hex');
 insert into private.semantic_group_jobs(user_id,scope_key,cache_key,model,note_ids,fingerprints,cores)
 values(caller_id,scope,cache,model_name,ids,hashes,cores) on conflict(user_id,scope_key,cache_key) do update set status=case when private.semantic_group_jobs.status='stale' then 'pending' when private.semantic_group_jobs.status='completed' then 'validated' else private.semantic_group_jobs.status end
 returning id into chosen;
 if exists(select 1 from private.semantic_group_jobs where id=chosen and status='completed') then
  insert into private.semantic_scope_notes(user_id,scope_key,note_id,input_hash,outcome) select caller_id,scope,e.note_id,e.input_hash,'cached' from private.note_embeddings e where e.user_id=caller_id and e.note_id=any(ids) and e.model='text-embedding-3-small' and e.input_version=1 and e.status='ready'
  on conflict(user_id,scope_key,note_id) do update set input_hash=excluded.input_hash,outcome='cached',checked_at=now();
 end if;
 return chosen;
end $$;
create or replace function private.visible_theme_members(owner_id uuid,period text) returns table(theme_id uuid,note_id uuid,quote text,created_at timestamptz,title text,preview text,capture_method text)
language sql stable security invoker set search_path='' as $$
 select distinct on(m.theme_id,n.id)m.theme_id,n.id,m.quote,n.created_at,coalesce(nullif(n.title,''),nullif(left(split_part(btrim(n.content),E'\n',1),160),''),'Note with attachments'),left(n.content,600),n.capture_method
 from public.note_theme_members m join public.note_themes t on t.id=m.theme_id and t.user_id=m.user_id
 join public.notes n on n.id=m.note_id and n.user_id=m.user_id
 join private.note_embeddings e on e.note_id=n.id and e.user_id=n.user_id and e.input_hash=m.input_hash and e.status='ready' and e.model='text-embedding-3-small' and e.input_version=1
 join private.semantic_group_jobs j on j.id=m.job_id and j.user_id=m.user_id and j.status='completed' and j.prompt_version=3
 where m.user_id=owner_id and not t.dismissed and t.engine_version=2 and private.semantic_eligible(n.id,owner_id)
 and exists(select 1 from public.context_preferences where user_id=owner_id and enabled)
 and(period='all' or private.semantic_captured_at(n)>=now()-interval '90 days')
 and not exists(select 1 from public.related_note_dismissals d join public.note_theme_members a on a.theme_id=m.theme_id and a.user_id=owner_id and a.note_id=d.note_a join public.note_theme_members b on b.theme_id=m.theme_id and b.user_id=owner_id and b.note_id=d.note_b where d.user_id=owner_id)
 order by m.theme_id,n.id,j.completed_at desc,m.scope_key
$$;
create or replace function public.claim_semantic_group(caller_id uuid,scope text,run_token uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j private.semantic_group_jobs;nodes jsonb;known jsonb;used integer;
begin
 if not exists(select 1 from private.semantic_runs where user_id=caller_id and token=run_token and status='processing') or not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return null;end if;
 select * into j from private.semantic_group_jobs where user_id=caller_id and scope_key=scope and
 (status in ('pending','validated') or status='failed' and attempts<3 and available_at<=now() or status='processing' and started_at<now()-interval '2 minutes')
 order by (status='validated') desc,available_at,id limit 1 for update skip locked;
 if j.id is null then return null;end if;
 if j.status<>'validated' then
  update private.semantic_runs set validation_attempts=validation_attempts+2 where user_id=caller_id and token=run_token and validation_attempts<=22 returning validation_attempts into used;
  if used is null then return jsonb_build_object('status','budget');end if;
 end if;
 update private.semantic_group_jobs set token=gen_random_uuid(),started_at=now(),status=case when status='validated' then 'validated' else 'processing' end,attempts=case when status='validated' then attempts else attempts+1 end where id=j.id returning * into j;
 select jsonb_agg(public.semantic_note_payload(id,caller_id) order by id) into nodes from unnest(j.note_ids)id;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'label',t.generated_label,'description',t.description,'dismissed',t.dismissed)),'[]') into known from(
 select t.* from public.note_themes t where t.user_id=caller_id order by t.dismissed desc,(select count(distinct m.note_id) from public.note_theme_members m where m.theme_id=t.id and m.user_id=caller_id and m.note_id=any(j.note_ids)) desc,t.created_at desc limit 24)t;
 return jsonb_build_object('id',j.id,'token',j.token,'status',j.status,'cores',j.cores,'nodes',nodes,'known',known,'model',j.model,'result',j.result);
end $$;
create or replace function public.persist_semantic_validation(caller_id uuid,target_job uuid,claim_token uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j private.semantic_group_jobs;g jsonb;m jsonb;ids uuid[];chosen uuid;label_key text;original text;hash text;kept integer=0;hidden integer=0;total integer;old_label text;
begin
 -- Row lock order matches note edits/deletion: notes before derived jobs.
 perform 1 from public.notes where user_id=caller_id and id in(select unnest(note_ids) from private.semantic_group_jobs where id=target_job and user_id=caller_id) order by id for key share;
 select * into j from private.semantic_group_jobs where id=target_job and user_id=caller_id and token=claim_token for update;
 if j.status='completed' then return j.diagnostics;end if;
 if j.id is null or j.status<>'validated' or not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return jsonb_build_object('stale',true);end if;
 if exists(select 1 from unnest(j.note_ids)id where not exists(select 1 from private.note_embeddings e join public.notes n on n.id=e.note_id and n.user_id=e.user_id join private.semantic_scopes s on s.user_id=e.user_id and s.scope_key=j.scope_key
 where e.note_id=id and e.user_id=caller_id and e.status='ready' and e.model='text-embedding-3-small' and e.input_version=1 and e.input_hash=j.fingerprints->>id::text and private.semantic_eligible(id,caller_id)
 and(s.range_start is null or private.semantic_captured_at(n)>=s.range_start and private.semantic_captured_at(n)<s.range_end))) then
  update private.semantic_group_jobs set status='stale',token=null where id=j.id;return jsonb_build_object('stale',true);
 end if;
 if jsonb_typeof(j.result->'groups')<>'array' or jsonb_array_length(j.result->'groups')>6 then raise exception 'INVALID_GROUPS';end if;
 total=jsonb_array_length(j.result->'groups');
 for g in select * from jsonb_array_elements(j.result->'groups') loop
  if char_length(g->>'label') not between 2 and 80 or char_length(g->>'description') not between 1 and 240 or jsonb_typeof(g->'members')<>'array' or jsonb_array_length(g->'members') not between 2 and 24 then raise exception 'INVALID_GROUP';end if;
  select array_agg((x->>'id')::uuid) into ids from jsonb_array_elements(g->'members')x;
  if cardinality(ids)<>(select count(distinct id) from unnest(ids)id) or not ids<@j.note_ids then raise exception 'INVALID_MEMBERS';end if;
  if not exists(select 1 from jsonb_array_elements(j.cores)c where not exists(select 1 from unnest(ids)id where not c @> to_jsonb(array[id::text]))) then raise exception 'INCOHERENT_CORE';end if;
  if exists(select 1 from public.related_note_dismissals d where d.user_id=caller_id and d.note_a=any(ids) and d.note_b=any(ids)) then hidden=hidden+1;continue;end if;
  if (select count(distinct e.input_hash) from private.note_embeddings e where e.user_id=caller_id and e.note_id=any(ids) and e.model='text-embedding-3-small' and e.input_version=1)<>cardinality(ids) then hidden=hidden+1;continue;end if;
  for m in select * from jsonb_array_elements(g->'members') loop
   if m->>'field' not in ('title','content','user_context','answer','source_name','source_description') then raise exception 'INVALID_EVIDENCE_FIELD';end if;
   original=public.semantic_note_payload((m->>'id')::uuid,caller_id)->>(m->>'field');
   if char_length(m->>'quote') not between 2 and 400 or strpos(private.theme_text(original),private.theme_text(m->>'quote'))=0 then raise exception 'INVALID_EVIDENCE';end if;
  end loop;
  chosen=null;
  if nullif(g->>'existing_id','') is not null then
   select id into chosen from public.note_themes where user_id=caller_id and id=(g->>'existing_id')::uuid;
   if chosen is null then raise exception 'FOREIGN_THEME';end if;
  end if;
  label_key=encode(extensions.digest(lower(btrim(g->>'label')),'sha256'),'hex');
  if chosen is null then select id into chosen from public.note_themes where user_id=caller_id and theme_key=label_key;end if;
  if chosen is null then
   -- Near-identical sets merge, but a proper narrower subset remains distinct.
   select t.id into chosen from public.note_themes t join public.note_theme_members m on m.theme_id=t.id and m.user_id=t.user_id
   where t.user_id=caller_id group by t.id having count(distinct m.note_id) filter(where m.note_id=any(ids))>=2
   and count(distinct m.note_id) filter(where m.note_id=any(ids))::numeric/(count(distinct m.note_id)+cardinality(ids)-count(distinct m.note_id) filter(where m.note_id=any(ids)))>0.85
   order by count(distinct m.note_id) filter(where m.note_id=any(ids)) desc,t.id limit 1;
  end if;
  if exists(select 1 from private.semantic_theme_feedback f join public.note_themes t on t.id=f.theme_id and t.user_id=f.user_id where f.user_id=caller_id and t.dismissed and
   (select count(*) from unnest(f.note_ids)id where id=any(ids))>=2 and
   (select count(*) from unnest(f.note_ids)id where id=any(ids))::numeric/(cardinality(f.note_ids)+cardinality(ids)-(select count(*) from unnest(f.note_ids)id where id=any(ids)))>=0.75) then hidden=hidden+1;continue;end if;
  if chosen is null then
   if(select count(*) from public.note_themes where user_id=caller_id)>=200 then hidden=hidden+1;continue;end if;
   insert into public.note_themes(user_id,theme_key,generated_label,description,engine_version) values(caller_id,label_key,g->>'label',g->>'description',2) returning id into chosen;
  elsif exists(select 1 from public.note_themes where id=chosen and user_id=caller_id and dismissed) then hidden=hidden+1;continue;
  else update public.note_themes set engine_version=2 where id=chosen and user_id=caller_id;
  end if;
  for m in select * from jsonb_array_elements(g->'members') loop
   select input_hash into hash from private.note_embeddings where user_id=caller_id and note_id=(m->>'id')::uuid and model='text-embedding-3-small' and input_version=1;
   if exists(select 1 from public.note_theme_members where theme_id=chosen and scope_key=j.scope_key and input_hash=hash and note_id<>(m->>'id')::uuid) then continue;end if;
   insert into public.note_theme_members(theme_id,note_id,user_id,quote,content_hash,scope_key,input_hash,evidence_field,job_id)
   select chosen,n.id,caller_id,m->>'quote',private.note_context_hash(n.content),j.scope_key,hash,m->>'field',j.id from public.notes n where n.id=(m->>'id')::uuid and n.user_id=caller_id
   on conflict(theme_id,note_id,scope_key) do update set quote=excluded.quote,content_hash=excluded.content_hash,input_hash=excluded.input_hash,evidence_field=excluded.evidence_field,job_id=excluded.job_id;
  end loop;
  kept=kept+1;
 end loop;
 insert into private.semantic_scope_notes(user_id,scope_key,note_id,input_hash,outcome,prompt_version)
 select caller_id,j.scope_key,e.note_id,e.input_hash,'evaluated',j.prompt_version from private.note_embeddings e where e.user_id=caller_id and e.note_id=any(j.note_ids) and e.model='text-embedding-3-small' and e.input_version=1 and e.status='ready'
 on conflict(user_id,scope_key,note_id) do update set input_hash=excluded.input_hash,outcome=excluded.outcome,prompt_version=excluded.prompt_version,checked_at=now();
 update private.semantic_group_jobs set status='completed',completed_at=now(),outcome=case when total=0 and coalesce((j.result#>>'{verification,proposal_count}')::integer,0)>0 then 'verification_rejected' when total=0 then 'ai_empty' when kept=0 then 'suppressed' else 'supported' end,
 diagnostics=jsonb_build_object('candidates',cardinality(j.note_ids),'groups_proposed',total,'groups_saved',kept,'groups_suppressed',hidden,'verification',coalesce(j.result->'verification','{}'::jsonb)),error_code=null where id=j.id returning * into j;
 return j.diagnostics;
end $$;
notify pgrst,'reload schema';
