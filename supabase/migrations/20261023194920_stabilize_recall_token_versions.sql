-- Token identity remains stable during ordinary foreground refreshes.
alter table public.push_devices add column token_version uuid not null default gen_random_uuid();
alter table private.push_deliveries alter column device_version type uuid using gen_random_uuid();
update private.push_deliveries d set device_version=v.token_version from public.push_devices v where v.installation_id=d.installation_id;
do $migration$
declare definition text;
begin
 select pg_get_functiondef('public.recall_service(text,uuid,jsonb)'::regprocedure) into definition;
 definition=replace(definition,'registered_at=d.device_version','token_version=d.device_version');
 definition=replace(definition,'device.registered_at,','device.token_version,');
 definition=replace(definition,$find$status=payload->>'status',error_code=left(payload->>'error',60)$find$,$replacement$status=case when payload->>'status'='retry' and d.attempts>=3 then 'failed' else payload->>'status' end,error_code=case when payload->>'status'='retry' and d.attempts>=3 then 'retry_limit' else left(payload->>'error',60) end$replacement$);
 execute definition;
end
$migration$;
create or replace function public.register_recall_device(installation uuid,token text,device_platform text) returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid=(select auth.uid()); sid uuid=(auth.jwt()->>'session_id')::uuid;
begin
 if owner_id is null or sid is null or not exists(select 1 from auth.sessions where id=sid and user_id=owner_id) then raise exception 'Sign in again'; end if;
 if token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' or length(token)>249 or device_platform not in ('android','ios') then raise exception 'Invalid device'; end if;
 -- A rolled token or account switch supersedes the previous association atomically.
 update public.push_devices set active=false where expo_token=token and installation_id<>installation;
 insert into public.push_devices(installation_id,user_id,expo_token,session_id,platform) values(installation,owner_id,token,sid,device_platform)
 on conflict(installation_id) do update set user_id=excluded.user_id,expo_token=excluded.expo_token,session_id=excluded.session_id,platform=excluded.platform,active=true,registered_at=clock_timestamp(),token_version=case when public.push_devices.user_id is distinct from excluded.user_id or public.push_devices.expo_token is distinct from excluded.expo_token or public.push_devices.session_id is distinct from excluded.session_id or not public.push_devices.active then gen_random_uuid() else public.push_devices.token_version end;
 -- Bound active devices per account. Delivery uses only the most recently registered device.
 update public.push_devices set active=false where user_id=owner_id and installation_id in(select installation_id from public.push_devices where user_id=owner_id and active order by registered_at desc offset 3);
end $$;
