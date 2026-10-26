import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
export type RelatedNote = Database['public']['Functions']['read_related_notes']['Returns'][number];
export function createRelatedRepository(client: SupabaseClient<Database>) {
  return {
    async read(noteId: string, signal?: AbortSignal) {
      let request = client.rpc('read_related_notes', { target_id: noteId });
      if (signal) request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      return data ?? [];
    },
    async status(userId: string, noteId: string, signal?: AbortSignal) {
      let request = client.from('related_note_runs').select('status,started_at').eq('note_id', noteId).eq('user_id', userId);
      if (signal) request = request.abortSignal(signal);
      const { data, error } = await request.maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}
