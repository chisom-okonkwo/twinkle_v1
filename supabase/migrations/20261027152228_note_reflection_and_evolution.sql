-- FR-21/22. On-demand, bounded reflection; no new scheduled or push work.
create table private.reflection_runs (
 user_id uuid not null references auth.users(id) on delete cascade,
 scope text not null check(scope in ('note','theme')),target_id uuid not null,
 input_hash text not null,source_ids uuid[] not null,status text not null check(status in ('processing','completed','failed')),
 token uuid not null,started_at timestamptz not null default now(),attempts integer not null default 1,
 comparisons jsonb not null default '[]',primary key(user_id,scope,target_id)
);
create index reflection_runs_sources on private.reflection_runs using gin(source_ids);
create table private.reflective_prompts (
 id uuid primary key default gen_random_uuid(),note_id uuid not null unique,user_id uuid not null references auth.users(id) on delete cascade,
 input_hash text not null,status text not null check(status in ('processing','ready','failed','none','dismissed','answered','stale')),
 question text,quote text,token uuid not null default gen_random_uuid(),attempts integer not null default 1,
 started_at timestamptz not null default now(),offered_at timestamptz,
 foreign key(note_id,user_id) references public.notes(id,user_id) on delete cascade,
 check(question is null or char_length(question) between 8 and 180),check(quote is null or char_length(quote) between 12 and 400)
);
create index reflective_prompts_owner_time on private.reflective_prompts(user_id,offered_at desc);
create table private.reflection_limits (
 user_id uuid primary key references auth.users(id) on delete cascade,
 window_start timestamptz not null default date_trunc('hour',now()),attempts integer not null default 0
);
create table public.note_reflections (
 prompt_id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 original_note_id uuid not null,response_note_id uuid not null unique,question text not null check(char_length(question) between 8 and 180),
 created_at timestamptz not null default now(),check(original_note_id<>response_note_id),
 foreign key(original_note_id,user_id) references public.notes(id,user_id) on delete cascade,
 foreign key(response_note_id,user_id) references public.notes(id,user_id) on delete cascade
);
create index note_reflections_original_owner on public.note_reflections(original_note_id,user_id);
create index note_reflections_owner on public.note_reflections(user_id);
alter table private.reflection_runs enable row level security;
alter table private.reflective_prompts enable row level security;
alter table private.reflection_limits enable row level security;
alter table public.note_reflections enable row level security;
revoke all on private.reflection_runs,private.reflective_prompts,private.reflection_limits,public.note_reflections from public,anon,authenticated;
grant all on private.reflection_runs,private.reflective_prompts,private.reflection_limits,public.note_reflections to service_role;
grant select on public.note_reflections to authenticated;
create policy reflection_read on public.note_reflections for select to authenticated using(user_id=(select auth.uid()));

create function private.reflection_allowed(target_id uuid,owner_id uuid) returns boolean language sql stable set search_path='' as $$
 select private.semantic_eligible(target_id,owner_id) and not exists(
 select 1 from public.flashbacks f where f.user_id=owner_id and f.note_id=target_id and f.status in ('dismissed','irrelevant'))
$$;
create function private.reflection_note(target_id uuid,owner_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',n.id,'title',n.title,'content',n.content,'captured_at',private.semantic_captured_at(n),
 'user_context',coalesce(c.user_context,''),'answer',coalesce(c.answer,''),'source',private.semantic_document(n.id,n.user_id)->'confirmed_source',
 'context',case when c.status='completed' and c.source_hash=private.note_context_hash(n.content) then c.generated_context else null end)
 from public.notes n left join public.note_contexts c on c.note_id=n.id and c.user_id=n.user_id
 where n.id=target_id and n.user_id=owner_id and private.reflection_allowed(n.id,owner_id)
 and octet_length(private.semantic_document(n.id,owner_id)::text)<=7000
$$;

-- Existing verified themes/FR-15 links, semantic candidates, and authored response
-- links supply candidates. The model never scans the whole collection.
create function private.reflection_input(owner_id uuid,kind text,target uuid) returns jsonb language plpgsql stable set search_path='' set statement_timeout='5s' as $$
declare result jsonb;
begin
 if kind not in ('note','theme','prompt') then raise exception 'INVALID_SCOPE';end if;
 if not exists(select 1 from public.context_preferences where user_id=owner_id and enabled) then return null;end if;
 if kind='theme' then
  if not exists(select 1 from public.note_themes where id=target and user_id=owner_id and not dismissed) then return null;end if;
 else
  if private.reflection_note(target,owner_id) is null then return null;end if;
 end if;
 with candidates as materialized (
  select target id,100.0 weight where kind in ('note','prompt')
  union all
  select m.note_id,90.0 from public.note_theme_members m join public.note_themes t on t.id=m.theme_id and t.user_id=m.user_id
  join private.note_embeddings e on e.note_id=m.note_id and e.user_id=m.user_id and e.model='text-embedding-3-small' and e.input_version=1 and e.status='ready' and e.input_hash=m.input_hash
  where kind='theme' and m.user_id=owner_id and m.theme_id=target and not t.dismissed
  union all
  select case when r.note_id=target then r.related_id else r.note_id end,r.score::numeric
  from public.note_relations r where kind='note' and r.user_id=owner_id and (r.note_id=target or r.related_id=target)
  union all
  select case when r.original_note_id=target then r.response_note_id else r.original_note_id end,100.0
  from public.note_reflections r where kind='note' and r.user_id=owner_id and (r.original_note_id=target or r.response_note_id=target)
  union all
  select case when r.note_a=target then r.note_b else r.note_a end,70+r.similarity*10
  from private.semantic_relations r
  join private.note_embeddings a on a.note_id=r.note_a and a.user_id=r.user_id and a.model=r.model and a.input_version=r.input_version and a.input_hash=r.hash_a and a.status='ready'
  join private.note_embeddings b on b.note_id=r.note_b and b.user_id=r.user_id and b.model=r.model and b.input_version=r.input_version and b.input_hash=r.hash_b and b.status='ready'
  where kind='note' and r.user_id=owner_id and (r.note_a=target or r.note_b=target) and r.similarity>=0.42
  union all
  select b.note_id,80.0 from public.note_theme_members a join public.note_theme_members b on b.theme_id=a.theme_id and b.user_id=a.user_id
  join public.note_themes t on t.id=a.theme_id and t.user_id=a.user_id and not t.dismissed
  join private.note_embeddings ea on ea.note_id=a.note_id and ea.user_id=a.user_id and ea.model='text-embedding-3-small' and ea.input_version=1 and ea.status='ready' and ea.input_hash=a.input_hash
  join private.note_embeddings eb on eb.note_id=b.note_id and eb.user_id=b.user_id and eb.model='text-embedding-3-small' and eb.input_version=1 and eb.status='ready' and eb.input_hash=b.input_hash
  where kind='note' and a.note_id=target and a.user_id=owner_id
 ), bounded as materialized (
  select id,max(weight) weight from candidates group by id order by max(weight) desc,id limit 64
 ), dated as materialized (
  select b.id,b.weight,private.semantic_captured_at(n) captured from bounded b join public.notes n on n.id=b.id and n.user_id=owner_id
  where private.semantic_captured_at(n) is not null and private.semantic_captured_at(n)<=now()
  and private.reflection_allowed(n.id,owner_id)
 ), ranked as (
  select *,row_number() over(order by captured,id) early,row_number() over(order by captured desc,id) late from dated
 ), picked as materialized (
  select id from ranked order by (id=target) desc,least(early,late),weight desc,id limit 8
 ), documents as materialized (
  select private.reflection_note(id,owner_id) doc from picked
 ) select coalesce(jsonb_agg(doc order by doc->>'captured_at',doc->>'id') filter(where doc is not null),'[]') into result from documents;
 return result;
end $$;

create function private.reflection_fingerprint(input jsonb) returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest('reflection-v1:'||input::text,'sha256'),'hex')
$$;

-- Service-only claims serialize paid work and reserve a small hourly allowance.
create function public.claim_reflection_analysis(caller_id uuid,kind text,target_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare input jsonb;fingerprint text;r private.reflection_runs;p private.reflective_prompts;claim uuid=gen_random_uuid();used integer;ids uuid[];
begin
 perform pg_advisory_xact_lock(hashtextextended(caller_id::text,1415));
 input=private.reflection_input(caller_id,kind,target_id);
 if input is null then return jsonb_build_object('status','unavailable');end if;
 fingerprint=private.reflection_fingerprint(input);
 if kind='prompt' then
  if not exists(select 1 from jsonb_array_elements(input) n where (n->>'id')::uuid=target_id and (n->>'captured_at')::timestamptz<=now()-interval '14 days') then return jsonb_build_object('status','too_recent');end if;
  select * into p from private.reflective_prompts where note_id=target_id and user_id=caller_id;
  if p.status in ('ready','none','dismissed','answered','stale') then return jsonb_build_object('status','cached');end if;
  if p.status='processing' and p.started_at>now()-interval '2 minutes' then return jsonb_build_object('status','processing');end if;
  if p.attempts>=3 or p.status='failed' and p.started_at>now()-interval '30 seconds' then return jsonb_build_object('status','limited');end if;
  if exists(select 1 from private.reflective_prompts where user_id=caller_id and note_id<>target_id and (offered_at>now()-interval '7 days' or status='processing' and started_at>now()-interval '2 minutes')) then return jsonb_build_object('status','cooldown');end if;
 else
  if not exists(select 1 from jsonb_array_elements(input) a,jsonb_array_elements(input) b where (b->>'captured_at')::timestamptz-(a->>'captured_at')::timestamptz>=interval '14 days') then return jsonb_build_object('status','insufficient');end if;
  select * into r from private.reflection_runs where user_id=caller_id and scope=kind and reflection_runs.target_id=claim_reflection_analysis.target_id;
  if r.input_hash=fingerprint then
   if r.status='completed' then return jsonb_build_object('status','cached');end if;
   if r.status='processing' and r.started_at>now()-interval '2 minutes' then return jsonb_build_object('status','processing');end if;
   if r.attempts>=3 or r.status='failed' and r.started_at>now()-interval '30 seconds' then return jsonb_build_object('status','limited');end if;
  end if;
 end if;
 insert into private.reflection_limits(user_id) values(caller_id) on conflict do nothing;
 update private.reflection_limits set attempts=case when window_start=date_trunc('hour',now()) then attempts+1 else 1 end,window_start=date_trunc('hour',now()) where user_id=caller_id returning attempts into used;
 if used>6 then return jsonb_build_object('status','budget');end if;
 if kind='prompt' then
  insert into private.reflective_prompts(note_id,user_id,input_hash,status,token) values(target_id,caller_id,fingerprint,'processing',claim)
  on conflict(note_id) do update set input_hash=excluded.input_hash,status='processing',token=claim,attempts=private.reflective_prompts.attempts+1,started_at=now();
 else
  select array_agg((n->>'id')::uuid) into ids from jsonb_array_elements(input)n;
  insert into private.reflection_runs(user_id,scope,target_id,input_hash,source_ids,status,token) values(caller_id,kind,target_id,fingerprint,ids,'processing',claim)
  on conflict on constraint reflection_runs_pkey do update set input_hash=excluded.input_hash,source_ids=excluded.source_ids,status='processing',token=claim,started_at=now(),comparisons='[]',attempts=case when reflection_runs.input_hash=excluded.input_hash then reflection_runs.attempts+1 else 1 end;
 end if;
 return jsonb_build_object('status','claimed','token',claim,'hash',fingerprint,'notes',input);
end $$;

create function public.finish_reflection_analysis(caller_id uuid,kind text,target_id uuid,claim_token uuid,expected_hash text,result jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare input jsonb;item jsonb;a jsonb;b jsonb;fingerprint text;
begin
 perform pg_advisory_xact_lock(hashtextextended(caller_id::text,1415));
 input=private.reflection_input(caller_id,kind,target_id);fingerprint=private.reflection_fingerprint(input);
 if input is null or fingerprint is distinct from expected_hash then return false;end if;
 if kind='prompt' then
  if result is not null and result<>'null'::jsonb then
   select n into a from jsonb_array_elements(input)n where (n->>'id')::uuid=target_id;
   if jsonb_typeof(result) is distinct from 'object' or not(result ?& array['question','quote']) or result->>'question' is null or result->>'quote' is null or char_length(result->>'question') not between 8 and 180 or char_length(result->>'quote') not between 12 and 400 or position(private.theme_text(result->>'quote') in private.theme_text(a->>'content'))=0 then raise exception 'INVALID_RESULT';end if;
  end if;
  update private.reflective_prompts set status=case when result is null or result='null'::jsonb then 'none' else 'ready' end,question=result->>'question',quote=result->>'quote',offered_at=case when result is null or result='null'::jsonb then null else now() end
  where note_id=target_id and user_id=caller_id and token=claim_token and input_hash=expected_hash and status='processing';
 else
  if jsonb_typeof(result) is distinct from 'array' or jsonb_array_length(result)>3 then raise exception 'INVALID_RESULT';end if;
  for item in select value from jsonb_array_elements(result) loop
   select n into a from jsonb_array_elements(input)n where n->>'id'=item->>'earlier_id';
   select n into b from jsonb_array_elements(input)n where n->>'id'=item->>'later_id';
   if not(item ?& array['kind','earlier_id','later_id','earlier_quote','later_quote','observation']) or item->>'observation' is null or item->>'earlier_quote' is null or item->>'later_quote' is null or a is null or b is null or (b->>'captured_at')::timestamptz-(a->>'captured_at')::timestamptz<interval '14 days'
    or item->>'kind' not in ('change','continuity','unresolved') or char_length(item->>'observation') not between 20 and 480
    or char_length(item->>'earlier_quote') not between 12 and 400 or char_length(item->>'later_quote') not between 12 and 400
    or position(private.theme_text(item->>'earlier_quote') in private.theme_text(a->>'content'))=0 or position(private.theme_text(item->>'later_quote') in private.theme_text(b->>'content'))=0
    or kind='note' and target_id::text not in (item->>'earlier_id',item->>'later_id') then raise exception 'INVALID_RESULT';end if;
  end loop;
  update private.reflection_runs set status='completed',comparisons=result where user_id=caller_id and scope=kind and reflection_runs.target_id=finish_reflection_analysis.target_id and token=claim_token and input_hash=expected_hash and status='processing';
 end if;
 return found;
end $$;
create function public.fail_reflection_analysis(caller_id uuid,kind text,target_id uuid,claim_token uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 if kind='prompt' then update private.reflective_prompts set status='failed' where user_id=caller_id and note_id=target_id and token=claim_token and status='processing';
 else update private.reflection_runs set status='failed' where user_id=caller_id and scope=kind and reflection_runs.target_id=fail_reflection_analysis.target_id and token=claim_token and status='processing';end if;
end $$;

-- Authenticated read wrappers derive their owner. No owner IDs from clients.
create function private.read_reflection_experience(kind text,target uuid) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare owner_id uuid=auth.uid();input jsonb;r private.reflection_runs;p private.reflective_prompts;responses jsonb;status text;prompt jsonb=null;can_prompt boolean=false;
begin
 if owner_id is null or kind not in ('note','theme') then raise insufficient_privilege;end if;
 if kind='note' and not exists(select 1 from public.notes where id=target and user_id=owner_id) or kind='theme' and not exists(select 1 from public.note_themes where id=target and user_id=owner_id and not dismissed) then raise exception 'NOT_FOUND';end if;
 input=private.reflection_input(owner_id,kind,target);
 select * into r from private.reflection_runs where user_id=owner_id and scope=kind and target_id=target;
 status=case when input is null then 'disabled' when jsonb_array_length(input)<2 then 'insufficient'
 when r.input_hash=private.reflection_fingerprint(input) then case when r.status='processing' and r.started_at<now()-interval '2 minutes' then 'failed' else r.status end else 'not_started' end;
 if kind='note' then
  select * into p from private.reflective_prompts where note_id=target and user_id=owner_id;
  if input is not null and p.status='ready' and p.input_hash=private.reflection_fingerprint(private.reflection_input(owner_id,'prompt',target)) then
   prompt=jsonb_build_object('id',p.id,'question',p.question,'quote',p.quote);
  end if;
  can_prompt=input is not null and (p.note_id is null or p.status='failed' and p.attempts<3) and exists(select 1 from jsonb_array_elements(input)n where n->>'id'=target::text and (n->>'captured_at')::timestamptz<=now()-interval '14 days')
  and not exists(select 1 from private.reflective_prompts where user_id=owner_id and note_id<>target and (offered_at>now()-interval '7 days' or status='processing' and started_at>now()-interval '2 minutes'));
  select coalesce(jsonb_agg(jsonb_build_object('id',r.response_note_id,'question',r.question,'created_at',r.created_at,'title',n.title,'preview',left(n.content,320)) order by r.created_at desc),'[]') into responses
  from public.note_reflections r join public.notes n on n.id=r.response_note_id and n.user_id=r.user_id where r.original_note_id=target and r.user_id=owner_id;
 end if;
 return jsonb_build_object('status',status,'comparisons',case when status='completed' then r.comparisons else '[]'::jsonb end,
 'notes',coalesce((select jsonb_agg(jsonb_build_object('id',n->>'id','title',n->>'title','captured_at',n->>'captured_at')) from jsonb_array_elements(input)n),'[]'),
 'prompt',prompt,'can_prompt',coalesce(can_prompt,false),'prompt_status',case when p.status='processing' and p.started_at<now()-interval '2 minutes' then 'failed' else p.status end,'responses',coalesce(responses,'[]'));
end $$;
create function public.read_reflection_experience(kind text,target_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.read_reflection_experience(kind,target_id) $$;

create function private.dismiss_reflective_prompt(target uuid) returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid=auth.uid();begin
 if owner_id is null then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,1415));
 update private.reflective_prompts set status='dismissed',question=null,quote=null where id=target and user_id=owner_id and status in ('ready','failed','none');
 if not found then raise exception 'NOT_FOUND';end if;
end $$;
create function public.dismiss_reflective_prompt(prompt_id uuid) returns void language sql security invoker set search_path='' as $$ select private.dismiss_reflective_prompt(prompt_id) $$;
create function private.answer_reflective_prompt(target uuid,body text) returns uuid language plpgsql security definer set search_path='' as $$
declare owner_id uuid=auth.uid();p private.reflective_prompts;existing uuid;response_id uuid=gen_random_uuid();heading text;
begin
 if owner_id is null then raise insufficient_privilege;end if;
 if body is null or btrim(body)='' or char_length(body)>100000 then raise exception 'INVALID_RESPONSE';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,1415));
 select response_note_id into existing from public.note_reflections where prompt_id=target and user_id=owner_id;
 if existing is not null then return existing;end if;
 select * into p from private.reflective_prompts where id=target and user_id=owner_id for update;
 if p.status is distinct from 'ready' or p.input_hash is distinct from private.reflection_fingerprint(private.reflection_input(owner_id,'prompt',p.note_id)) then raise exception 'PROMPT_CHANGED';end if;
 select case when title='' then 'A reflection' else 'Revisiting: '||left(title,140) end into heading from public.notes where id=p.note_id and user_id=owner_id;
 insert into public.notes(id,user_id,title,content,capture_method) values(response_id,owner_id,heading,body,'text');
 insert into public.note_reflections(prompt_id,user_id,original_note_id,response_note_id,question) values(p.id,owner_id,p.note_id,response_id,p.question);
 update private.reflective_prompts set status='answered',question=null,quote=null where id=p.id;
 return response_id;
end $$;
create function public.answer_reflective_prompt(prompt_id uuid,body text) returns uuid language sql security invoker set search_path='' as $$ select private.answer_reflective_prompt(prompt_id,body) $$;

-- Edits invalidate generated work only. Answers remain ordinary user-authored
-- notes; deleting an original removes its association, not the author's answer.
create function private.invalidate_reflections() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;target uuid;
begin
 if tg_table_name='context_preferences' then
  if new.enabled or tg_op='UPDATE' and new.enabled=old.enabled then return null;end if;owner_id=new.user_id;
 else
  owner_id=case when tg_op='DELETE' then old.user_id else new.user_id end;
  if tg_table_name='notes' then
   if tg_op='UPDATE' and (new.title,new.content,new.created_at,new.import_metadata) is not distinct from (old.title,old.content,old.created_at,old.import_metadata) then return null;end if;
   target=case when tg_op='DELETE' then old.id else new.id end;
  else
   if tg_op='UPDATE' and to_jsonb(new)=to_jsonb(old) then return null;end if;
   target=case when tg_op='DELETE' then old.note_id else new.note_id end;
  end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,1415));
 delete from private.reflection_runs where user_id=owner_id and (target is null or target=any(source_ids) or target_id=target);
 update private.reflective_prompts set status='stale',question=null,quote=null where user_id=owner_id and (target is null or note_id=target) and status in ('ready','processing','failed','none');
 return null;
end $$;
create trigger reflection_note_changed after update of title,content,created_at,import_metadata or delete on public.notes for each row execute function private.invalidate_reflections();
create trigger reflection_context_changed after update of user_context,answer,generated_context on public.note_contexts for each row execute function private.invalidate_reflections();
create trigger reflection_source_changed after update on public.note_sources for each row execute function private.invalidate_reflections();
create trigger reflection_consent_changed after insert or update of enabled on public.context_preferences for each row execute function private.invalidate_reflections();
create trigger reflection_exclusion_changed after insert or delete on public.flashback_exclusions for each row execute function private.invalidate_reflections();

-- Default PostgreSQL EXECUTE is explicitly removed, including private helpers.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('reflection_allowed','reflection_note','reflection_input','reflection_fingerprint','read_reflection_experience','dismiss_reflective_prompt','answer_reflective_prompt','invalidate_reflections')
 loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
revoke all on function public.claim_reflection_analysis(uuid,text,uuid),public.finish_reflection_analysis(uuid,text,uuid,uuid,text,jsonb),public.fail_reflection_analysis(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_reflection_analysis(uuid,text,uuid),public.finish_reflection_analysis(uuid,text,uuid,uuid,text,jsonb),public.fail_reflection_analysis(uuid,text,uuid,uuid) to service_role;
revoke all on function public.read_reflection_experience(text,uuid),public.dismiss_reflective_prompt(uuid),public.answer_reflective_prompt(uuid,text) from public,anon;
grant execute on function private.read_reflection_experience(text,uuid),private.dismiss_reflective_prompt(uuid),private.answer_reflective_prompt(uuid,text),public.read_reflection_experience(text,uuid),public.dismiss_reflective_prompt(uuid),public.answer_reflective_prompt(uuid,text) to authenticated;
