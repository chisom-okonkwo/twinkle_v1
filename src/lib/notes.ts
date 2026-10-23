import { createNotesRepository, type NoteVersion, type NoteSource } from './notes-repository';
import { discardCapture } from './captures';
import { getSupabase } from './supabase';

export { MAX_NOTE_LENGTH, NOTES_PAGE_SIZE, NoteConflictError } from './notes-repository';
export type { Note, NoteVersion } from './notes-repository';

export const listNotes = (userId: string, cursor?: NoteVersion) => createNotesRepository(getSupabase()).list(userId, cursor);
export const getNote = (userId: string, id: string) => createNotesRepository(getSupabase()).get(userId, id);
export const saveNote = (userId: string, content: string, previous?: NoteVersion, source?: NoteSource) => createNotesRepository(getSupabase()).save(userId, content, previous, source);
export async function deleteNote(userId: string, previous: NoteVersion & { source_capture_id?: string | null }) {
  const result = await createNotesRepository(getSupabase()).delete(userId, previous);
  // The note is already deleted; hourly cleanup retries a failed source removal.
  if (previous.source_capture_id) await discardCapture(previous.source_capture_id).catch(() => {});
  return result;
}
