import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { normalizeContextInput } from '../../supabase/functions/_shared/context-contract';
import { createContextRepository } from './context-repository';
import { withDeadline } from './capture-network';
import { getSupabase } from './supabase';
export type { NoteContext } from './context-repository';
const repo = () => createContextRepository(getSupabase());
export const getContextPreference = (userId: string) => withDeadline(() => repo().preference(userId), 15000);
export const setContextPreference = (userId: string, enabled: boolean) => withDeadline(() => repo().setPreference(userId, enabled), 15000);
export const saveUserContext: ReturnType<typeof createContextRepository>['saveUserContext'] = (...args) => withDeadline(() => repo().saveUserContext(...args), 15000);
export const getNoteContext = (userId: string, noteId: string) => withDeadline(() => repo().get(userId, noteId), 15000);
export const contextHash = (content: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, normalizeContextInput(content));
export async function requestContext(noteId: string, options: { manual?: boolean; retry?: boolean } = {}) {
  return withDeadline(async (signal) => {
    const { data, error } = await getSupabase().functions.invoke('enrich-note', { body: { noteId, ...options }, signal, timeout: 20000 });
    if (error) {
      if (error.context && typeof error.context.json === 'function') {
        const detail = await error.context.json().catch(() => null);
        if (typeof detail?.error === 'string') throw new Error(detail.error);
      }
      throw new Error('Context could not be started. Your note is saved. Please retry.');
    }
    return data;
  }, 20000);
}
export async function startSavedContext(userId: string, noteId: string) {
  const context = await getNoteContext(userId, noteId);
  if (context.status === 'pending' || (context.status === 'processing' && Date.parse(context.processing_started_at ?? '') < Date.now() - 120000)) await requestContext(noteId);
}
export async function resumePendingContexts(userId: string) {
  const { data, error } = await withDeadline(async (signal) => await getSupabase().from('note_contexts').select('note_id')
    .eq('user_id', userId).or(`status.eq.pending,and(status.eq.processing,processing_started_at.lt.${new Date(Date.now() - 120000).toISOString()})`).limit(3).abortSignal(signal), 15000);
  if (error) throw error;
  await Promise.all((data ?? []).map((row) => startSavedContext(userId, row.note_id).catch(() => {})));
}
