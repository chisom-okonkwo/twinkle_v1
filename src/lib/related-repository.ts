import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
export type RelatedNote = Database['public']['Functions']['read_related_notes']['Returns'][number];
export function createRelatedRepository(client: SupabaseClient<Database>) {
  return {
    async eligible(userId: string, noteId: string) {
      const { data, error } = await client.rpc('rediscovery_eligible', { target_id: noteId, owner_id: userId });
      if (error) throw error;
      return data === true;
    },
    async dismiss(noteId: string, relatedId: string) {
      const { error } = await client.rpc('dismiss_note_connection', { origin_id: noteId, target_id: relatedId });
      if (error) throw error;
    },
    async read(noteId: string, signal?: AbortSignal, capture = false) {
      let request = client.rpc(capture ? 'read_resurfaced_notes' : 'read_related_notes', { target_id: noteId });
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
