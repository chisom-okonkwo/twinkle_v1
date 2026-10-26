-- Reuse recall invalidation to retire an already-prepared card/retry after the thought is seen elsewhere.
create trigger discovery_retires_flashback after insert or update of shown_at on public.note_discovery_history for each row execute function private.invalidate_flashbacks();
