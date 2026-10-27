-- Durable scope work flags plus existing Cron/pg_net. No mobile background task.
alter table private.semantic_scopes add column needs_work boolean not null default false,add column available_at timestamptz not null default now(),add column wake_attempts integer not null default 0;
create index semantic_scopes_due on private.semantic_scopes(available_at,user_id) where needs_work;
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'twinkle_semantic_worker') where not exists(select 1 from vault.secrets where name='twinkle_semantic_worker');
create function public.authorize_semantic_worker(secret text) returns boolean language sql security definer set search_path='' as $$
 select secret is not null and char_length(secret)=64 and extensions.digest(secret,'sha256')=(select extensions.digest(decrypted_secret,'sha256') from vault.decrypted_secrets where name='twinkle_semantic_worker')
$$;
create function public.semantic_backlog() returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('user_id',x.user_id,'scope',x.scope_key)),'[]') from(
 select distinct on(s.user_id)s.user_id,s.scope_key,s.available_at from private.semantic_scopes s join public.context_preferences c on c.user_id=s.user_id and c.enabled
 left join private.semantic_runs r on r.user_id=s.user_id
 where s.needs_work and s.available_at<=now() and (r.user_id is null or r.status<>'processing' or r.started_at<=now()-interval '2 minutes')
 order by s.user_id,s.available_at,s.scope_key limit 4)x
$$;
-- Only an asynchronous HTTP request is issued here; save completion is independent of it.
create function private.run_semantic_schedule() returns void language plpgsql security definer set search_path='' as $$
declare endpoint text;credential text;
begin
 if not exists(select 1 from private.semantic_scopes where needs_work and available_at<=now()) then return;end if;
 select project_url into endpoint from private.recall_config where id;if endpoint is null then return;end if;
 select decrypted_secret into credential from vault.decrypted_secrets where name='twinkle_semantic_worker';
 perform net.http_post(url:=endpoint||'/functions/v1/semantic-worker',headers:=jsonb_build_object('Content-Type','application/json','x-semantic-secret',credential),body:='{}',timeout_milliseconds:=10000);
exception when others then null; -- Durable work remains available to Cron after network failures.
end $$;
create function public.request_semantic_work(caller_id uuid,scope text,retry boolean default false) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return;end if;
 update private.semantic_scopes set needs_work=true,available_at=now(),wake_attempts=case when retry then 0 else wake_attempts end where user_id=caller_id and scope_key=scope;
end $$;
create function private.semantic_saved_work() returns trigger language plpgsql security definer set search_path='' as $$
declare woke uuid;
begin
 if new.status<>'pending' then return null;end if;
 if tg_op='UPDATE' and old.status='pending' and old.input_hash=new.input_hash then return null;end if;
 insert into private.semantic_scopes(user_id,scope_key) values(new.user_id,'all') on conflict do nothing;
 update private.semantic_scopes set needs_work=true,available_at=now(),wake_attempts=0 where user_id=new.user_id and scope_key='all';
 insert into private.semantic_runs(user_id,last_wake) values(new.user_id,now()) on conflict(user_id) do update set last_wake=now()
 where private.semantic_runs.last_wake is null or private.semantic_runs.last_wake<now()-interval '30 seconds' returning user_id into woke;
 if woke is not null then perform private.run_semantic_schedule();end if;return null;
end $$;
create trigger semantic_saved_work after insert or update of status on private.note_embeddings for each row execute function private.semantic_saved_work();
create function public.finish_semantic_work(caller_id uuid,scope text,run_token uuid) returns void language plpgsql security invoker set search_path='' as $$
declare r private.semantic_runs;s private.semantic_scopes;more boolean;paused boolean;
begin
 select * into r from private.semantic_runs where user_id=caller_id and token=run_token;if r.user_id is null then return;end if;
 select * into s from private.semantic_scopes where user_id=caller_id and scope_key=scope for update;if s.user_id is null then return;end if;
 more=exists(select 1 from private.note_embeddings where user_id=caller_id and model='text-embedding-3-small' and input_version=1 and(status='pending' or status='failed' and attempts<5 or status='processing' or status='ready' and not relations_current))
 or jsonb_array_length(public.semantic_scope_anchors(caller_id,scope))>0
 or exists(select 1 from private.semantic_group_jobs where user_id=caller_id and scope_key=scope and prompt_version=3 and(status in('pending','processing','validated') or status='failed' and attempts<3));
 paused=r.window_start=date_trunc('hour',now()) and(r.embedding_attempts>=512 or r.validation_attempts>=24);
 update private.semantic_scopes set needs_work=more and (r.status<>'failed' or wake_attempts<4),wake_attempts=case when r.status='failed' then wake_attempts+1 else 0 end,
 available_at=case when paused then r.window_start+interval '1 hour' when r.status='failed' then now()+least(60,power(2,wake_attempts+1)::integer)*interval '1 minute' else now()+interval '30 seconds' end where user_id=caller_id and scope_key=scope;
end $$;
-- Exhausted failures are still shown as failures, but cannot starve unexamined notes.
create or replace function public.semantic_scope_anchors(caller_id uuid,scope text) returns jsonb language sql stable security invoker set search_path='' set statement_timeout='8s' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',x.note_id,'hash',x.input_hash)),'[]') from(
 select e.note_id,e.input_hash from private.note_embeddings e join public.notes n on n.id=e.note_id and n.user_id=e.user_id
 join private.semantic_scopes s on s.user_id=e.user_id and s.scope_key=scope
 left join private.semantic_scope_notes done on done.user_id=e.user_id and done.note_id=e.note_id and done.scope_key=scope
 where e.user_id=caller_id and e.model='text-embedding-3-small' and e.input_version=1 and e.status='ready' and private.semantic_eligible(e.note_id,caller_id)
 and (s.range_start is null or private.semantic_captured_at(n)>=s.range_start and private.semantic_captured_at(n)<s.range_end)
 and (done.note_id is null or done.prompt_version<3 or done.input_hash<>e.input_hash)
 and not exists(select 1 from private.semantic_group_jobs j where j.user_id=e.user_id and j.scope_key=scope and j.prompt_version=3 and j.status='failed' and j.attempts>=3 and j.fingerprints->>e.note_id::text=e.input_hash)
 order by n.updated_at desc,n.id limit 16)x
$$;
-- Consent revocation additionally stops durable future work.
create function private.semantic_work_consent() returns trigger language plpgsql security definer set search_path='' as $$begin if not new.enabled then update private.semantic_scopes set needs_work=false where user_id=new.user_id;end if;return null;end $$;
create trigger semantic_work_consent after update of enabled on public.context_preferences for each row execute function private.semantic_work_consent();
do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname in('authorize_semantic_worker','semantic_backlog','run_semantic_schedule','request_semantic_work','semantic_saved_work','finish_semantic_work','semantic_work_consent') loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
select cron.schedule('twinkle-semantic-backlog','* * * * *','select private.run_semantic_schedule()');
notify pgrst,'reload schema';
