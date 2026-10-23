import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { MEDIA_BUCKET, type CaptureKind, type CaptureResult, validateMedia, validateResult } from '../../supabase/functions/_shared/capture-contract';
import type { Database } from './database.types';
import { getSupabase } from './supabase';

export type CaptureRecord = Database['public']['Tables']['note_captures']['Row'];
export type CaptureAsset = { id: string; uri: string; kind: CaptureKind; mime: string; size: number; remote?: boolean; ownedCache?: boolean };
export type CaptureDraft = { asset: CaptureAsset; record?: CaptureRecord; processed: boolean; warnings: string[]; remoteAttempted?: boolean };
export { MAX_RECORDING_SECONDS, MAX_MEDIA_BYTES } from '../../supabase/functions/_shared/capture-contract';
export type { CaptureKind, CaptureResult };

export async function localAsset(uri: string, kind: CaptureKind, mime: string, ownedCache = false): Promise<CaptureAsset> {
  const size = Platform.OS === 'web' ? (await (await fetch(uri)).blob()).size : new File(uri).size;
  validateMedia(kind, mime, size);
  return { id: randomUUID(), uri, kind, mime, size, ownedCache };
}

export function removeLocalAsset(asset: CaptureAsset) {
  if (!asset.ownedCache || asset.remote) return;
  try {
    if (Platform.OS !== 'web' && asset.uri.startsWith('file://')) new File(asset.uri).delete();
    else if (Platform.OS === 'web' && asset.uri.startsWith('blob:')) URL.revokeObjectURL(asset.uri);
  } catch { /* Cache eviction is safe; never delete a user's library original. */ }
}

export async function stageCapture(userId: string, draft: CaptureDraft): Promise<CaptureRecord> {
  const api = getSupabase();
  const asset = draft.asset;
  validateMedia(asset.kind, asset.mime, asset.size);
  let record = draft.record;
  if (!record) {
    const path = `${userId}/${asset.id}/source.${asset.mime === 'image/jpeg' ? 'jpg' : asset.mime === 'audio/mp4' ? 'm4a' : 'webm'}`;
    const inserted = await api.from('note_captures').insert({ id: asset.id, kind: asset.kind, mime_type: asset.mime, byte_size: asset.size, storage_path: path }).select().maybeSingle();
    if (inserted.error && inserted.error.code !== '23505') throw inserted.error;
    if (inserted.data) record = inserted.data;
    else {
      const existing = await api.from('note_captures').select('*').eq('id', asset.id).eq('user_id', userId).single();
      if (existing.error) throw existing.error;
      record = existing.data;
    }
  }
  if (!record || record.user_id !== userId || record.byte_size !== asset.size || record.kind !== asset.kind) throw new Error('The capture does not match its source. Please choose the source again.');
  if (!asset.remote && record.status === 'pending') {
    const bytes = Platform.OS === 'web' ? await (await fetch(asset.uri)).arrayBuffer() : await new File(asset.uri).arrayBuffer();
    validateMedia(asset.kind, asset.mime, bytes.byteLength);
    const uploaded = await api.storage.from(MEDIA_BUCKET).upload(record.storage_path, bytes, { contentType: asset.mime, upsert: false, cacheControl: '0' });
    if (uploaded.error) {
      // A timed-out upload may already have completed. Never overwrite the source.
      const existing = await api.storage.from(MEDIA_BUCKET).info(record.storage_path);
      if (existing.error || Number(existing.data?.metadata?.size) !== asset.size) throw new Error('The source could not be uploaded. It is still available here; please retry.');
    }
  }
  return record;
}

async function invokeCapture(action: 'process' | 'discard', captureId: string, signal?: AbortSignal) {
  const { data, error } = await getSupabase().functions.invoke('capture', { body: { action, captureId }, signal, timeout: 110000 });
  if (error) {
    if (error.context instanceof Response) {
      const detail = await error.context.json().catch(() => null);
      if (action === 'discard' && error.context.status === 404) return { discarded: true };
      if (typeof detail?.error === 'string') throw new Error(detail.error);
    }
    throw new Error('The request could not finish. Your source is retained for retry.');
  }
  return data;
}
export const processCapture = async (id: string, signal?: AbortSignal): Promise<CaptureResult> => validateResult(await invokeCapture('process', id, signal));
export const discardCapture = async (id: string) => { await invokeCapture('discard', id); };
export async function discardDraft(draft: CaptureDraft) {
  // Even if staging timed out before returning, its stable ID allows cleanup.
  if (draft.record || draft.remoteAttempted) await discardCapture(draft.record?.id ?? draft.asset.id);
  removeLocalAsset(draft.asset);
}
export async function unfinishedCaptures(userId: string) {
  const { data, error } = await getSupabase().from('note_captures').select('*').eq('user_id', userId)
    .in('status', ['pending', 'failed', 'ready', 'processing']).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(5);
  if (error) throw error;
  return data;
}
export async function sourceUrl(record: CaptureRecord) {
  const { data, error } = await getSupabase().storage.from(MEDIA_BUCKET).createSignedUrl(record.storage_path, 600);
  if (error) throw new Error('The private source could not be opened. Please retry.');
  return data.signedUrl;
}
export async function loadSavedSource(id: string) {
  const { data, error } = await getSupabase().from('note_captures').select('*').eq('id', id).single();
  if (error) throw error;
  return { record: data, uri: await sourceUrl(data) };
}
