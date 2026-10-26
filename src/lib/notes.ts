import { createNotesRepository, type NoteVersion, type NoteSource } from './notes-repository';
import { discardCapture } from './captures';
import { getSupabase } from './supabase';
import { startSavedContext } from './context';
import { createAttachmentsRepository } from './attachments-repository';
import { withDeadline } from './capture-network';

export { MAX_NOTE_LENGTH, NOTES_PAGE_SIZE, NoteConflictError } from './notes-repository';
export type { Note, NoteVersion } from './notes-repository';

export const listNotes = (userId: string, cursor?: NoteVersion) => createNotesRepository(getSupabase()).list(userId, cursor);
export const getNote = (userId: string, id: string) => createNotesRepository(getSupabase()).get(userId, id);
export const listAttachments = (noteId: string) => withDeadline(signal => createAttachmentsRepository(getSupabase()).list(noteId, signal), 15000);
export async function saveNoteWithAttachments(userId: string, noteId: string, content: string, captureIds: string[], previous?: NoteVersion, removedIds: string[] = [], initialCaptureId?: string) {
  const saved = await withDeadline(signal => createAttachmentsRepository(getSupabase()).save(noteId, content, captureIds, previous?.updated_at, signal, initialCaptureId), 20000);
  void startSavedContext(userId, saved.id).catch(() => {});
  for (const id of removedIds) void withDeadline(() => discardCapture(id), 12000).catch(() => {});
  return saved;
}
export async function saveNote(userId: string, content: string, previous?: NoteVersion, source?: NoteSource) {
  const saved = await createNotesRepository(getSupabase()).save(userId, content, previous, source);
  // A failed or interrupted AI request never changes whether the original saved.
  void startSavedContext(userId, saved.id).catch(() => {});
  return saved;
}
export async function deleteNote(userId: string, previous: NoteVersion & { source_capture_id?: string | null }) {
  const attachments = await listAttachments(previous.id).catch(() => []);
  const result = await createNotesRepository(getSupabase()).delete(userId, previous);
  // The note is already deleted; hourly cleanup retries a failed source removal.
  for (const id of new Set([...attachments.map(a => a.capture_id), ...(previous.source_capture_id ? [previous.source_capture_id] : [])])) void withDeadline(() => discardCapture(id), 12000).catch(() => {});
  return result;
}
