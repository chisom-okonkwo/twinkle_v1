import type { SupabaseClient } from '@supabase/supabase-js';
import { validateSource, type SourceValues } from '../../supabase/functions/_shared/source-contract.ts';
import type { Database } from './database.types';
export type NoteSource = Database['public']['Tables']['note_sources']['Row'];
export function createSourcesRepository(client: SupabaseClient<Database>) {
  return {
    async get(userId: string, noteId: string) {
      const { data, error } = await client.from('note_sources').select('*').eq('user_id', userId).eq('note_id', noteId).single();
      if (error) throw error;
      return data;
    },
    async save(userId: string, previous: NoteSource, values: SourceValues) {
      const { data, error } = await client.from('note_sources').update(validateSource(values)).eq('user_id', userId).eq('note_id', previous.note_id).eq('version', previous.version).select().maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('This source changed in another session. Copy your changes, then reload the source.');
      return data;
    },
  };
}
