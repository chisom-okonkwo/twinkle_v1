import { createSearchRepository } from './search-repository';
import { getSupabase } from './supabase';
import { withDeadline } from './capture-network';

export { MAX_SEARCH_LENGTH, MAX_SEARCH_RESULTS, normalizeSearch, SEARCH_PAGE_SIZE } from './search-repository';
export type { SearchResult } from './search-repository';
export const searchNotes = (query: string, offset = 0, signal?: AbortSignal) =>
  withDeadline((deadline) => createSearchRepository(getSupabase()).search(query, offset, deadline), 10000, signal);
