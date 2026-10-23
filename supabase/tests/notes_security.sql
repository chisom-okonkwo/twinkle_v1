-- Run as the database owner in the Supabase SQL editor. All fixtures roll back.
begin;

select set_config('test.owner_a', gen_random_uuid()::text, true);
select set_config('test.owner_b', gen_random_uuid()::text, true);
insert into auth.users (id) values
  (current_setting('test.owner_a')::uuid),
  (current_setting('test.owner_b')::uuid);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.owner_a'), 'role', 'authenticated')::text, true);

with created as (
  insert into public.notes (content) values (E'  Original thought\n') returning id
) select set_config('test.note_id', id::text, true) from created;

do $$
declare before_update timestamptz;
begin
  if (select content from public.notes where id = current_setting('test.note_id')::uuid) <> E'  Original thought\n' then
    raise exception 'Original content was changed';
  end if;
  select updated_at into before_update from public.notes where id = current_setting('test.note_id')::uuid;
  update public.notes set content = 'Edited thought' where id = current_setting('test.note_id')::uuid;
  if not exists (select 1 from public.notes where id = current_setting('test.note_id')::uuid and content = 'Edited thought' and updated_at > before_update) then
    raise exception 'Owner update or timestamp failed';
  end if;
  begin
    update public.notes set user_id = current_setting('test.owner_b')::uuid where id = current_setting('test.note_id')::uuid;
    raise exception 'Ownership transfer was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.notes (content) values (E' \t\n\r');
    raise exception 'Blank note was allowed';
  exception when check_violation then null;
  end;
  begin
    insert into public.notes (content) values (repeat('a', 100001));
    raise exception 'Oversized note was allowed';
  exception when check_violation then null;
  end;
end;
$$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.owner_b'), 'role', 'authenticated')::text, true);
do $$
declare affected integer;
begin
  if exists (select 1 from public.notes where id = current_setting('test.note_id')::uuid) then
    raise exception 'Another user could read the note';
  end if;
  update public.notes set content = 'Intruder' where id = current_setting('test.note_id')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Another user could edit the note'; end if;
  delete from public.notes where id = current_setting('test.note_id')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Another user could delete the note'; end if;
  begin
    insert into public.notes (user_id, content) values (current_setting('test.owner_a')::uuid, 'Spoofed owner');
    raise exception 'Another user could spoof ownership';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role anon;
select set_config('request.jwt.claims', '{}', true);
do $$
begin
  begin
    perform 1 from public.notes;
    raise exception 'Unauthenticated access was allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.owner_a'), 'role', 'authenticated')::text, true);
do $$
declare affected integer;
begin
  delete from public.notes where id = current_setting('test.note_id')::uuid;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner delete failed'; end if;
end;
$$;

select 'PASS: owner CRUD, timestamp, content constraints, anonymous denial, and cross-user isolation' as result;
rollback;
