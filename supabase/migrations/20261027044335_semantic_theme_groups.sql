-- Replace production theme memberships, preserving identities and user feedback.
create table private.semantic_scopes (
 user_id uuid not null references auth.users(id) on delete cascade,scope_key text not null,
 range_start timestamptz,range_end timestamptz,timezone text not null default 'UTC',created_at timestamptz not null default now(),
 primary key(user_id,scope_key),check((range_start is null)=(range_end is null)),check(range_start<range_end)
);
create table private.semantic_scope_notes (
 user_id uuid not null,note_id uuid not null,scope_key text not null,input_hash text not null,
 outcome text not null check(outcome in ('no_candidates','evaluated','cached')),checked_at timestamptz not null default now(),
 primary key(user_id,scope_key,note_id),foreign key(user_id,scope_key) references private.semantic_scopes(user_id,scope_key) on delete cascade,
 foreign key(note_id,user_id) references public.notes(id,user_id) on delete cascade
);
create index semantic_scope_note_owner on private.semantic_scope_notes(note_id,user_id);
create table private.semantic_group_jobs (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,scope_key text not null,
 cache_key text not null,model text not null,prompt_version integer not null default 1,
 note_ids uuid[] not null,fingerprints jsonb not null,cores jsonb not null,
 status text not null default 'pending' check(status in ('pending','processing','validated','completed','failed','stale')),
 token uuid,started_at timestamptz,completed_at timestamptz,available_at timestamptz not null default now(),attempts integer not null default 0,
 result jsonb,error_code text,outcome text,diagnostics jsonb not null default '{}',
 unique(id,user_id),unique(user_id,scope_key,cache_key),foreign key(user_id,scope_key) references private.semantic_scopes(user_id,scope_key) on delete cascade,
 check(cardinality(note_ids) between 2 and 24)
);
create index semantic_job_owner_status on private.semantic_group_jobs(user_id,scope_key,status,available_at);
create table private.semantic_theme_feedback (
 theme_id uuid primary key,user_id uuid not null,note_ids uuid[] not null,updated_at timestamptz not null default now(),
 foreign key(theme_id,user_id) references public.note_themes(id,user_id) on delete cascade
);
create index semantic_feedback_theme_owner on private.semantic_theme_feedback(theme_id,user_id);
insert into private.semantic_theme_feedback(theme_id,user_id,note_ids)
 select t.id,t.user_id,array_agg(distinct m.note_id) from public.note_themes t join public.note_theme_members m on m.theme_id=t.id and m.user_id=t.user_id where t.dismissed group by t.id,t.user_id;
-- Old memberships used different evidence rules. Keep labels/corrections/dismissals.
delete from public.note_theme_members;
alter table public.note_themes add column engine_version integer not null default 1;
alter table public.note_theme_members drop constraint note_theme_members_pkey;
alter table public.note_theme_members drop constraint note_theme_members_theme_id_content_hash_key;
alter table public.note_theme_members add column scope_key text not null default 'all',add column input_hash text not null default '',add column evidence_field text not null default 'content',add column job_id uuid;
alter table public.note_theme_members add primary key(theme_id,note_id,scope_key),add unique(theme_id,scope_key,input_hash),
 add foreign key(job_id,user_id) references private.semantic_group_jobs(id,user_id) on delete cascade;
create index semantic_member_job_owner on public.note_theme_members(job_id,user_id);

alter table private.semantic_scopes enable row level security;alter table private.semantic_scope_notes enable row level security;alter table private.semantic_group_jobs enable row level security;alter table private.semantic_theme_feedback enable row level security;
revoke all on private.semantic_scopes,private.semantic_scope_notes,private.semantic_group_jobs,private.semantic_theme_feedback from public,anon,authenticated;
grant all on private.semantic_scopes,private.semantic_scope_notes,private.semantic_group_jobs,private.semantic_theme_feedback to service_role;
create function private.semantic_theme_feedback_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.dismissed then
  insert into private.semantic_theme_feedback(theme_id,user_id,note_ids) select new.id,new.user_id,coalesce(array_agg(distinct note_id),'{}') from public.note_theme_members where theme_id=new.id and user_id=new.user_id
  on conflict(theme_id) do update set note_ids=case when cardinality(excluded.note_ids)>0 then excluded.note_ids else private.semantic_theme_feedback.note_ids end,updated_at=now();
 end if;return null;
end $$;
create trigger semantic_theme_feedback_changed after update of dismissed on public.note_themes for each row execute function private.semantic_theme_feedback_changed();
create or replace function private.clear_semantic_derived(target_id uuid,owner_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 -- Cancel affected validations and coverage before deleting their old memberships.
 delete from private.semantic_scope_notes s where s.user_id=owner_id and (s.note_id=target_id or exists(select 1 from private.semantic_group_jobs j where j.user_id=owner_id and target_id=any(j.note_ids) and s.note_id=any(j.note_ids) and s.scope_key=j.scope_key));
 delete from public.note_theme_members where user_id=owner_id and (note_id=target_id or job_id in(select id from private.semantic_group_jobs where user_id=owner_id and target_id=any(note_ids)));
 update private.semantic_group_jobs set status='stale',token=null,result=null where user_id=owner_id and target_id=any(note_ids);
 delete from private.semantic_relations where user_id=owner_id and (note_a=target_id or note_b=target_id);
end $$;
create function private.semantic_note_deleted() returns trigger language plpgsql security definer set search_path='' as $$begin perform private.clear_semantic_derived(old.id,old.user_id);return null;end $$;
create trigger semantic_note_deleted after delete on public.notes for each row execute function private.semantic_note_deleted();

create function public.prepare_semantic_scope(caller_id uuid,period text default 'all',range_start timestamptz default null,range_end timestamptz default null,zone text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare tz text;begin_at timestamptz;end_at timestamptz;key text;today date;
begin
 if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then raise exception 'CONTEXT_DISABLED';end if;
 tz=coalesce(zone,(select timezone from public.recall_preferences where user_id=caller_id),'UTC');
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then raise exception 'INVALID_TIMEZONE';end if;
 if period='all' then key='all';
 elsif period='recent' then today=(now() at time zone tz)::date;begin_at=(today-89)::timestamp at time zone tz;end_at=(today+1)::timestamp at time zone tz;
 elsif period='custom' and range_start is not null and range_end is not null and range_start<range_end then begin_at=range_start;end_at=range_end;
 else raise exception 'INVALID_RANGE';end if;
 if key is null then key=encode(extensions.digest(tz||':'||begin_at::text||':'||end_at::text,'sha256'),'hex');end if;
 if not exists(select 1 from private.semantic_scopes where user_id=caller_id and scope_key=key) and (select count(*) from private.semantic_scopes where user_id=caller_id)>31 then
  delete from private.semantic_scopes where user_id=caller_id and scope_key<>'all' and created_at<now()-interval '90 days';
  if (select count(*) from private.semantic_scopes where user_id=caller_id)>31 then raise exception 'SCOPE_LIMIT';end if;
 end if;
 insert into private.semantic_scopes(user_id,scope_key,range_start,range_end,timezone) values(caller_id,key,begin_at,end_at,tz) on conflict(user_id,scope_key) do nothing;
 return jsonb_build_object('key',key,'start',begin_at,'end',end_at,'timezone',tz);
end $$;
create function public.semantic_scope_anchors(caller_id uuid,scope text) returns jsonb language sql stable security invoker set search_path='' set statement_timeout='8s' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',x.note_id,'hash',x.input_hash)),'[]') from(
 select e.note_id,e.input_hash from private.note_embeddings e join public.notes n on n.id=e.note_id and n.user_id=e.user_id
 join private.semantic_scopes s on s.user_id=e.user_id and s.scope_key=scope
 left join private.semantic_scope_notes done on done.user_id=e.user_id and done.note_id=e.note_id and done.scope_key=scope
 where e.user_id=caller_id and e.model='text-embedding-3-small' and e.input_version=1 and e.status='ready' and private.semantic_eligible(e.note_id,caller_id)
 and (s.range_start is null or private.semantic_captured_at(n)>=s.range_start and private.semantic_captured_at(n)<s.range_end)
 and (done.note_id is null or done.input_hash<>e.input_hash) order by n.updated_at desc,n.id limit 16)x
$$;
create function public.semantic_note_payload(target_id uuid,caller_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',n.id,'hash',e.input_hash,'title',n.title,'content',n.content,'user_context',coalesce(c.user_context,''),'answer',coalesce(c.answer,''),
 'source_name',coalesce(s.name,''),'source_description',coalesce(s.description,''),'source_type',s.source_type)
 from public.notes n join private.note_embeddings e on e.note_id=n.id and e.user_id=n.user_id and e.model='text-embedding-3-small' and e.input_version=1 and e.status='ready'
 left join public.note_contexts c on c.note_id=n.id and c.user_id=n.user_id left join public.note_sources s on s.note_id=n.id and s.user_id=n.user_id
 where n.id=target_id and n.user_id=caller_id and private.semantic_eligible(n.id,caller_id)
$$;
create function public.semantic_candidate_graph(target_id uuid,caller_id uuid,scope text) returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='8s' as $$
declare s private.semantic_scopes;ids uuid[];nodes jsonb;edges jsonb;
begin
 select * into s from private.semantic_scopes where user_id=caller_id and scope_key=scope;if s.user_id is null then raise exception 'SCOPE_NOT_FOUND';end if;
 if public.semantic_note_payload(target_id,caller_id) is null then return jsonb_build_object('nodes','[]'::jsonb,'edges','[]'::jsonb);end if;
 select array_prepend(target_id,coalesce(array_agg((n->>'id')::uuid),'{}')) into ids from jsonb_array_elements(public.semantic_neighbours(target_id,caller_id,12,s.range_start,s.range_end))n;
 select jsonb_agg(public.semantic_note_payload(id,caller_id) order by id) into nodes from unnest(ids)id;
 with owned as materialized(select e.* from private.note_embeddings e where e.user_id=caller_id and e.note_id=any(ids) and e.status='ready' and e.model='text-embedding-3-small' and e.input_version=1)
 select coalesce(jsonb_agg(jsonb_build_object('a',a.note_id,'b',b.note_id,'similarity',greatest(-1,least(1,1-(a.embedding operator(extensions.<=>) b.embedding))),
 'related',exists(select 1 from public.note_relations r join public.notes na on na.id=r.note_id and na.user_id=r.user_id join public.notes nb on nb.id=r.related_id and nb.user_id=r.user_id
 where r.user_id=caller_id and r.score>=85 and least(r.note_id,r.related_id)=a.note_id and greatest(r.note_id,r.related_id)=b.note_id
 and strpos(private.theme_text(na.content),private.theme_text(r.origin_quote))>0 and strpos(private.theme_text(nb.content),private.theme_text(r.related_quote))>0))),'[]') into edges from owned a join owned b on a.note_id<b.note_id;
 return jsonb_build_object('nodes',nodes,'edges',edges);
end $$;
create function public.mark_semantic_no_candidates(caller_id uuid,scope text,target_id uuid,expected_hash text) returns void language sql security invoker set search_path='' as $$
 insert into private.semantic_scope_notes(user_id,scope_key,note_id,input_hash,outcome)
 select caller_id,scope,target_id,expected_hash,'no_candidates' where exists(select 1 from private.note_embeddings e where e.note_id=target_id and e.user_id=caller_id and e.input_hash=expected_hash and e.status='ready' and e.model='text-embedding-3-small' and e.input_version=1)
 on conflict(user_id,scope_key,note_id) do update set input_hash=excluded.input_hash,outcome=excluded.outcome,checked_at=now()
$$;
create function public.enqueue_semantic_group(caller_id uuid,scope text,cores jsonb,model_name text) returns uuid language plpgsql security invoker set search_path='' as $$
declare ids uuid[];hashes jsonb;cache text;chosen uuid;
begin
 if jsonb_typeof(cores)<>'array' or jsonb_array_length(cores) not between 1 and 4 or char_length(model_name) not between 1 and 100 then raise exception 'INVALID_CORES';end if;
 select array_agg(distinct id::uuid order by id::uuid) into ids from jsonb_array_elements(cores)c cross join lateral jsonb_array_elements_text(c)id;
 if cardinality(ids) not between 2 and 24 then raise exception 'INVALID_CORE_NOTES';end if;
 select jsonb_object_agg(e.note_id::text,e.input_hash) into hashes from private.note_embeddings e where e.user_id=caller_id and e.note_id=any(ids) and e.status='ready' and e.model='text-embedding-3-small' and e.input_version=1 and private.semantic_eligible(e.note_id,caller_id);
 if (select count(*) from jsonb_object_keys(hashes))<>cardinality(ids) then raise exception 'STALE_CORE';end if;
 cache=encode(extensions.digest(model_name||':prompt-v1:'||hashes::text||':'||cores::text,'sha256'),'hex');
 insert into private.semantic_group_jobs(user_id,scope_key,cache_key,model,note_ids,fingerprints,cores)
 values(caller_id,scope,cache,model_name,ids,hashes,cores) on conflict(user_id,scope_key,cache_key) do update set status=case when private.semantic_group_jobs.status='stale' then 'pending' else private.semantic_group_jobs.status end
 returning id into chosen;
 if exists(select 1 from private.semantic_group_jobs where id=chosen and status='completed') then
  insert into private.semantic_scope_notes(user_id,scope_key,note_id,input_hash,outcome) select caller_id,scope,e.note_id,e.input_hash,'cached' from private.note_embeddings e where e.user_id=caller_id and e.note_id=any(ids) and e.model='text-embedding-3-small' and e.input_version=1 and e.status='ready'
  on conflict(user_id,scope_key,note_id) do update set input_hash=excluded.input_hash,outcome='cached',checked_at=now();
 end if;
 return chosen;
end $$;
create function public.claim_semantic_group(caller_id uuid,scope text,run_token uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j private.semantic_group_jobs;nodes jsonb;known jsonb;used integer;
begin
 if not exists(select 1 from private.semantic_runs where user_id=caller_id and token=run_token and status='processing') or not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return null;end if;
 select * into j from private.semantic_group_jobs where user_id=caller_id and scope_key=scope and
 (status in ('pending','validated') or status='failed' and attempts<3 and available_at<=now() or status='processing' and started_at<now()-interval '2 minutes')
 order by (status='validated') desc,available_at,id limit 1 for update skip locked;
 if j.id is null then return null;end if;
 if j.status<>'validated' then
  update private.semantic_runs set validation_attempts=validation_attempts+1 where user_id=caller_id and token=run_token and validation_attempts<24 returning validation_attempts into used;
  if used is null then return jsonb_build_object('status','budget');end if;
 end if;
 update private.semantic_group_jobs set token=gen_random_uuid(),started_at=now(),status=case when status='validated' then 'validated' else 'processing' end,attempts=case when status='validated' then attempts else attempts+1 end where id=j.id returning * into j;
 select jsonb_agg(public.semantic_note_payload(id,caller_id) order by id) into nodes from unnest(j.note_ids)id;
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'label',t.generated_label,'description',t.description,'dismissed',t.dismissed)),'[]') into known from(
 select t.* from public.note_themes t where t.user_id=caller_id order by t.dismissed desc,(select count(distinct m.note_id) from public.note_theme_members m where m.theme_id=t.id and m.user_id=caller_id and m.note_id=any(j.note_ids)) desc,t.created_at desc limit 24)t;
 return jsonb_build_object('id',j.id,'token',j.token,'status',j.status,'cores',j.cores,'nodes',nodes,'known',known,'model',j.model,'result',j.result);
end $$;
create function public.cache_semantic_validation(caller_id uuid,target_job uuid,claim_token uuid,result jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare j private.semantic_group_jobs;
begin
 perform 1 from public.notes where user_id=caller_id and id=any((select note_ids from private.semantic_group_jobs where id=target_job and user_id=caller_id)) order by id for key share;
 select * into j from private.semantic_group_jobs where id=target_job and user_id=caller_id and token=claim_token and status in ('processing','validated') for update;
 if j.status='validated' and j.result=cache_semantic_validation.result then return true;end if;
 if j.id is null or not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return false;end if;
 if exists(select 1 from unnest(j.note_ids)id where not exists(select 1 from private.note_embeddings e where e.note_id=id and e.user_id=caller_id and e.status='ready' and e.model='text-embedding-3-small' and e.input_version=1 and e.input_hash=j.fingerprints->>id::text and private.semantic_eligible(id,caller_id))) then
  update private.semantic_group_jobs set status='stale',token=null where id=j.id;return false;
 end if;
 update private.semantic_group_jobs set status='validated',result=cache_semantic_validation.result,error_code=null where id=j.id;return true;
end $$;
create function public.persist_semantic_validation(caller_id uuid,target_job uuid,claim_token uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j private.semantic_group_jobs;g jsonb;m jsonb;ids uuid[];chosen uuid;label_key text;original text;hash text;kept integer=0;hidden integer=0;total integer;old_label text;
begin
 -- Row lock order matches note edits/deletion: notes before derived jobs.
 perform 1 from public.notes where user_id=caller_id and id=any((select note_ids from private.semantic_group_jobs where id=target_job and user_id=caller_id)) order by id for key share;
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
  else update public.note_themes set generated_label=g->>'label',description=g->>'description',engine_version=2 where id=chosen and user_id=caller_id;
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
create function public.fail_semantic_group(caller_id uuid,target_job uuid,claim_token uuid,failure text) returns void language plpgsql security invoker set search_path='' as $$
begin
 if failure not in ('provider','timeout','invalid_output','persistence') then raise exception 'INVALID_FAILURE';end if;
 update private.semantic_group_jobs set status=case when status='validated' then 'validated' else 'failed' end,error_code=failure,available_at=now()+interval '2 minutes'
 where user_id=caller_id and id=target_job and token=claim_token and status in ('processing','validated');
end $$;
create function public.retry_semantic_groups(caller_id uuid) returns void language sql security invoker set search_path='' as $$
 update private.semantic_group_jobs set status='pending',attempts=0,available_at=now(),error_code=null where user_id=caller_id and status='failed'
$$;
-- An affected date scope needs new grouping, not a new embedding.
create function private.semantic_date_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.created_at=old.created_at then return null;end if;
 delete from private.semantic_scope_notes where user_id=new.user_id and scope_key in(select scope_key from private.semantic_scopes where user_id=new.user_id and range_start is not null);
 delete from public.note_theme_members where user_id=new.user_id and job_id in(select id from private.semantic_group_jobs j where j.user_id=new.user_id and new.id=any(j.note_ids) and j.scope_key<>'all');
 update private.semantic_group_jobs set status='stale',token=null,result=null where user_id=new.user_id and new.id=any(note_ids) and scope_key<>'all';
 return null;
end $$;
create trigger semantic_date_changed after update of created_at on public.notes for each row execute function private.semantic_date_changed();
create or replace function private.semantic_consent_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not new.enabled then
  update private.note_embeddings set embedding=null,status='deferred',token=null,error_code='consent' where user_id=new.user_id;
  update private.semantic_runs set token=null,status='idle' where user_id=new.user_id;
  update private.theme_state set enabled=false where user_id=new.user_id;
  delete from public.note_theme_members where user_id=new.user_id;
  delete from private.semantic_scope_notes where user_id=new.user_id;
  update private.semantic_group_jobs set status='stale',token=null,result=null where user_id=new.user_id;
 end if;return null;
end $$;
-- Retire old invalidation/claims, so context generation cannot erase valid
-- memberships whose faithful semantic inputs did not change.
drop trigger theme_notes_changed on public.notes;drop trigger theme_context_changed on public.note_contexts;drop trigger theme_sources_changed on public.note_sources;
drop trigger theme_consent_changed on public.context_preferences;drop trigger theme_exclusion_changed on public.flashback_exclusions;drop trigger theme_pair_feedback on public.related_note_dismissals;drop trigger theme_discovery_feedback on public.note_discovery_history;
create or replace function public.claim_note_themes(caller_id uuid,activate boolean default false,retry boolean default false) returns jsonb language sql security invoker set search_path='' as $$select jsonb_build_object('status','upgrading')$$;
create function private.semantic_pair_feedback_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare a uuid; b uuid;owner_id uuid;
begin
 if tg_op='DELETE' then a=old.note_a;b=old.note_b;owner_id=old.user_id;else a=new.note_a;b=new.note_b;owner_id=new.user_id;end if;
 delete from private.semantic_scope_notes where user_id=owner_id and note_id in(a,b);
 delete from public.note_theme_members where user_id=owner_id and job_id in(select id from private.semantic_group_jobs where user_id=owner_id and a=any(note_ids) and b=any(note_ids));
 update private.semantic_group_jobs set status='stale',token=null,result=null where user_id=owner_id and a=any(note_ids) and b=any(note_ids);
 return null;
end $$;
create trigger semantic_pair_feedback_changed after insert or delete on public.related_note_dismissals for each row execute function private.semantic_pair_feedback_changed();
do $$declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in
 ('semantic_theme_feedback_changed','semantic_note_deleted','prepare_semantic_scope','semantic_scope_anchors','semantic_note_payload','semantic_candidate_graph','mark_semantic_no_candidates','enqueue_semantic_group','claim_semantic_group','cache_semantic_validation','persist_semantic_validation','fail_semantic_group','retry_semantic_groups','semantic_date_changed','semantic_pair_feedback_changed') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
