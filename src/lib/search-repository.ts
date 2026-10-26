import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export const SEARCH_PAGE_SIZE = 20;
export const MAX_SEARCH_LENGTH = 200;
export const MAX_SEARCH_RESULTS = 1000;
export type SearchResult = Database['public']['Functions']['search_notes']['Returns'][number];

export function normalizeSearch(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

// Ownership is derived from the authenticated session inside the invoker RPC + RLS.
// POST keeps private search words out of request URLs and navigation parameters.
export function createSearchRepository(client: SupabaseClient<Database>) {
  return {
    async search(text: string, offset = 0, signal?: AbortSignal) {
      const query = normalizeSearch(text);
      if (Array.from(query).length > MAX_SEARCH_LENGTH)
        throw new Error('Keep searches under 200 characters.');
      if (!Number.isInteger(offset) || offset < 0 || offset >= MAX_SEARCH_RESULTS)
        throw new Error('Try a more specific search to find more notes.');
      if (!query || !/[\p{L}\p{N}]/u.test(query)) return { results: [], hasMore: false, nextOffset: 0 };
      let request = client.rpc('search_notes', {
        search_text: query,
        page_limit: SEARCH_PAGE_SIZE + 1,
        page_offset: offset,
      });
      if (signal) request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      return {
        results: (data ?? []).slice(0, SEARCH_PAGE_SIZE),
        hasMore: (data?.length ?? 0) > SEARCH_PAGE_SIZE && offset + SEARCH_PAGE_SIZE < MAX_SEARCH_RESULTS,
        nextOffset: offset + Math.min(data?.length ?? 0, SEARCH_PAGE_SIZE),
      };
    },
  };
}
