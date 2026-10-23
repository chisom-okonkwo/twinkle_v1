import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
export type NoteContext = Database['public']['Tables']['note_contexts']['Row'];
export function createContextRepository(client: SupabaseClient<Database>) {
  return {
    async preference(userId: string) {
      const { data, error } = await client.from('context_preferences').select('enabled').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return data?.enabled ?? false;
    },
    async setPreference(userId: string, enabled: boolean) {
      const inserted = await client.from('context_preferences').insert({ user_id: userId, enabled });
      if (inserted.error?.code === '23505') {
        const updated = await client.from('context_preferences').update({ enabled }).eq('user_id', userId).select('enabled').single();
        if (updated.error) throw updated.error;
      } else if (inserted.error) throw inserted.error;
      return enabled;
    },
    async get(userId: string, noteId: string) {
      const { data, error } = await client.from('note_contexts').select('*').eq('user_id', userId).eq('note_id', noteId).single();
      if (error) throw error;
      return data;
    },
    async saveUserContext(userId: string, previous: NoteContext, values: { user_context?: string; answer?: string; prompt_dismissed?: boolean }) {
      if (Array.from(values.user_context ?? '').length > 4000 || Array.from(values.answer ?? '').length > 2000) throw new Error('Keep added context under 4,000 characters and answers under 2,000 characters.');
      const { data, error } = await client.from('note_contexts').update(values).eq('user_id', userId).eq('note_id', previous.note_id).eq('user_version', previous.user_version).select().maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Your added context changed in another session. Keep a copy of your changes, then reload context.');
      return data;
    },
  };
}
