-- Transactional security checks; fixtures roll back and no media is uploaded.
begin;
select set_config('test.capture_owner',gen_random_uuid()::text,true);
select set_config('test.capture_other',gen_random_uuid()::text,true);
select set_config('test.capture_id',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.capture_owner')::uuid),(current_setting('test.capture_other')::uuid);
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.capture_owner'),'role','authenticated')::text,true);
insert into public.note_captures(id,kind,mime_type,byte_size,storage_path) values(
  current_setting('test.capture_id')::uuid,'image','image/jpeg',100,
  current_setting('test.capture_owner')||'/'||current_setting('test.capture_id')||'/source.jpg');
do $$
begin
  begin
    update public.note_captures set status='ready',result='{"text":"forged"}';
    raise exception 'Client could forge a processing result';
  exception when insufficient_privilege then null; end;
  begin
    perform public.claim_note_capture(current_setting('test.capture_id')::uuid,current_setting('test.capture_owner')::uuid);
    raise exception 'Client could call a privileged processing RPC';
  exception when insufficient_privilege then null; end;
  begin
    perform public.authorize_capture_cleanup('guess');
    raise exception 'Client could call maintenance authorization';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.notes(user_id,content,capture_method,source_capture_id) values(current_setting('test.capture_owner')::uuid,'Unreviewed source','image',current_setting('test.capture_id')::uuid);
    raise exception 'Client could save an unprocessed capture';
  exception when raise_exception then
    if sqlerrm='Client could save an unprocessed capture' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.capture_other'),'role','authenticated')::text,true);
do $$
begin
  if exists(select 1 from public.note_captures where id=current_setting('test.capture_id')::uuid) then raise exception 'Cross-user capture read allowed'; end if;
end $$;
set local role service_role;
do $$
declare first_claim public.note_captures; cached public.note_captures;
begin
  select * into first_claim from public.claim_note_capture(current_setting('test.capture_id')::uuid,current_setting('test.capture_owner')::uuid);
  if first_claim.status<>'processing' or first_claim.attempts<>1 then raise exception 'Claim did not transition atomically'; end if;
  begin
    perform public.claim_note_capture(current_setting('test.capture_id')::uuid,current_setting('test.capture_owner')::uuid);
    raise exception 'Duplicate concurrent processing allowed';
  exception when raise_exception then if sqlerrm<>'CAPTURE_BUSY' then raise; end if; end;
  update public.note_captures set status='ready',result='{"text":"Hello","empty":false,"warnings":[]}' where id=first_claim.id;
  select * into cached from public.claim_note_capture(first_claim.id,current_setting('test.capture_owner')::uuid);
  if cached.attempts<>1 or cached.status<>'ready' then raise exception 'Cached result consumed another attempt'; end if;
  begin
    perform public.claim_capture_deletion(first_claim.id,null);
    raise exception 'Cleanup could delete an unexpired capture';
  exception when raise_exception then if sqlerrm<>'CAPTURE_NOT_EXPIRED' then raise; end if; end;
end $$;
set local role anon;
do $$
begin
  begin perform 1 from public.note_captures; raise exception 'Anonymous capture read allowed';
  exception when insufficient_privilege then null; end;
end $$;
select 'PASS: capture ownership, privileged RPC denial, pending-note rejection, atomic processing, cache reuse, and expiry protection' as result;
rollback;
