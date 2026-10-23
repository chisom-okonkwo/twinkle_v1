create function private.recall_session_active(session uuid,owner_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions where id=session and user_id=owner_id and (not_after is null or not_after>now()));
$$;
revoke all on function private.recall_session_active(uuid,uuid) from public,anon,authenticated;
grant execute on function private.recall_session_active(uuid,uuid) to service_role;

create or replace function public.recall_service(action text,owner_id uuid default null,payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare s private.recall_state; p public.recall_preferences; f public.flashbacks; n public.notes; c public.note_contexts;
 d private.push_deliveries; device public.push_devices; result jsonb; wait_time interval; fresh boolean=false;
begin
 if action='users' then
   with due as(select st.user_id from private.recall_state st join public.recall_preferences pr using(user_id) where private.recall_window(pr) and st.check_after<=now() and exists(select 1 from public.push_devices dv where dv.user_id=st.user_id and dv.active and dv.registered_at>now()-interval '90 days' and private.recall_session_active(dv.session_id,dv.user_id)) order by st.check_after limit 5 for update of st skip locked),
   claimed as(update private.recall_state st set check_after=now()+interval '15 minutes' from due where st.user_id=due.user_id returning st.user_id)
   select coalesce(jsonb_agg(user_id),'[]') into result from claimed; return result;
 elsif action='receipts' then
   update private.push_deliveries set status='unknown',error_code='interrupted' where status='sending' and updated_at<now()-interval '2 minutes';
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
     select dv.* into device from public.push_devices dv where private.recall_session_active(dv.session_id,dv.user_id) and dv.user_id=owner_id and dv.active and dv.registered_at>now()-interval '90 days' order by dv.registered_at desc limit 1 for share of dv;
     fresh=true;
   end if;
   if device.installation_id is null or not private.recall_session_active(device.session_id,owner_id) then return 'null'; end if;
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
