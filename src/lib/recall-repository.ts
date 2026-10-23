import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
export type Flashback = Database['public']['Tables']['flashbacks']['Row'];
export type RecallPreferences = Database['public']['Tables']['recall_preferences']['Row'];
export type RecallSettings = Pick<
  RecallPreferences,
  'frequency' | 'timezone' | 'window_start' | 'window_end' | 'detailed_previews'
>;
export const defaultRecallSettings = (timezone = 'UTC'): RecallSettings => ({
  frequency: 'off',
  timezone,
  window_start: 9,
  window_end: 20,
  detailed_previews: false,
});
export function createRecallRepository(client: SupabaseClient<Database>) {
  return {
    async preferences(userId: string) {
      const result = await client.from('recall_preferences').select('*').eq('user_id', userId).maybeSingle();
      if (result.error) throw result.error;
      return result.data;
    },
    async savePreferences(userId: string, input: RecallSettings) {
      const values: RecallSettings = {
        frequency: input.frequency,
        timezone: input.timezone,
        window_start: input.window_start,
        window_end: input.window_end,
        detailed_previews: input.detailed_previews,
      };
      if (
        !['off', 'weekly', 'few'].includes(values.frequency) ||
        !Number.isInteger(values.window_start) ||
        !Number.isInteger(values.window_end) ||
        values.window_start < 0 ||
        values.window_end > 23 ||
        values.window_start >= values.window_end
      )
        throw new Error('Choose a valid delivery window.');
      try {
        new Intl.DateTimeFormat('en', { timeZone: values.timezone });
      } catch {
        throw new Error('Choose a valid time zone.');
      }
      const inserted = await client
        .from('recall_preferences')
        .insert({ user_id: userId, ...values })
        .select()
        .maybeSingle();
      if (inserted.error?.code !== '23505') {
        if (inserted.error) throw inserted.error;
        return inserted.data!;
      }
      const updated = await client
        .from('recall_preferences')
        .update(values)
        .eq('user_id', userId)
        .select()
        .single();
      if (updated.error) throw updated.error;
      return updated.data;
    },
    async get(userId: string, id: string) {
      const result = await client
        .from('flashbacks')
        .select('*')
        .eq('user_id', userId)
        .eq('id', id)
        .eq('status', 'ready')
        .maybeSingle();
      if (result.error) throw result.error;
      return result.data;
    },
    async current(userId: string) {
      const result = await client
        .from('flashbacks')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'ready')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (result.error) throw result.error;
      return result.data;
    },
    async feedback(id: string, value: 'dismissed' | 'irrelevant') {
      const result = await client.rpc('respond_flashback', { target_id: id, feedback: value });
      if (result.error) throw result.error;
    },
    async excluded(userId: string, noteId: string) {
      const result = await client
        .from('flashback_exclusions')
        .select('note_id')
        .eq('note_id', noteId)
        .eq('user_id', userId)
        .maybeSingle();
      if (result.error) throw result.error;
      return !!result.data;
    },
    async exclude(userId: string, noteId: string, excluded: boolean) {
      const result = excluded
        ? await client
            .from('flashback_exclusions')
            .upsert({ note_id: noteId, user_id: userId }, { onConflict: 'note_id', ignoreDuplicates: true })
        : await client.from('flashback_exclusions').delete().eq('user_id', userId).eq('note_id', noteId);
      if (result.error) throw result.error;
    },
  };
}
