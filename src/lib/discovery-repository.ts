import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import type { DiscoveryRequest } from '../../supabase/functions/_shared/discovery-contract';
export type DiscoveryItem = { request_id: string; note_id: string; title: string; preview: string; created_at: string; capture_method: string; mode: 'surprise' | 'topic' };
export function createDiscoveryRepository(client: SupabaseClient<Database>) {
  return {
    async next(request: DiscoveryRequest, signal?: AbortSignal): Promise<DiscoveryItem | null> {
      const { data, error } = await client.functions.invoke('discover-notes', { body: request, signal, timeout: 20000 });
      if (error) throw new Error('Couldn’t discover a thought. Check your connection and try again.');
      if (!data || !Object.hasOwn(data,'item')) throw new Error('Discovery is unavailable. Please retry.');
      if (data.item === null) return null;
      const item = data.item as DiscoveryItem;
      if (typeof item.note_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(item.note_id) || item.request_id !== request.requestId || typeof item.title !== 'string' || typeof item.preview !== 'string' || typeof item.created_at !== 'string' || !['surprise','topic'].includes(item.mode)) throw new Error('Discovery is unavailable. Please retry.');
      return item;
    },
    async dismiss(userId: string, requestId: string) {
      const { data, error } = await client.from('note_discovery_history').update({ dismissed: true }).eq('user_id', userId).eq('request_id', requestId).select('request_id').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('This discovery is no longer available.');
    },
  };
}
