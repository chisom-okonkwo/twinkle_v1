import { File, FileMode, Paths } from 'expo-file-system';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { Platform } from 'react-native';
import { MAX_IMPORT_BYTES, readImport } from './import-contract';
import type { ImportDraft } from './import-contract';
import { createImportRepository } from './import-repository';
import { getSupabase } from './supabase';
import { withDeadline } from './capture-network';

export async function readImportAsset(asset: DocumentPickerAsset) {
  if (!/\.(txt|md)$/i.test(asset.name)) throw new Error('Choose a .txt or .md file.');
  if (asset.size !== undefined && asset.size > MAX_IMPORT_BYTES) throw new Error('This file is larger than 256 KB.');
  let bytes: Uint8Array;
  if (Platform.OS === 'web') {
    if (!asset.file || asset.file.size > MAX_IMPORT_BYTES) throw new Error('This file could not be read, or is larger than 256 KB.');
    bytes = new Uint8Array(await asset.file.arrayBuffer());
  } else {
    const file = new File(asset.uri);
    if (!file.exists) throw new Error('This file is no longer available. Please choose it again.');
    if (file.size > MAX_IMPORT_BYTES) throw new Error('This file is larger than 256 KB.');
    const handle = file.open(FileMode.ReadOnly);
    try { bytes = await handle.readBytes(MAX_IMPORT_BYTES + 1); } finally { handle.close(); }
  }
  return readImport(asset.name, bytes);
}

export function releaseImportAsset(asset: DocumentPickerAsset) {
  // Delete only the private picker cache copy, never the user's original file.
  if (Platform.OS !== 'web' && asset.uri.startsWith(Paths.cache.uri)) {
    try { const file = new File(asset.uri); if (file.exists) file.delete(); } catch {}
  }
}
export function importNote(draft: ImportDraft, signal?: AbortSignal) {
  return withDeadline(inner => createImportRepository(getSupabase()).save(draft, inner), 20000, signal);
}
