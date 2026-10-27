-- ANY(subquery) compares rows, not array elements. Lock individual note IDs.
create or replace function public.cache_semantic_validation(caller_id uuid,target_job uuid,claim_token uuid,result jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare j private.semantic_group_jobs;
begin
 perform 1 from public.notes where user_id=caller_id and id in(select unnest(note_ids) from private.semantic_group_jobs where id=target_job and user_id=caller_id) order by id for key share;
 select * into j from private.semantic_group_jobs where id=target_job and user_id=caller_id and token=claim_token and status in ('processing','validated') for update;
 if j.status='validated' and j.result=cache_semantic_validation.result then return true;end if;
 if j.id is null or not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return false;end if;
 if exists(select 1 from unnest(j.note_ids)id where not exists(select 1 from private.note_embeddings e where e.note_id=id and e.user_id=caller_id and e.status='ready' and e.model='text-embedding-3-small' and e.input_version=1 and e.input_hash=j.fingerprints->>id::text and private.semantic_eligible(id,caller_id))) then
  update private.semantic_group_jobs set status='stale',token=null where id=j.id;return false;
 end if;
 update private.semantic_group_jobs set status='validated',result=cache_semantic_validation.result,error_code=null where id=j.id;return true;
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
 insert into private.semantic_scope_notes(user_id,scope_key,note_id,input_hash,outcome)
 select caller_id,j.scope_key,e.note_id,e.input_hash,'evaluated' from private.note_embeddings e where e.user_id=caller_id and e.note_id=any(j.note_ids) and e.model='text-embedding-3-small' and e.input_version=1 and e.status='ready'
 on conflict(user_id,scope_key,note_id) do update set input_hash=excluded.input_hash,outcome=excluded.outcome,checked_at=now();
 update private.semantic_group_jobs set status='completed',completed_at=now(),outcome=case when total=0 then 'ai_empty' when kept=0 then 'suppressed' else 'supported' end,
 diagnostics=jsonb_build_object('candidates',cardinality(j.note_ids),'groups_proposed',total,'groups_saved',kept,'groups_suppressed',hidden),error_code=null where id=j.id returning * into j;
 return j.diagnostics;
end $$;
