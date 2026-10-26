-- Wait for pending context; serialize deletion safely during auth-user cascades.
create or replace function private.invalidate_note_relations() returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid; target uuid;
begin
 if tg_table_name='context_preferences' then
  if tg_op='UPDATE' and new.enabled=old.enabled then return null; end if;
  owner_id=new.user_id;
 else
  if tg_op='UPDATE' then
   if tg_table_name='notes' then
    if private.note_context_hash(new.content)=private.note_context_hash(old.content) then return null; end if;
   end if;
   if tg_table_name='note_contexts' and (to_jsonb(new)-array['status','processing_token','processing_started_at','attempts','last_completed_at','model','error_code'])=(to_jsonb(old)-array['status','processing_token','processing_started_at','attempts','last_completed_at','model','error_code']) then return null; end if;
  end if;
  if tg_op='DELETE' then owner_id=old.user_id; target=old.id;
  else owner_id=new.user_id; if tg_table_name='notes' then target=new.id; else target=new.note_id; end if; end if;
 end if;
 if not exists(select 1 from auth.users where id=owner_id) then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,1415));
 insert into private.related_library(user_id) values(owner_id) on conflict(user_id) do update set revision=private.related_library.revision+1;
 delete from public.related_note_runs where user_id=owner_id;
 if target is null then delete from public.note_relations where user_id=owner_id;
 else delete from public.note_relations where user_id=owner_id and (note_id=target or related_id=target); end if;
 return null;
end $$;

create or replace function public.claim_related_notes(target_id uuid,caller_id uuid,retry boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare revision bigint; used integer; r public.related_note_runs;
begin
 perform pg_advisory_xact_lock(hashtextextended(caller_id::text,1415));
 if not exists(select 1 from public.notes where id=target_id and user_id=caller_id) then raise exception 'NOT_FOUND'; end if;
 if not exists(select 1 from public.context_preferences where user_id=caller_id and enabled) then return jsonb_build_object('status','disabled'); end if;
 if exists(select 1 from public.note_contexts where note_id=target_id and user_id=caller_id and (status='pending' or status='processing' and processing_started_at>now()-interval '2 minutes')) then return jsonb_build_object('status','waiting_context'); end if;
 insert into private.related_library(user_id) values(caller_id) on conflict do nothing;
 select l.revision into revision from private.related_library l where user_id=caller_id;
 select * into r from public.related_note_runs where note_id=target_id and user_id=caller_id;
 if r.library_revision=revision then
  if r.status='completed' and r.completed_at>now()-interval '1 day' then return jsonb_build_object('status','completed'); end if;
  if r.status='processing' and r.started_at>now()-interval '2 minutes' then return jsonb_build_object('status','processing'); end if;
  if r.status='failed' and (not retry or r.started_at>now()-interval '30 seconds') then return jsonb_build_object('status','failed'); end if;
 end if;
 update private.related_library l set window_start=date_trunc('hour',now()),attempts=case when l.window_start=date_trunc('hour',now()) then l.attempts+1 else 1 end where user_id=caller_id returning attempts into used;
 if used>12 then raise exception 'RATE_LIMIT'; end if;
 insert into public.related_note_runs(note_id,user_id,status,library_revision) values(target_id,caller_id,'processing',revision)
 on conflict(note_id) do update set status='processing',token=gen_random_uuid(),library_revision=excluded.library_revision,started_at=now(),completed_at=null,model=null returning * into r;
 return jsonb_build_object('status','claimed','token',r.token,'revision',revision);
end $$;
