create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  content text not null check (char_length(btrim(content, E' \t\n\r')) between 1 and 100000),
  capture_method text not null default 'text' check (capture_method in ('text', 'image', 'audio')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_user_updated_idx on public.notes (user_id, updated_at desc, id);

alter table public.notes enable row level security;

revoke all on public.notes from public, anon, authenticated;
grant select, delete on public.notes to authenticated;
grant insert (user_id, content) on public.notes to authenticated;
grant update (content) on public.notes to authenticated;

create policy "Owners can read notes" on public.notes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Owners can create notes" on public.notes for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Owners can edit notes" on public.notes for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Owners can delete notes" on public.notes for delete to authenticated
  using ((select auth.uid()) = user_id);

create function public.set_note_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke all on function public.set_note_updated_at() from public, anon, authenticated;

create trigger notes_updated_at before update on public.notes
  for each row execute function public.set_note_updated_at();
