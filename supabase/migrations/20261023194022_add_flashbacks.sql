-- Recall data is independent of note saving and enrichment.
create table public.recall_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
 frequency text not null default 'off' check(frequency in ('off','weekly','few')),
 timezone text not null default 'UTC', window_start integer not null default 9,
 window_end integer not null default 20, detailed_previews boolean not null default false,
 updated_at timestamptz not null default now(),
 check(window_start between 0 and 22 and window_end between 1 and 23 and window_start<window_end)
);
create table public.flashback_exclusions (
 note_id uuid primary key references public.notes(id) on delete cascade,
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade
);
create index flashback_exclusions_owner on public.flashback_exclusions(user_id);
create table public.flashbacks (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 note_id uuid not null references public.notes(id) on delete cascade,
 source_hash text not null, context_revision bigint not null, user_version bigint not null,
 status text not null default 'ready' check(status in ('ready','dismissed','irrelevant','expired')),
 quote text not null check(char_length(quote) between 1 and 400),
 message text not null check(char_length(message) between 1 and 1000),
 wording text not null default 'fallback' check(wording in ('fallback','ai')),
 reason text not null, created_at timestamptz not null default now()
);
create unique index flashbacks_one_ready on public.flashbacks(user_id) where status='ready';
create index flashbacks_history on public.flashbacks(user_id,note_id,created_at desc);
create table public.push_devices (
 installation_id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 expo_token text not null check(expo_token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' and length(expo_token)<250),
 session_id uuid not null, platform text not null check(platform in ('android','ios')),
 active boolean not null default true, registered_at timestamptz not null default now()
);
create unique index push_token_active on public.push_devices(expo_token) where active;
create index push_devices_owner on public.push_devices(user_id,registered_at desc) where active;
create table private.recall_state (
 user_id uuid primary key references auth.users(id) on delete cascade,
 last_selected_at timestamptz, last_notified_at timestamptz, last_checked_at timestamptz,
 check_after timestamptz not null default now()
);
create index recall_due on private.recall_state(check_after,user_id);
create table private.push_deliveries (
 id uuid primary key default gen_random_uuid(), flashback_id uuid not null unique references public.flashbacks(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 installation_id uuid not null references public.push_devices(installation_id) on delete cascade,
 device_version timestamptz not null, status text not null check(status in ('sending','retry','ticket','delivered','failed','unknown','cancelled')),
 attempts integer not null default 1, ticket_id text, error_code text,
 updated_at timestamptz not null default now(), next_attempt_at timestamptz not null default now(),
 receipt_attempts integer not null default 0, receipt_after timestamptz not null default now()+interval '15 minutes'
);
create index push_receipts_due on private.push_deliveries(receipt_after) where status='ticket';
create table private.recall_config(id boolean primary key default true check(id), project_url text);
insert into private.recall_config(id) values(true);

alter table public.recall_preferences enable row level security;
alter table public.flashback_exclusions enable row level security;
alter table public.flashbacks enable row level security;
alter table public.push_devices enable row level security;
alter table private.recall_state enable row level security;
alter table private.push_deliveries enable row level security;
alter table private.recall_config enable row level security;
revoke all on public.recall_preferences,public.flashback_exclusions,public.flashbacks,public.push_devices from public,anon,authenticated;
grant select on public.recall_preferences,public.flashback_exclusions,public.flashbacks to authenticated;
grant insert(user_id,frequency,timezone,window_start,window_end,detailed_previews) on public.recall_preferences to authenticated;
grant update(frequency,timezone,window_start,window_end,detailed_previews) on public.recall_preferences to authenticated;
grant insert(note_id,user_id),delete on public.flashback_exclusions to authenticated;
grant select(installation_id,user_id,platform,active,registered_at) on public.push_devices to authenticated;
grant all on public.recall_preferences,public.flashback_exclusions,public.flashbacks,public.push_devices,private.recall_state,private.push_deliveries,private.recall_config to service_role;
create policy recall_owner_read on public.recall_preferences for select to authenticated using((select auth.uid())=user_id);
create policy recall_owner_insert on public.recall_preferences for insert to authenticated with check((select auth.uid())=user_id);
create policy recall_owner_update on public.recall_preferences for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy exclusions_owner_read on public.flashback_exclusions for select to authenticated using((select auth.uid())=user_id);
create policy exclusions_owner_insert on public.flashback_exclusions for insert to authenticated with check((select auth.uid())=user_id and exists(select 1 from public.notes n where n.id=note_id and n.user_id=(select auth.uid())));
create policy exclusions_owner_delete on public.flashback_exclusions for delete to authenticated using((select auth.uid())=user_id);
create policy flashbacks_owner on public.flashbacks for select to authenticated using((select auth.uid())=user_id and exists(select 1 from public.notes n where n.id=note_id and n.user_id=(select auth.uid())));
create policy devices_owner on public.push_devices for select to authenticated using((select auth.uid())=user_id);

create function private.recall_preference_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then raise exception 'Invalid time zone'; end if;
 new.updated_at=clock_timestamp();
 insert into private.recall_state(user_id) values(new.user_id) on conflict(user_id) do nothing;
 update private.recall_state set check_after=now() where user_id=new.user_id;
 if new.frequency='off' then update private.push_deliveries set status='cancelled' where user_id=new.user_id and status='retry'; end if;
 return new;
end $$;
create trigger recall_preference_changed before insert or update on public.recall_preferences for each row execute function private.recall_preference_changed();

create function private.invalidate_flashbacks() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='note_contexts' then
   if new.source_hash=old.source_hash and new.revision=old.revision and new.user_version=old.user_version then return new; end if;
 end if;
 update public.flashbacks set status='expired' where note_id=new.note_id and status='ready';
 update private.push_deliveries d set status='cancelled' from public.flashbacks f where d.flashback_id=f.id and f.note_id=new.note_id and d.status='retry';
 return new;
end $$;
create trigger flashback_context_changed after update on public.note_contexts for each row execute function private.invalidate_flashbacks();
create trigger flashback_note_excluded after insert on public.flashback_exclusions for each row execute function private.invalidate_flashbacks();

create function public.respond_flashback(target_id uuid,feedback text) returns void language plpgsql security definer set search_path='' as $$
declare f public.flashbacks;
begin
 if feedback not in ('dismissed','irrelevant') then raise exception 'Invalid feedback'; end if;
 select * into f from public.flashbacks where id=target_id and user_id=(select auth.uid()) for update;
 if f.id is null then raise exception 'Flashback unavailable'; end if;
 update public.flashbacks set status=feedback where id=f.id and status='ready';
 if feedback='irrelevant' then insert into public.flashback_exclusions(note_id,user_id) values(f.note_id,f.user_id) on conflict do nothing; end if;
 update private.push_deliveries set status='cancelled' where flashback_id=f.id and status='retry';
end $$;

create function public.register_recall_device(installation uuid,token text,device_platform text) returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid=(select auth.uid()); sid uuid=(auth.jwt()->>'session_id')::uuid;
begin
 if owner_id is null or sid is null or not exists(select 1 from auth.sessions where id=sid and user_id=owner_id) then raise exception 'Sign in again'; end if;
 if token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' or length(token)>249 or device_platform not in ('android','ios') then raise exception 'Invalid device'; end if;
 -- A rolled token or account switch supersedes the previous association atomically.
 update public.push_devices set active=false where expo_token=token and installation_id<>installation;
 insert into public.push_devices(installation_id,user_id,expo_token,session_id,platform) values(installation,owner_id,token,sid,device_platform)
 on conflict(installation_id) do update set user_id=excluded.user_id,expo_token=excluded.expo_token,session_id=excluded.session_id,platform=excluded.platform,active=true,registered_at=clock_timestamp();
 -- Bound active devices per account. Delivery uses only the most recently registered device.
 update public.push_devices set active=false where user_id=owner_id and installation_id in(select installation_id from public.push_devices where user_id=owner_id and active order by registered_at desc offset 3);
end $$;
create function public.unregister_recall_device(installation uuid) returns void language sql security definer set search_path='' as $$
 update public.push_devices set active=false where installation_id=installation and user_id=(select auth.uid());
$$;
revoke all on function public.respond_flashback(uuid,text),public.register_recall_device(uuid,text,text),public.unregister_recall_device(uuid) from public,anon;
grant execute on function public.respond_flashback(uuid,text),public.register_recall_device(uuid,text,text),public.unregister_recall_device(uuid) to authenticated;

create function private.recall_window(p public.recall_preferences) returns boolean language sql stable security invoker set search_path='' as $$
 select p.frequency<>'off' and extract(hour from now() at time zone p.timezone)>=p.window_start and extract(hour from now() at time zone p.timezone)<p.window_end;
$$;
-- Service-only transaction boundary. Each action has a small bounded scope; no network calls occur under locks.
create function public.recall_service(action text,owner_id uuid default null,payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare s private.recall_state; p public.recall_preferences; f public.flashbacks; n public.notes; c public.note_contexts;
 d private.push_deliveries; device public.push_devices; result jsonb; wait_time interval; fresh boolean=false;
begin
 if action='users' then
   with due as(select st.user_id from private.recall_state st join public.recall_preferences pr using(user_id) where pr.frequency<>'off' and st.check_after<=now() order by st.check_after limit 10 for update of st skip locked),
   claimed as(update private.recall_state st set check_after=now()+interval '15 minutes' from due where st.user_id=due.user_id returning st.user_id)
   select coalesce(jsonb_agg(user_id),'[]') into result from claimed; return result;
 elsif action='receipts' then
   with due as(select id from private.push_deliveries where status='ticket' and receipt_after<=now() order by receipt_after limit 20 for update skip locked),
   claimed as(update private.push_deliveries pd set receipt_after=now()+interval '30 minutes',receipt_attempts=receipt_attempts+1 from due where pd.id=due.id returning pd.*)
   select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed; return result;
 elsif action='receipt' or action='sent' then
   select * into d from private.push_deliveries where id=(payload->>'id')::uuid for update;
   if d.id is null or (action='sent' and d.status<>'sending') or (action='receipt' and d.status<>'ticket') then return 'null'; end if;
   if payload->>'error'='DeviceNotRegistered' then update public.push_devices set active=false where installation_id=d.installation_id and registered_at=d.device_version; end if;
   if payload->>'status' not in ('ticket','delivered','failed','retry','unknown') then raise exception 'Invalid delivery status'; end if;
   update private.push_deliveries set status=payload->>'status',error_code=left(payload->>'error',60),ticket_id=coalesce(payload->>'ticket',ticket_id),updated_at=now(),next_attempt_at=now()+interval '15 minutes' * attempts,receipt_after=now()+interval '15 minutes' where id=d.id;
   return 'true';
 end if;
 insert into private.recall_state(user_id) values(owner_id) on conflict do nothing;
 select * into p from public.recall_preferences where user_id=owner_id for share;
 select * into s from private.recall_state where user_id=owner_id for update;
 wait_time=case when p.frequency='few' then interval '3 days' else interval '7 days' end;
 if action='scan' then
   update public.flashbacks set status='expired' where user_id=owner_id and status='ready' and created_at<now()-interval '14 days';
   select * into f from public.flashbacks where user_id=owner_id and status='ready';
   if f.id is not null then return jsonb_build_object('active',f.id); end if;
   if s.last_selected_at>now()-wait_time or s.last_checked_at>now()-interval '1 hour' then return jsonb_build_object('candidates','[]'::jsonb); end if;
   update private.recall_state set last_checked_at=now() where user_id=owner_id;
   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
     select n.id,n.content,n.created_at,n.updated_at,to_jsonb(c) as context from public.notes n join public.note_contexts c on c.note_id=n.id and c.user_id=n.user_id
     where n.user_id=owner_id and n.created_at<=now()-interval '7 days' and n.updated_at<=now()-interval '7 days'
       and (c.status='completed' or char_length(c.user_context||c.answer)>=40)
       and not exists(select 1 from public.flashback_exclusions e where e.note_id=n.id)
       and not exists(select 1 from public.flashbacks h where h.user_id=owner_id and h.note_id=n.id and h.created_at>now()-interval '90 days')
     order by n.updated_at desc,n.id limit 100
   ) x;
   return jsonb_build_object('candidates',result);
 elsif action='reserve' then
   if s.last_selected_at>now()-wait_time or exists(select 1 from public.flashbacks where user_id=owner_id and status='ready') then return 'null'; end if;
   select * into n from public.notes where id=(payload->>'note_id')::uuid and user_id=owner_id for share;
   select * into c from public.note_contexts where note_id=n.id and user_id=owner_id for share;
   if n.id is null or c.note_id is null or n.updated_at>now()-interval '7 days' or n.created_at>now()-interval '7 days' or c.source_hash<>payload->>'source_hash' or c.revision<>(payload->>'context_revision')::bigint or c.user_version<>(payload->>'user_version')::bigint
      or exists(select 1 from public.flashback_exclusions where note_id=n.id) or exists(select 1 from public.flashbacks where user_id=owner_id and note_id=n.id and created_at>now()-interval '90 days') then return 'null'; end if;
   if private.note_context_hash(n.content)<>c.source_hash then return 'null'; end if;
   insert into public.flashbacks(user_id,note_id,source_hash,context_revision,user_version,quote,message,reason) values(owner_id,n.id,c.source_hash,c.revision,c.user_version,payload->>'quote',payload->>'message',payload->>'reason') returning * into f;
   update private.recall_state set last_selected_at=now() where user_id=owner_id;
   return to_jsonb(f);
 elsif action='wording' then
   select * into f from public.flashbacks where id=(payload->>'id')::uuid and user_id=owner_id and status='ready' for update;
   select * into c from public.note_contexts where note_id=f.note_id;
   if f.id is null or f.source_hash<>c.source_hash or f.context_revision<>c.revision or f.user_version<>c.user_version or not coalesce((select enabled from public.context_preferences where user_id=owner_id),false) then return 'false'; end if;
   update public.flashbacks set message=payload->>'message',quote=payload->>'quote',wording='ai' where id=f.id; return 'true';
 elsif action='prepare_send' then
   if p.user_id is null or not private.recall_window(p) then return 'null'; end if;
   select * into f from public.flashbacks where user_id=owner_id and status='ready' and created_at>now()-interval '14 days' for share;
   if f.id is null then return 'null'; end if;
   select * into d from private.push_deliveries where flashback_id=f.id for update;
   if d.id is not null then
     if d.status='sending' and d.updated_at<now()-interval '2 minutes' then update private.push_deliveries set status='unknown',error_code='interrupted' where id=d.id; return 'null'; end if;
     if d.status<>'retry' or d.attempts>=3 or d.next_attempt_at>now() then return 'null'; end if;
     select * into device from public.push_devices where installation_id=d.installation_id and user_id=owner_id and active and registered_at=d.device_version for share;
   else
     if s.last_notified_at>now()-wait_time then return 'null'; end if;
     select dv.* into device from public.push_devices dv join auth.sessions a on a.id=dv.session_id and a.user_id=dv.user_id where dv.user_id=owner_id and dv.active and dv.registered_at>now()-interval '90 days' order by dv.registered_at desc limit 1 for share of dv;
     fresh=true;
   end if;
   if device.installation_id is null or not exists(select 1 from auth.sessions where id=device.session_id and user_id=owner_id) then return 'null'; end if;
   if fresh then
     insert into private.push_deliveries(flashback_id,user_id,installation_id,device_version,status) values(f.id,owner_id,device.installation_id,device.registered_at,'sending') returning * into d;
     update private.recall_state set last_notified_at=now() where user_id=owner_id;
   else update private.push_deliveries set status='sending',attempts=attempts+1,updated_at=now() where id=d.id returning * into d; end if;
   return jsonb_build_object('delivery',d,'device',device,'flashback',f,'preferences',p);
 end if;
 raise exception 'Unknown recall action';
end $$;
revoke all on function public.recall_service(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.recall_service(text,uuid,jsonb) to service_role;

-- Vault-generated scheduler secret is never returned to clients or committed to source.
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'twinkle_recall_cron') where not exists(select 1 from vault.secrets where name='twinkle_recall_cron');
create function public.authorize_recall_scheduler(secret text) returns boolean language sql security definer set search_path='' as $$
 select secret is not null and extensions.digest(secret,'sha256')=(select extensions.digest(decrypted_secret,'sha256') from vault.decrypted_secrets where name='twinkle_recall_cron');
$$;
revoke all on function public.authorize_recall_scheduler(text) from public,anon,authenticated;
grant execute on function public.authorize_recall_scheduler(text) to service_role;
create function private.run_recall_schedule() returns void language plpgsql security definer set search_path='' as $$
declare endpoint text; credential text;
begin
 select project_url into endpoint from private.recall_config where id;
 if endpoint is null then return; end if;
 select decrypted_secret into credential from vault.decrypted_secrets where name='twinkle_recall_cron';
 perform net.http_post(url:=endpoint||'/functions/v1/recall-scheduler',headers:=jsonb_build_object('Content-Type','application/json','x-recall-secret',credential),body:='{}'::jsonb,timeout_milliseconds:=10000);
end $$;
revoke all on function private.recall_preference_changed(),private.invalidate_flashbacks(),private.recall_window(public.recall_preferences),private.run_recall_schedule() from public,anon,authenticated;
select cron.schedule('twinkle-recall-quarter-hour','*/15 * * * *','select private.run_recall_schedule()');

grant execute on function private.recall_window(public.recall_preferences) to service_role;
