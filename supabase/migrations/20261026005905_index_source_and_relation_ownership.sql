-- Cover both columns of owner-safe foreign keys used by parent deletion checks.
create index note_sources_note_owner on public.note_sources(note_id,user_id);
create index related_runs_note_owner on public.related_note_runs(note_id,user_id);
create index note_relations_note_owner on public.note_relations(note_id,user_id);
