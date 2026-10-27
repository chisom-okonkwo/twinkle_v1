-- Fixed search paths must not rely on pgvector equality operator lookup.
create or replace function private.semantic_embedding_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin new.relations_current=false;return new;end $$;
