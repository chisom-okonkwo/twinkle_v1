import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export type Note = Database['public']['Tables']['notes']['Row'];
export type NoteVersion = Pick<Note, 'id' | 'updated_at'>;
export const MAX_NOTE_LENGTH = 100_000;
export const NOTES_PAGE_SIZE = 30;

export function validateNoteContent(content: string) {
  if (!content.trim()) throw new Error('Write something before saving your note.');
  if (Array.from(content).length > MAX_NOTE_LENGTH) throw new Error('Please keep notes under 100,000 characters.');
}

export class NoteConflictError extends Error {
  constructor() {
    super('This note changed or was deleted in another session. Your text is still here. Copy any changes you want to keep before reloading.');
    this.name = 'NoteConflictError';
  }
}

// RLS enforces ownership. Explicit owner filters also document the intended scope.
// This boundary can run against the live API without importing native modules.
export function createNotesRepository(client: SupabaseClient<Database>) {
  return {
    async list(userId: string, cursor?: NoteVersion) {
      let query = client.from('notes').select('*').eq('user_id', userId)
        .order('updated_at', { ascending: false }).order('id', { ascending: false })
        .limit(NOTES_PAGE_SIZE);
      if (cursor) {
        query = query.or(`updated_at.lt.${cursor.updated_at},and(updated_at.eq.${cursor.updated_at},id.lt.${cursor.id})`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    async get(userId: string, id: string) {
      const { data, error } = await client.from('notes').select('*')
        .eq('user_id', userId).eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('This note is no longer available. It may have been deleted in another session.');
      return data;
    },
    async save(userId: string, content: string, previous?: NoteVersion) {
      validateNoteContent(content);
      const query = previous
        ? client.from('notes').update({ content }).eq('user_id', userId)
          .eq('id', previous.id).eq('updated_at', previous.updated_at)
        : client.from('notes').insert({ user_id: userId, content });
      const { data, error } = await query.select().maybeSingle();
      if (error) throw error;
      if (!data) throw new NoteConflictError();
      return data;
    },
    async delete(userId: string, previous: NoteVersion) {
      const { data, error } = await client.from('notes').delete()
        .eq('user_id', userId).eq('id', previous.id).eq('updated_at', previous.updated_at)
        .select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new NoteConflictError();
      return data;
    },
  };
}
