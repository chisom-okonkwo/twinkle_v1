-- Intentional discovery: prefer older/unseen results; allow newer/recently seen fallback.
-- Preserve session uniqueness, explicit dismissals, source exclusions and sensitivity protection.
drop function public.discovery_candidates(uuid,uuid);
create function public.discovery_candidates(caller_id uuid,discovery_session uuid,page_offset integer default 0) returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
begin
 if page_offset is null or page_offset not between 0 and 400 or page_offset%100<>0 then raise exception 'INVALID_PAGE'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select n.id,left(n.content,10000) as content,n.created_at,n.updated_at,to_jsonb(c) as context,(select max(h.shown_at) from public.note_discovery_history h where h.user_id=n.user_id and h.note_id=n.id) as last_seen_at
 from public.notes n join public.note_contexts c on c.note_id=n.id and c.user_id=n.user_id
 where n.user_id=caller_id and n.created_at<=now() and n.updated_at<=now()
 and length(btrim(n.content))>=40 and public.rediscovery_eligible(n.id,caller_id)
 and not exists(select 1 from public.note_discovery_history h where h.user_id=caller_id and h.note_id=n.id and (h.session_id=discovery_session or h.dismissed and h.shown_at>now()-interval '30 days'))
 and not exists(select 1 from public.flashbacks f where f.user_id=caller_id and f.note_id=n.id and f.created_at>now()-interval '7 days')
 order by case when exists(select 1 from public.note_discovery_history h where h.user_id=n.user_id and h.note_id=n.id and h.shown_at>now()-interval '7 days') then 2 when n.created_at<=now()-interval '1 day' and n.updated_at<=now()-interval '1 day' then 0 else 1 end,
 (c.status='completed' and jsonb_typeof(c.generated_context->'situation')='object') desc,n.updated_at,n.id limit 100 offset page_offset
 ) x);
end $$;
revoke all on function public.discovery_candidates(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.discovery_candidates(uuid,uuid,integer) to service_role;


create or replace function public.reserve_discovery(caller_id uuid,discovery_session uuid,discovery_request uuid,candidates jsonb,discovery_mode text) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='5s' as $$
declare candidate jsonb; n public.notes; c public.note_contexts; existing public.note_discovery_history;
begin
 if caller_id is null or discovery_session is null or discovery_request is null or discovery_mode not in ('surprise','topic') or jsonb_typeof(candidates)<>'array' or jsonb_array_length(candidates)>100 then raise exception 'INVALID_DISCOVERY'; end if;
 perform pg_advisory_xact_lock(hashtextextended(caller_id::text,1617));
 select * into existing from public.note_discovery_history where request_id=discovery_request;
 if found then
  if existing.user_id<>caller_id or existing.session_id<>discovery_session or existing.mode<>discovery_mode then raise exception 'INVALID_DISCOVERY'; end if;
  return public.discovery_card(discovery_request,caller_id);
 end if;
 for candidate in select * from jsonb_array_elements(candidates) loop
  select * into n from public.notes where id=(candidate->>'id')::uuid and user_id=caller_id for share;
  if n.id is null or n.updated_at<>(candidate->>'updated_at')::timestamptz or not public.rediscovery_eligible(n.id,caller_id) then continue; end if;
  if discovery_mode='surprise' then
   if n.created_at>now() or n.updated_at>now() then continue; end if;
   select * into c from public.note_contexts where note_id=n.id and user_id=caller_id;
   if c.source_hash is distinct from candidate->>'source_hash' or c.revision is distinct from (candidate->>'context_revision')::bigint or c.user_version is distinct from (candidate->>'user_version')::bigint then continue; end if;
  end if;
  if exists(select 1 from public.note_discovery_history h where h.user_id=caller_id and h.note_id=n.id and (h.session_id=discovery_session or (h.dismissed and h.shown_at>now()-interval '30 days') or (discovery_mode='topic' and h.shown_at>now()-interval '1 day')))
   or exists(select 1 from public.flashbacks f where f.user_id=caller_id and f.note_id=n.id and f.created_at>now()-interval '7 days') then continue; end if;
  insert into public.note_discovery_history(request_id,user_id,session_id,note_id,note_updated_at,mode) values(discovery_request,caller_id,discovery_session,n.id,n.updated_at,discovery_mode);
  return public.discovery_card(discovery_request,caller_id);
 end loop;
 return null;
end $$;
