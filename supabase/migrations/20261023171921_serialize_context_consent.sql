create or replace function private.sync_note_context() returns trigger language plpgsql security definer set search_path='' as $$
declare fingerprint text; enabled boolean;
begin
  if auth.uid() is not null and auth.uid()<>new.user_id then raise exception 'Context owner mismatch'; end if;
  fingerprint=private.note_context_hash(new.content);
  select p.enabled into enabled from public.context_preferences p where p.user_id=new.user_id for share;
  insert into public.note_contexts(note_id,user_id,source_hash,status) values(new.id,new.user_id,fingerprint,case when coalesce(enabled,false) then 'pending' else 'disabled' end)
  on conflict(note_id) do update set source_hash=excluded.source_hash,revision=public.note_contexts.revision+1,
    status=excluded.status,generated_context=null,processing_token=null,processing_started_at=null,attempts=0,error_code=null,prompt_revision=null
    where public.note_contexts.source_hash<>excluded.source_hash;
  return new;
end $$;
