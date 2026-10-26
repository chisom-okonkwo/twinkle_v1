import type { Json } from './database.types';
export function importProvenance(value: Json | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.filename !== 'string' || typeof value.imported_at !== 'string') return null;
  return { filename: value.filename, importedAt: value.imported_at, title: typeof value.title === 'string' ? value.title : value.filename, originalDate: typeof value.original_created_at === 'string' ? value.original_created_at : null };
}
