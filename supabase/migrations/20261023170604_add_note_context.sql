-- Context is separate from note content. All enrichment starts with explicit opt-in.
create table public.context_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false
);
alter table public.context_preferences enable row level security;
revoke all on public.context_preferences from public,anon,authenticated;
grant select on public.context_preferences to authenticated;
grant insert(user_id,enabled),update(enabled) on public.context_preferences to authenticated;
grant all on public.context_preferences to service_role;
create policy "Owners read context preferences" on public.context_preferences for select to authenticated using ((select auth.uid())=user_id);
create policy "Owners create context preferences" on public.context_preferences for insert to authenticated with check ((select auth.uid())=user_id);
create policy "Owners update context preferences" on public.context_preferences for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create function private.note_context_hash(content text) returns text language sql immutable set search_path='' as $$
  select encode(extensions.digest(btrim(regexp_replace(translate(content,chr(9)||chr(10)||chr(11)||chr(12)||chr(13),'     '),' +',' ','g')),'sha256'),'hex');
$$;
revoke all on function private.note_context_hash(text) from public,anon,authenticated;
grant execute on function private.note_context_hash(text) to service_role;

create table public.note_contexts (
  note_id uuid primary key references public.notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_hash text not null,
  revision bigint not null default 1,
  status text not null default 'disabled' check(status in ('disabled','pending','processing','completed','failed')),
  generated_context jsonb check(generated_context is null or (jsonb_typeof(generated_context)='object' and octet_length(generated_context::text)<=32768)),
  processing_token uuid,
  processing_started_at timestamptz,
  attempts integer not null default 0,
  last_completed_at timestamptz,
  model text,
  error_code text check(error_code is null or error_code in ('configuration','timeout','provider','invalid_result')),
  user_context text not null default '' check(char_length(user_context)<=4000),
  answer text not null default '' check(char_length(answer)<=2000),
  user_version bigint not null default 1,
  prompt_question text check(char_length(prompt_question)<=200),
  prompt_kind text,
  prompt_anchor text,
  prompt_revision bigint,
  prompt_dismissed boolean not null default false
);
create index note_contexts_owner_status_idx on public.note_contexts(user_id,status);
alter table public.note_contexts enable row level security;
revoke all on public.note_contexts from public,anon,authenticated;
grant select on public.note_contexts to authenticated;
grant update(user_context,answer,prompt_dismissed) on public.note_contexts to authenticated;
grant all on public.note_contexts to service_role;
create policy "Owners read note context" on public.note_contexts for select to authenticated using ((select auth.uid())=user_id);
create policy "Owners update their added context" on public.note_contexts for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create function private.context_user_version() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (new.user_context,new.answer,new.prompt_dismissed) is distinct from (old.user_context,old.answer,old.prompt_dismissed) then new.user_version=old.user_version+1; end if;
  return new;
end $$;
revoke all on function private.context_user_version() from public,anon,authenticated;
create trigger note_context_user_version before update on public.note_contexts for each row execute function private.context_user_version();

-- Private definer trigger only follows an already-authorized parent note write.
create function private.sync_note_context() returns trigger language plpgsql security definer set search_path='' as $$
declare fingerprint text; enabled boolean;
begin
  if auth.uid() is not null and auth.uid()<>new.user_id then raise exception 'Context owner mismatch'; end if;
  fingerprint=private.note_context_hash(new.content);
  select p.enabled into enabled from public.context_preferences p where p.user_id=new.user_id;
  insert into public.note_contexts(note_id,user_id,source_hash,status) values(new.id,new.user_id,fingerprint,case when coalesce(enabled,false) then 'pending' else 'disabled' end)
  on conflict(note_id) do update set source_hash=excluded.source_hash,revision=public.note_contexts.revision+1,
    status=excluded.status,generated_context=null,processing_token=null,processing_started_at=null,attempts=0,error_code=null,prompt_revision=null
    where public.note_contexts.source_hash<>excluded.source_hash;
  return new;
end $$;
revoke all on function private.sync_note_context() from public,anon,authenticated;
create trigger notes_sync_context after insert or update of content on public.notes for each row execute function private.sync_note_context();

-- Metadata-only backfill: historical notes stay disabled and are never sent to AI here.
insert into public.note_contexts(note_id,user_id,source_hash) select id,user_id,private.note_context_hash(content) from public.notes;

create function private.stop_note_enrichment() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and auth.uid()<>new.user_id then raise exception 'Context owner mismatch'; end if;
  if not new.enabled then
    update public.note_contexts set status='disabled',revision=revision+1,processing_token=null,generated_context=null,prompt_revision=null
    where user_id=new.user_id and status in ('pending','processing','failed');
  end if;
  return new;
end $$;
revoke all on function private.stop_note_enrichment() from public,anon,authenticated;
create trigger context_preferences_stop after insert or update of enabled on public.context_preferences for each row execute function private.stop_note_enrichment();

create table private.context_budget(user_id uuid primary key references auth.users(id) on delete cascade,window_start timestamptz not null,attempts integer not null);
alter table private.context_budget enable row level security;
revoke all on private.context_budget from public,anon,authenticated;
grant all on private.context_budget to service_role;

-- Short claims and compare-and-set completion protect concurrent edits and opt-out.
create function public.claim_note_context(target_id uuid,caller_id uuid,manual boolean default false,retry boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare context public.note_contexts; original text; used integer;
begin
  perform 1 from public.context_preferences where user_id=caller_id and enabled for share;
  if not found then raise exception 'CONTEXT_DISABLED'; end if;
  select c.* into context from public.note_contexts c where c.note_id=target_id and c.user_id=caller_id for update;
  if context.note_id is null then raise exception 'CONTEXT_NOT_FOUND'; end if;
  if context.status='completed' then return jsonb_build_object('status','completed'); end if;
  if context.status='processing' and context.processing_started_at>now()-interval '2 minutes' then return jsonb_build_object('status','processing'); end if;
  if context.status='disabled' and not manual then return jsonb_build_object('status','disabled'); end if;
  if context.status='failed' and not retry then return jsonb_build_object('status','failed'); end if;
  if context.attempts>=3 then raise exception 'CONTEXT_ATTEMPTS'; end if;
  select content into original from public.notes where id=target_id and user_id=caller_id;
  if original is null then raise exception 'CONTEXT_NOT_FOUND'; end if;
  insert into private.context_budget as b values(caller_id,date_trunc('hour',now()),1)
  on conflict(user_id) do update set window_start=excluded.window_start,attempts=case when b.window_start=excluded.window_start then b.attempts+1 else 1 end returning attempts into used;
  if used>20 then raise exception 'CONTEXT_RATE_LIMIT'; end if;
  update public.note_contexts set status='processing',attempts=attempts+1,processing_started_at=now(),processing_token=gen_random_uuid(),error_code=null
  where note_id=target_id returning * into context;
  return jsonb_build_object('status','claimed','content',original,'source_hash',context.source_hash,'revision',context.revision,'token',context.processing_token);
end $$;
revoke all on function public.claim_note_context(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.claim_note_context(uuid,uuid,boolean,boolean) to service_role;

create function public.finish_note_context(target_id uuid,caller_id uuid,expected_revision bigint,claim_token uuid,payload jsonb,question jsonb,model_name text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare context public.note_contexts;
begin
  perform 1 from public.context_preferences where user_id=caller_id and enabled for share;
  if not found then return false; end if;
  select * into context from public.note_contexts where note_id=target_id and user_id=caller_id for update;
  if context.note_id is null or context.status<>'processing' or context.revision<>expected_revision or context.processing_token is distinct from claim_token then return false; end if;
  if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return false; end if;
  if not exists(select 1 from public.notes where id=target_id and user_id=caller_id and private.note_context_hash(content)=context.source_hash) then return false; end if;
  update public.note_contexts set status='completed',generated_context=payload,last_completed_at=now(),model=model_name,error_code=null,processing_token=null,
    prompt_question=coalesce(prompt_question,case when not prompt_dismissed then question->>'question' end),
    prompt_kind=coalesce(prompt_kind,case when not prompt_dismissed then question->>'kind' end),
    prompt_anchor=coalesce(prompt_anchor,case when not prompt_dismissed then question->>'anchor' end),
    prompt_revision=case when not prompt_dismissed and question is not null and (prompt_question is null or (prompt_kind=question->>'kind' and prompt_anchor=question->>'anchor')) then expected_revision else null end
  where note_id=target_id;
  return true;
end $$;
revoke all on function public.finish_note_context(uuid,uuid,bigint,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_note_context(uuid,uuid,bigint,uuid,jsonb,jsonb,text) to service_role;

create function public.fail_note_context(target_id uuid,caller_id uuid,expected_revision bigint,claim_token uuid,code text) returns void
language sql security invoker set search_path='' as $$
  update public.note_contexts set status='failed',processing_token=null,error_code=code
  where note_id=target_id and user_id=caller_id and revision=expected_revision and processing_token=claim_token and status='processing';
$$;
revoke all on function public.fail_note_context(uuid,uuid,bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.fail_note_context(uuid,uuid,bigint,uuid,text) to service_role;
