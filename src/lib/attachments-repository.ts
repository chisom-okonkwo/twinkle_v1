import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { NoteConflictError, validateNoteContent } from './notes-repository.ts';
import { normalizeNoteTitle } from './note-title.ts';
export const MAX_NOTE_ATTACHMENTS = 10;
export type NoteAttachment = { capture_id: string; kind: string; created_at: string };
export function appendCaptureText(content: string, extracted: string) {
  if (!extracted.trim()) return content;
  const next = content.length ? `${content}\n\n${extracted}` : extracted;
  validateNoteContent(next);
  return next;
}
export function createAttachmentsRepository(client: SupabaseClient<Database>) {
  return {
    async list(noteId: string, signal?: AbortSignal): Promise<NoteAttachment[]> {
      let query = client.rpc('list_note_attachments', { target_id: noteId });
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    async save(noteId: string, content: string, captureIds: string[], expected?: string, signal?: AbortSignal, initialCaptureId?: string, title?: string) {
      if (content.trim() || !captureIds.length) validateNoteContent(content);
      if (captureIds.length > MAX_NOTE_ATTACHMENTS || new Set(captureIds).size !== captureIds.length) throw new Error('Keep up to 10 different photos or recordings in one note.');
      let query = client.rpc('save_note_with_attachments', { target_id: noteId, body: content, capture_ids: captureIds, ...(expected ? { expected_updated_at: expected } : {}), ...(initialCaptureId ? { initial_capture_id: initialCaptureId } : {}), ...(title !== undefined ? { note_title: normalizeNoteTitle(title) } : {}) });
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query.single();
      if (error?.message.includes('NOTE_CONFLICT') || error?.code === '23505') throw new NoteConflictError();
      if (error) throw error;
      if (!data) throw new NoteConflictError();
      return data;
    },
  };
}
