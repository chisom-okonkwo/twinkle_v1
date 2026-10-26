import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import type { ImportDraft, ImportResult } from './import-contract';
export function createImportRepository(client: SupabaseClient<Database>) {
  return {
    async save(draft: ImportDraft, signal?: AbortSignal): Promise<ImportResult> {
      let query = client.rpc('import_text_note', { file_name: draft.filename, body: draft.content, metadata: draft.metadata });
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw error;
      if (!data || typeof data !== 'object' || Array.isArray(data) || !['imported', 'skipped'].includes(String(data.status)) || typeof data.id !== 'string') throw new Error('The import result could not be confirmed. Please retry.');
      return data as ImportResult;
    },
  };
}
