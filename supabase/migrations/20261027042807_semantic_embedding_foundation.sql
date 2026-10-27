-- FR-19/20 semantic foundation. Derived data stays private and model-compatible.
create extension if not exists vector with schema extensions;
create table private.note_embeddings (
 note_id uuid not null,user_id uuid not null references auth.users(id) on delete cascade,
 model text not null default 'text-embedding-3-small',input_version integer not null default 1,
 input_hash text not null,embedding extensions.vector(1536),
 status text not null check(status in ('deferred','pending','processing','ready','failed','excluded','too_long')),
 token uuid,started_at timestamptz,completed_at timestamptz,available_at timestamptz not null default now(),
 attempts integer not null default 0,error_code text,input_bytes integer not null default 0,
 primary key(note_id,model,input_version),foreign key(note_id,user_id) references public.notes(id,user_id) on delete cascade,
 check((status='ready')=(embedding is not null)),check(embedding is null or extensions.vector_norm(embedding)>0)
);
create index semantic_embedding_owner on private.note_embeddings(user_id,model,input_version,status,available_at);
create index semantic_embedding_note_owner on private.note_embeddings(note_id,user_id);
create table private.semantic_runs (
 user_id uuid primary key references auth.users(id) on delete cascade,
 token uuid,started_at timestamptz,completed_at timestamptz,status text not null default 'idle' check(status in ('idle','processing','failed','completed','budget')),
 window_start timestamptz not null default date_trunc('hour',now()),embedding_attempts integer not null default 0,validation_attempts integer not null default 0,
 last_wake timestamptz,error_code text,diagnostics jsonb not null default '{}'
);
create table private.semantic_usage (
 call_id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('embedding','validation')),model text not null,
 input_tokens integer not null check(input_tokens>=0),output_tokens integer not null default 0 check(output_tokens>=0),
 elapsed_ms integer not null default 0,created_at timestamptz not null default now()
);
create index semantic_usage_owner_time on private.semantic_usage(user_id,created_at);
alter table private.note_embeddings enable row level security;
alter table private.semantic_runs enable row level security;
alter table private.semantic_usage enable row level security;
revoke all on private.note_embeddings,private.semantic_runs,private.semantic_usage from public,anon,authenticated;
grant all on private.note_embeddings,private.semantic_runs,private.semantic_usage to service_role;

create function private.semantic_sensitive(value text) returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(value,'') ~* '\m(grief|grieving|trauma|abuse|assault|suicid\w*|self[- ]harm|died|death|funeral|doctor|therapy|therapist|diagnos\w*|medical|health|medication|pregnan\w*|divorce|conflict|private|confidential|secret|debt|salary|bank|financial)\M'
$$;
create function private.semantic_eligible(target_id uuid,owner_id uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.notes n left join public.note_contexts c on c.note_id=n.id and c.user_id=n.user_id
 left join public.note_sources s on s.note_id=n.id and s.user_id=n.user_id
 where n.id=target_id and n.user_id=owner_id and public.rediscovery_eligible(n.id,owner_id)
 and not private.semantic_sensitive(concat_ws(' ',n.title,n.content,c.user_context,c.answer,s.name,s.url,s.description))
 and concat_ws(' ',n.title,n.content) ~ '[[:alnum:]]'
 and concat_ws(' ',n.title,n.content) !~* '\m(ignore (all |prior |previous )?instructions|system:|api key)'
 and not exists(select 1 from public.note_discovery_history h where h.note_id=n.id and h.user_id=owner_id and h.dismissed and h.shown_at>now()-interval '30 days'))
$$;
-- No generated interpretation or operational dates enter this representation.
create function private.semantic_document(target_id uuid,owner_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object(
 'title',nullif(private.theme_text(n.title),''),'content',nullif(private.theme_text(n.content),''),
 'user_context',nullif(private.theme_text(c.user_context),''),'answer',nullif(private.theme_text(c.answer),''),
 'confirmed_source',case when s.source_type is not null then jsonb_strip_nulls(jsonb_build_object('type',s.source_type,'name',nullif(private.theme_text(s.name),''),'url',nullif(s.url,''),'description',nullif(private.theme_text(s.description),''))) else null end))
 from public.notes n left join public.note_contexts c on c.note_id=n.id and c.user_id=n.user_id
 left join public.note_sources s on s.note_id=n.id and s.user_id=n.user_id where n.id=target_id and n.user_id=owner_id
$$;
-- Replaced incrementally by later phase migrations to invalidate their data.
create function private.clear_semantic_derived(target_id uuid,owner_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 delete from public.note_theme_members where note_id=target_id and user_id=owner_id;
end $$;
create function private.enqueue_semantic(target_id uuid,owner_id uuid,automatic boolean default true) returns void
language plpgsql security definer set search_path='' as $$
declare doc jsonb; fingerprint text; next_status text; existing private.note_embeddings; enabled boolean; size integer;
begin
 if auth.uid() is not null and auth.uid()<>owner_id then raise insufficient_privilege; end if;
 doc=private.semantic_document(target_id,owner_id);if doc is null then return; end if;
 select coalesce(p.enabled,false) into enabled from public.context_preferences p where p.user_id=owner_id;
 fingerprint=encode(extensions.digest('text-embedding-3-small:1536:input-v1:'||doc::text,'sha256'),'hex');size=octet_length(doc::text);
 next_status=case when not coalesce(enabled,false) then 'deferred' when not private.semantic_eligible(target_id,owner_id) then 'excluded'
 when size>7000 then 'too_long' when automatic then 'pending' else 'deferred' end;
 select * into existing from private.note_embeddings where note_id=target_id and model='text-embedding-3-small' and input_version=1;
 if existing.note_id is not null and existing.input_hash=fingerprint and (existing.status in ('ready','pending','processing','failed') and next_status in ('pending','deferred') or existing.status=next_status) then return; end if;
 perform private.clear_semantic_derived(target_id,owner_id);
 insert into private.note_embeddings(note_id,user_id,input_hash,status,input_bytes,error_code)
 values(target_id,owner_id,fingerprint,next_status,size,case when not coalesce(enabled,false) then 'consent' when next_status='too_long' then 'input_too_long' when next_status='excluded' then 'exclusion' else null end)
 on conflict(note_id,model,input_version) do update set input_hash=excluded.input_hash,status=excluded.status,embedding=null,token=null,started_at=null,completed_at=null,available_at=now(),attempts=0,error_code=excluded.error_code,input_bytes=excluded.input_bytes;
end $$;

create function private.semantic_note_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid; owner_id uuid; automatic boolean=true; n public.notes;
begin
 if tg_table_name='notes' then
  target=new.id;owner_id=new.user_id;automatic=(tg_op<>'INSERT' or new.import_metadata is null);
  if tg_op='UPDATE' and new.title is distinct from old.title then
   insert into private.related_library(user_id) values(owner_id) on conflict(user_id) do update set revision=private.related_library.revision+1;
  end if;
 else
  target=case when tg_op='DELETE' then old.note_id else new.note_id end;
  owner_id=case when tg_op='DELETE' then old.user_id else new.user_id end;
  select * into n from public.notes where id=target and user_id=owner_id;
  if n.id is null then return null; end if;
  -- An import's initial source write remains deferred in its original transaction.
  automatic=not(n.import_metadata is not null and (n.import_metadata->>'imported_at')::timestamptz>=transaction_timestamp());
 end if;
 perform private.enqueue_semantic(target,owner_id,automatic);return null;
end $$;
create trigger semantic_note_changed after insert or update of title,content on public.notes for each row execute function private.semantic_note_changed();
create trigger semantic_context_changed after update of user_context,answer on public.note_contexts for each row execute function private.semantic_note_changed();
create trigger semantic_source_changed after update on public.note_sources for each row execute function private.semantic_note_changed();
create trigger semantic_exclusion_changed after insert or delete on public.flashback_exclusions for each row execute function private.semantic_note_changed();
create trigger semantic_negative_feedback after update of dismissed on public.note_discovery_history for each row execute function private.semantic_note_changed();
create function private.semantic_consent_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not new.enabled then
  update private.note_embeddings set embedding=null,status='deferred',token=null,error_code='consent' where user_id=new.user_id;
  update private.semantic_runs set token=null,status='idle' where user_id=new.user_id;
  update private.theme_state set enabled=false where user_id=new.user_id;
 end if;
 return null;
end $$;
create trigger semantic_consent_changed after insert or update of enabled on public.context_preferences for each row execute function private.semantic_consent_changed();

create function public.activate_semantic_history(caller_id uuid) returns void language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
declare item record;
begin
 if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then raise exception 'CONTEXT_DISABLED'; end if;
 insert into private.theme_state(user_id,enabled) values(caller_id,true) on conflict(user_id) do update set enabled=true;
 for item in select id from public.notes where user_id=caller_id loop perform private.enqueue_semantic(item.id,caller_id,true);end loop;
end $$;
create function public.claim_semantic_run(caller_id uuid,retry boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r private.semantic_runs;
begin
 perform pg_advisory_xact_lock(hashtextextended(caller_id::text,1919));
 if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return jsonb_build_object('status','disabled'); end if;
 insert into private.semantic_runs(user_id) values(caller_id) on conflict do nothing;
 select * into r from private.semantic_runs where user_id=caller_id for update;
 if r.status='processing' and r.started_at>now()-interval '2 minutes' then return jsonb_build_object('status','processing'); end if;
 if retry then update private.note_embeddings set status='pending',available_at=now(),attempts=0,error_code=null where user_id=caller_id and status='failed';end if;
 update private.semantic_runs set window_start=date_trunc('hour',now()),embedding_attempts=case when window_start=date_trunc('hour',now()) then embedding_attempts else 0 end,validation_attempts=case when window_start=date_trunc('hour',now()) then validation_attempts else 0 end,
 token=gen_random_uuid(),started_at=now(),status='processing',error_code=null where user_id=caller_id returning * into r;
 return jsonb_build_object('status','claimed','token',r.token);
end $$;
create function public.claim_semantic_embeddings(caller_id uuid,run_token uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ids uuid[]; result jsonb; remaining integer;
begin
 select greatest(0,512-embedding_attempts) into remaining from private.semantic_runs where user_id=caller_id and token=run_token and status='processing' for update;
 if remaining is null then return '[]'::jsonb;end if;
 if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return '[]'::jsonb;end if;
 select array_agg(x.note_id) into ids from(select e.note_id from private.note_embeddings e where e.user_id=caller_id and e.model='text-embedding-3-small' and e.input_version=1
 and (e.status in ('pending','failed') or e.status='processing' and e.started_at<now()-interval '2 minutes')
 and e.available_at<=now() and e.attempts<5 order by e.available_at,e.note_id limit least(remaining,32) for update skip locked) x;
 if coalesce(cardinality(ids),0)=0 then return '[]'::jsonb;end if;
 update private.note_embeddings set status='processing',token=gen_random_uuid(),started_at=now(),attempts=attempts+1,error_code=null where user_id=caller_id and note_id=any(ids) and model='text-embedding-3-small' and input_version=1;
 update private.semantic_runs set embedding_attempts=embedding_attempts+cardinality(ids) where user_id=caller_id and token=run_token;
 select jsonb_agg(jsonb_build_object('id',e.note_id,'token',e.token,'hash',e.input_hash,'input',private.semantic_document(e.note_id,caller_id)::text) order by e.note_id) into result
 from private.note_embeddings e where e.user_id=caller_id and e.note_id=any(ids) and e.model='text-embedding-3-small' and e.input_version=1;
 return result;
end $$;
create function public.record_semantic_usage(caller_id uuid,call_id uuid,kind text,model text,input_tokens integer,output_tokens integer default 0,elapsed_ms integer default 0) returns void language sql security invoker set search_path='' as $$
 insert into private.semantic_usage(call_id,user_id,kind,model,input_tokens,output_tokens,elapsed_ms) values(call_id,caller_id,kind,model,input_tokens,output_tokens,elapsed_ms) on conflict(call_id) do nothing
$$;
create function public.finish_semantic_embeddings(caller_id uuid,results jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare item jsonb; changed integer=0; count_changed integer;
begin
 if jsonb_typeof(results)<>'array' or jsonb_array_length(results)>32 then raise exception 'INVALID_EMBEDDINGS';end if;
 if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return 0;end if;
 for item in select * from jsonb_array_elements(results) loop
  if jsonb_typeof(item->'embedding')<>'array' or jsonb_array_length(item->'embedding')<>1536 then raise exception 'INVALID_EMBEDDING_DIMENSIONS';end if;
  update private.note_embeddings e set embedding=(item->'embedding')::text::extensions.vector,status='ready',completed_at=now(),token=null,error_code=null
  where e.user_id=caller_id and e.note_id=(item->>'id')::uuid and e.model='text-embedding-3-small' and e.input_version=1 and e.input_hash=item->>'hash' and e.token=(item->>'token')::uuid and e.status='processing'
  and private.semantic_eligible(e.note_id,caller_id);
  get diagnostics count_changed=row_count;changed=changed+count_changed;
 end loop;
 return changed;
end $$;
create function public.fail_semantic_embeddings(caller_id uuid,claims jsonb,failure text) returns void language plpgsql security invoker set search_path='' as $$
begin
 if failure not in ('provider','invalid_embedding','timeout') then raise exception 'INVALID_FAILURE';end if;
 update private.note_embeddings e set status='failed',token=null,error_code=failure,available_at=now()+least(60,power(2,attempts)::integer)*interval '1 minute'
 where e.user_id=caller_id and e.status='processing' and exists(select 1 from jsonb_array_elements(claims) c where e.note_id=(c->>'id')::uuid and e.token=(c->>'token')::uuid);
end $$;
create function public.end_semantic_run(caller_id uuid,run_token uuid,failure text default null,diagnostics jsonb default '{}') returns void language sql security invoker set search_path='' as $$
 update private.semantic_runs set status=case when failure is null then 'completed' else 'failed' end,completed_at=now(),error_code=left(failure,40),diagnostics=end_semantic_run.diagnostics
 where user_id=caller_id and token=run_token
$$;
create function private.semantic_index_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid=auth.uid();counts jsonb; r private.semantic_runs;
begin
 if owner_id is null then raise insufficient_privilege;end if;
 if not exists(select 1 from public.context_preferences where user_id=owner_id and enabled) then return jsonb_build_object('status','disabled','indexed',0,'total',0);end if;
 select * into r from private.semantic_runs where user_id=owner_id;
 select jsonb_build_object('total',count(*) filter(where status<>'excluded'),'indexed',count(*) filter(where status='ready'),'waiting',count(*) filter(where status in ('pending','deferred')),'processing',count(*) filter(where status='processing'),'failed',count(*) filter(where status='failed'),'excluded',count(*) filter(where status='excluded'),'unsupported',count(*) filter(where status='too_long')) into counts
 from private.note_embeddings where user_id=owner_id and model='text-embedding-3-small' and input_version=1;
 return counts||jsonb_build_object('status',r.status,'error_code',r.error_code,'budget_resume_at',case when r.embedding_attempts>=512 then r.window_start+interval '1 hour' else null end);
end $$;
create function public.semantic_index_snapshot() returns jsonb language sql security invoker set search_path='' as $$ select private.semantic_index_snapshot() $$;

-- Minimum privileges: all processing entry points are service-only.
do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in
 ('semantic_sensitive','semantic_eligible','semantic_document','clear_semantic_derived','enqueue_semantic','semantic_note_changed','semantic_consent_changed','activate_semantic_history','claim_semantic_run','claim_semantic_embeddings','record_semantic_usage','finish_semantic_embeddings','fail_semantic_embeddings','end_semantic_run','semantic_index_snapshot') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
grant execute on function private.semantic_index_snapshot(),public.semantic_index_snapshot() to authenticated;
-- Backfill state only. Historical contents are not sent to OpenAI by migration.
select private.enqueue_semantic(id,user_id,false) from public.notes;
notify pgrst,'reload schema';
