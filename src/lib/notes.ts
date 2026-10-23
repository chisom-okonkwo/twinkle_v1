import { createNotesRepository, type NoteVersion } from './notes-repository';
import { getSupabase } from './supabase';

export { MAX_NOTE_LENGTH, NOTES_PAGE_SIZE, NoteConflictError } from './notes-repository';
export type { Note, NoteVersion } from './notes-repository';

export const listNotes = (userId: string, cursor?: NoteVersion) => createNotesRepository(getSupabase()).list(userId, cursor);
export const getNote = (userId: string, id: string) => createNotesRepository(getSupabase()).get(userId, id);
export const saveNote = (userId: string, content: string, previous?: NoteVersion) => createNotesRepository(getSupabase()).save(userId, content, previous);
export const deleteNote = (userId: string, previous: NoteVersion) => createNotesRepository(getSupabase()).delete(userId, previous);
