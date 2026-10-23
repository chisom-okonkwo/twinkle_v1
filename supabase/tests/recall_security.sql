-- Database-owner test. All fixtures and delivery records roll back; no HTTP sends.
begin;
select set_config('test.a',gen_random_uuid()::text,true),set_config('test.b',gen_random_uuid()::text,true),set_config('test.session',gen_random_uuid()::text,true),set_config('test.install',gen_random_uuid()::text,true),set_config('test.note',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.a')::uuid),(current_setting('test.b')::uuid);
insert into auth.sessions(id,user_id,not_after) values(current_setting('test.session')::uuid,current_setting('test.a')::uuid,now()+interval '1 day');
insert into public.notes(id,user_id,content,created_at,updated_at) values(current_setting('test.note')::uuid,current_setting('test.a')::uuid,'I am considering the Northstar internship or working on Atlas. I want to compare mentorship with portfolio time.',now()-interval '30 days',now()-interval '30 days');
update public.note_contexts set status='completed',generated_context='{"topics":[],"situation":{"quote":"I am considering the Northstar internship or working on Atlas.","certainty":"explicit"},"details":[],"intentions":[{"quote":"I want to compare mentorship with portfolio time.","certainty":"explicit"}],"concerns":[],"open_questions":[],"emotions":[]}' where note_id=current_setting('test.note')::uuid;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.a'),'session_id',current_setting('test.session'),'role','authenticated')::text,true);
insert into public.recall_preferences(user_id) values(current_setting('test.a')::uuid);
do $$ begin
 if (select frequency<>'off' or detailed_previews from public.recall_preferences where user_id=current_setting('test.a')::uuid) then raise exception 'Push not private and off by default'; end if;
 begin perform public.recall_service('users');raise exception 'Client invoked service';exception when insufficient_privilege then null;end;
 begin perform public.authorize_recall_scheduler('guess');raise exception 'Client invoked scheduler auth';exception when insufficient_privilege then null;end;
 begin perform expo_token from public.push_devices;raise exception 'Client read tokens';exception when insufficient_privilege then null;end;
 begin insert into public.flashbacks(user_id,note_id,source_hash,context_revision,user_version,quote,message,reason) values(current_setting('test.a')::uuid,current_setting('test.note')::uuid,'fake',1,1,'fake','fake','fake');raise exception 'Client forged flashback';exception when insufficient_privilege then null;end;
 begin update public.recall_preferences set timezone='Fake/Zone';raise exception 'Bad timezone accepted';exception when raise_exception then if sqlerrm='Bad timezone accepted' then raise;end if;end;
end $$;
select public.register_recall_device(current_setting('test.install')::uuid,'ExponentPushToken[synthetic-test-token]','android');
reset role;
select set_config('test.token_version',(select token_version::text from public.push_devices where installation_id=current_setting('test.install')::uuid),true);
set local role authenticated;
select public.register_recall_device(current_setting('test.install')::uuid,'ExponentPushToken[synthetic-test-token]','android');
reset role;
do $$ begin
 if (select token_version::text from public.push_devices where installation_id=current_setting('test.install')::uuid)<>current_setting('test.token_version') then raise exception 'Ordinary refresh rotated token identity';end if;
end $$;
set local role authenticated;

set local role service_role;
do $$ begin
 if jsonb_array_length(public.recall_service('scan',current_setting('test.a')::uuid)->'candidates')<>1 then raise exception 'Eligible candidate missing';end if;
end $$;
select set_config('test.flashback',(public.recall_service('reserve',current_setting('test.a')::uuid,jsonb_build_object('note_id',current_setting('test.note'),'source_hash',(select source_hash from public.note_contexts where note_id=current_setting('test.note')::uuid),'context_revision',1,'user_version',1,'quote','I am considering the Northstar internship or working on Atlas.','message','You wrote: I am considering the Northstar internship or working on Atlas.','reason','An intention you recorded'))->>'id'),true);
do $$ begin
 if current_setting('test.flashback')='' then raise exception 'Reservation missing';end if;
 if public.recall_service('prepare_send',current_setting('test.a')::uuid)<>'null'::jsonb then raise exception 'Disabled push sent';end if;
 if public.recall_service('reserve',current_setting('test.a')::uuid,'{}')<>'null'::jsonb then raise exception 'Duplicate flashback reserved';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.b'),'role','authenticated')::text,true);
do $$ begin
 if exists(select 1 from public.flashbacks) then raise exception 'Cross-owner flashback read';end if;
 if exists(select 1 from public.push_devices) then raise exception 'Cross-owner device read';end if;
 begin perform public.respond_flashback(current_setting('test.flashback')::uuid,'irrelevant');raise exception 'Cross-owner feedback';exception when raise_exception then if sqlerrm='Cross-owner feedback' then raise;end if;end;
 begin insert into public.flashback_exclusions(note_id,user_id) values(current_setting('test.note')::uuid,current_setting('test.b')::uuid);raise exception 'Cross-owner exclusion';exception when insufficient_privilege then null;end;
end $$;
set local role anon;
do $$ begin
 begin perform * from public.flashbacks;raise exception 'Anonymous read';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.a'),'session_id',current_setting('test.session'),'role','authenticated')::text,true);
update public.recall_preferences set frequency='weekly',timezone=case when extract(hour from now() at time zone 'UTC')=23 then 'Etc/GMT+1' else 'UTC' end,window_start=0,window_end=23 where user_id=current_setting('test.a')::uuid;
set local role service_role;
do $$ begin
 if not(public.recall_service('users') ? current_setting('test.a')) then raise exception 'Eligible scheduler user not claimed';end if;
 if public.recall_service('users') ? current_setting('test.a') then raise exception 'Scheduler user claimed twice';end if;
end $$;
select set_config('test.delivery',public.recall_service('prepare_send',current_setting('test.a')::uuid)->'delivery'->>'id',true);
do $$ begin
 if current_setting('test.delivery')='' then raise exception 'Allowed send missing';end if;
 if public.recall_service('prepare_send',current_setting('test.a')::uuid)<>'null'::jsonb then raise exception 'Duplicate send';end if;
end $$;
select public.recall_service('sent',null,jsonb_build_object('id',current_setting('test.delivery'),'status','unknown','error','transport_ambiguous'));
do $$ begin
 if public.recall_service('prepare_send',current_setting('test.a')::uuid)<>'null'::jsonb then raise exception 'Ambiguous send was repeated';end if;
end $$;
update private.push_deliveries set status='sending' where id=current_setting('test.delivery')::uuid;
select public.recall_service('sent',null,jsonb_build_object('id',current_setting('test.delivery'),'status','retry','error','rate_limit'));
update private.push_deliveries set next_attempt_at=now()-interval '1 second' where id=current_setting('test.delivery')::uuid;
set local role authenticated;
update public.recall_preferences set window_start=case when extract(hour from now() at time zone timezone)=0 then 1 else 0 end,window_end=case when extract(hour from now() at time zone timezone)=0 then 2 else 1 end where user_id=current_setting('test.a')::uuid;
set local role service_role;
do $$ begin
 if public.recall_service('prepare_send',current_setting('test.a')::uuid)<>'null'::jsonb then raise exception 'Quiet hours bypassed on retry';end if;
end $$;
set local role authenticated;
update public.recall_preferences set window_start=0,window_end=23 where user_id=current_setting('test.a')::uuid;
set local role service_role;
do $$ declare retry jsonb;begin
 retry=public.recall_service('prepare_send',current_setting('test.a')::uuid);
 if retry->'delivery'->>'id'<>current_setting('test.delivery') or (retry->'delivery'->>'attempts')::int<>2 then raise exception 'Retry duplicated delivery';end if;
end $$;
select public.recall_service('sent',null,jsonb_build_object('id',current_setting('test.delivery'),'status','ticket','ticket','synthetic-ticket'));
update private.push_deliveries set receipt_after=now()-interval '1 second' where id=current_setting('test.delivery')::uuid;
do $$ begin
 if jsonb_array_length(public.recall_service('receipts'))<>1 then raise exception 'Receipt not claimed';end if;
 if jsonb_array_length(public.recall_service('receipts'))<>0 then raise exception 'Receipt claimed twice';end if;
end $$;
set local role authenticated;
select public.register_recall_device(current_setting('test.install')::uuid,'ExponentPushToken[rolled-synthetic-token]','android');
set local role service_role;
select public.recall_service('receipt',null,jsonb_build_object('id',current_setting('test.delivery'),'status','failed','error','DeviceNotRegistered'));
do $$ begin
 if not(select active from public.push_devices where installation_id=current_setting('test.install')::uuid) then raise exception 'Old receipt deactivated rolled token';end if;
end $$;
update private.push_deliveries set status='ticket',device_version=(select token_version from public.push_devices where installation_id=current_setting('test.install')::uuid) where id=current_setting('test.delivery')::uuid;
select public.recall_service('receipt',null,jsonb_build_object('id',current_setting('test.delivery'),'status','failed','error','DeviceNotRegistered'));
do $$ begin
 if (select active from public.push_devices where installation_id=current_setting('test.install')::uuid) then raise exception 'Invalid token stayed active';end if;
end $$;
update private.push_deliveries set status='sending',attempts=3 where id=current_setting('test.delivery')::uuid;
select public.recall_service('sent',null,jsonb_build_object('id',current_setting('test.delivery'),'status','retry','error','rate_limit'));
do $$ begin
 if (select status from private.push_deliveries where id=current_setting('test.delivery')::uuid)<>'failed' then raise exception 'Retry limit was not terminal';end if;
end $$;
-- History and cadence apply even after a card is hidden, independently of exclusions.
set local role authenticated;
select public.respond_flashback(current_setting('test.flashback')::uuid,'dismissed');
reset role;
select set_config('test.second_note',gen_random_uuid()::text,true);
insert into public.notes(id,user_id,content,created_at,updated_at) select current_setting('test.second_note')::uuid,user_id,content,now()-interval '40 days',now()-interval '40 days' from public.notes where id=current_setting('test.note')::uuid;
update public.note_contexts set status='completed',generated_context=(select generated_context from public.note_contexts where note_id=current_setting('test.note')::uuid) where note_id=current_setting('test.second_note')::uuid;
update private.recall_state set last_selected_at=now()-interval '4 days',last_checked_at=now()-interval '2 hours' where user_id=current_setting('test.a')::uuid;
set local role service_role;
do $$ begin
 if jsonb_array_length(public.recall_service('scan',current_setting('test.a')::uuid)->'candidates')<>0 then raise exception 'Weekly cooldown ignored';end if;
end $$;
set local role authenticated;
update public.recall_preferences set frequency='few' where user_id=current_setting('test.a')::uuid;
set local role service_role;
update private.recall_state set last_checked_at=now()-interval '2 hours' where user_id=current_setting('test.a')::uuid;
do $$ declare candidates jsonb;begin
 candidates=public.recall_service('scan',current_setting('test.a')::uuid)->'candidates';
 if jsonb_array_length(candidates)<>1 or candidates->0->>'id'<>current_setting('test.second_note') then raise exception 'Few cadence or 90-day history exclusion incorrect';end if;
end $$;
-- Restore the original card solely for the following invalidation checks.
update public.flashbacks set status='ready' where id=current_setting('test.flashback')::uuid;
delete from public.notes where id=current_setting('test.second_note')::uuid;
-- Meaningful edits invalidate flashbacks; existing note/context data remains independent.
set local role authenticated;
update public.notes set content='I am now considering a different project, and have not committed to anything.' where id=current_setting('test.note')::uuid;
do $$ begin
 if (select status from public.flashbacks where id=current_setting('test.flashback')::uuid)<>'expired' then raise exception 'Edited note retained stale flashback';end if;
end $$;
select public.respond_flashback(current_setting('test.flashback')::uuid,'irrelevant');
do $$ begin
 if not exists(select 1 from public.flashback_exclusions where note_id=current_setting('test.note')::uuid) then raise exception 'Not relevant did not exclude note';end if;
end $$;
update public.recall_preferences set frequency='off' where user_id=current_setting('test.a')::uuid;
set local role service_role;
update private.push_deliveries set status='retry',next_attempt_at=now() where id=current_setting('test.delivery')::uuid;
do $$ begin
 if public.recall_service('prepare_send',current_setting('test.a')::uuid)<>'null'::jsonb then raise exception 'Disabled preference allowed retry';end if;
 if extract(hour from timestamptz '2026-03-08 13:00Z' at time zone 'America/Chicago')<>8 then raise exception 'DST spring conversion incorrect';end if;
 if extract(hour from timestamptz '2026-11-01 06:30Z' at time zone 'America/Chicago')<>1 or extract(hour from timestamptz '2026-11-01 07:30Z' at time zone 'America/Chicago')<>1 then raise exception 'DST repeated hour incorrect';end if;
end $$;
-- Revoked sessions are never eligible delivery devices.
reset role;
delete from auth.sessions where id=current_setting('test.session')::uuid;
set local role service_role;
do $$ begin
 if private.recall_session_active(current_setting('test.session')::uuid,current_setting('test.a')::uuid) then raise exception 'Revoked session remains valid';end if;
end $$;
set local role authenticated;
delete from public.notes where id=current_setting('test.note')::uuid;
do $$ begin
 if exists(select 1 from public.flashbacks where id=current_setting('test.flashback')::uuid) then raise exception 'Flashback did not cascade';end if;
end $$;
rollback;
select 'PASS: recall owner isolation, off/private defaults, age/history reservation, quiet hours/retries, duplicate exclusion, tickets/receipts, token rollover, invalidation, feedback, session revocation, DST and cascade' as result;
