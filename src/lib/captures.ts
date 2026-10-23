import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { Platform } from 'react-native';
import { checkSignature, MEDIA_BUCKET, type CaptureKind, type CaptureResult, validateMedia, validateResult } from '../../supabase/functions/_shared/capture-contract';
import { ensureUploaded, processWithRecovery, withDeadline } from './capture-network';
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

export async function stageCapture(userId: string, draft: CaptureDraft, options: { signal?: AbortSignal; onStaged?: (record: CaptureRecord) => void } = {}): Promise<CaptureRecord> {
  const api = getSupabase();
  const asset = draft.asset;
  validateMedia(asset.kind, asset.mime, asset.size);
  let record = draft.record;
  if (record) {
    // Draft state can still say pending after the server has finished processing.
    const latest = await withDeadline(async (signal) => await api.from('note_captures').select('*').eq('id', draft.record!.id).eq('user_id', userId).abortSignal(signal).single(), 15000, options.signal);
    if (latest.error) throw latest.error;
    record = latest.data;
  }
  if (!record) {
    const path = `${userId}/${asset.id}/source.${asset.mime === 'image/jpeg' ? 'jpg' : asset.mime === 'audio/mp4' ? 'm4a' : 'webm'}`;
    const inserted = await withDeadline(async (signal) => await api.from('note_captures').insert({ id: asset.id, kind: asset.kind, mime_type: asset.mime, byte_size: asset.size, storage_path: path }).select().abortSignal(signal).maybeSingle(), 15000, options.signal);
    if (inserted.error && inserted.error.code !== '23505') throw inserted.error;
    if (inserted.data) record = inserted.data;
    else {
      const existing = await withDeadline(async (signal) => await api.from('note_captures').select('*').eq('id', asset.id).eq('user_id', userId).abortSignal(signal).single(), 15000, options.signal);
      if (existing.error) throw existing.error;
      record = existing.data;
    }
  }
  if (!record || record.user_id !== userId || record.byte_size !== asset.size || record.kind !== asset.kind) throw new Error('The capture does not match its source. Please choose the source again.');
  options.onStaged?.(record);
  if (!asset.remote && record.status === 'pending') {
    const storage = api.storage.from(MEDIA_BUCKET);
    const path = record.storage_path;
    await ensureUploaded(asset.size, {
      info: async () => { const info = await storage.info(path); return info.error ? null : info.data; },
      upload: async () => {
        const bytes = Platform.OS === 'web' ? await (await fetch(asset.uri)).arrayBuffer() : await new File(asset.uri).arrayBuffer();
        validateMedia(asset.kind, asset.mime, bytes.byteLength);
        const uploaded = await storage.upload(path, bytes, { contentType: asset.mime, upsert: false, cacheControl: '0' });
        if (uploaded.error) {
          const status = Number('statusCode' in uploaded.error ? uploaded.error.statusCode : 0);
          if (status === 401 || status === 403) throw new Error('Upload not permitted. Please sign in again and retry.');
          if (status === 413) throw new Error('This file is too large for storage. Please choose a smaller source.');
          throw uploaded.error;
        }
      },
    }, options.signal);
  }
  return record;
}

async function invokeCapture(action: 'process' | 'discard', captureId: string, signal?: AbortSignal) {
  const { data, error } = await getSupabase().functions.invoke('capture', { body: { action, captureId }, signal, timeout: 110000 });
  if (error) {
    if (error.context && typeof error.context.json === 'function') {
      const detail = await error.context.json().catch(() => null);
      if (action === 'discard' && error.context.status === 404) return { discarded: true };
      if (typeof detail?.error === 'string') throw new Error(detail.error);
    }
    throw new Error('The request could not finish. Your source is retained for retry.');
  }
  return data;
}
export async function processCapture(id: string, signal?: AbortSignal): Promise<CaptureResult> {
  const readReady = async () => {
    const { data } = await withDeadline(async (requestSignal) => await getSupabase().from('note_captures').select('status,result').eq('id', id).abortSignal(requestSignal).maybeSingle(), 15000, signal);
    return data?.status === 'ready' && data.result ? validateResult(data.result) : null;
  };
  return processWithRecovery({ readReady, process: async () => validateResult(await invokeCapture('process', id, signal)) }, signal);
}
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
  const { data, error } = await withDeadline(async (signal) => await getSupabase().from('note_captures').select('*').eq('id', id).abortSignal(signal).single(), 15000);
  if (error) throw error;
  return { record: data, uri: await sourceUrl(data) };
}

export async function downloadSource(kind: string, uri: string, signal?: AbortSignal): Promise<CaptureAsset> {
  return withDeadline(async (requestSignal) => {
    const response = await expoFetch(uri, { signal: requestSignal });
    if (!response.ok) throw new Error('The private source could not be downloaded. Reload it and try again.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mime = kind === 'image' ? 'image/jpeg' : (response.headers.get('content-type')?.includes('webm') ? 'audio/webm' : 'audio/mp4');
    validateMedia(kind, mime, bytes.length); checkSignature(bytes, mime);
    const id = randomUUID();
    if (Platform.OS === 'web') return { id, uri: URL.createObjectURL(new Blob([bytes], { type: mime })), kind: kind as CaptureKind, size: bytes.length, mime, ownedCache: true };
    const file = new File(Paths.cache, `twinkle-review-${id}.${kind === 'image' ? 'jpg' : mime === 'audio/webm' ? 'webm' : 'm4a'}`);
    file.write(bytes);
    return { id, uri: file.uri, kind: kind as CaptureKind, size: bytes.length, mime, ownedCache: true };
  }, 20000, signal);
}
