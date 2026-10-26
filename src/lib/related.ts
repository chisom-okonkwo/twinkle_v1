import { createRelatedRepository } from './related-repository';
import { getSupabase } from './supabase';
import { withDeadline } from './capture-network';
export type { RelatedNote } from './related-repository';
const repo = () => createRelatedRepository(getSupabase());
export const readRelatedNotes = (noteId: string, capture = false) => withDeadline(signal => repo().read(noteId, signal, capture), 15000);
export const relatedStatus = (userId: string, noteId: string) => withDeadline(signal => repo().status(userId, noteId, signal), 15000);
export async function requestRelatedNotes(noteId: string, retry = false) {
  return withDeadline(async signal => {
    const { data, error } = await getSupabase().functions.invoke('related-notes', { body: { noteId, retry }, signal, timeout: 20000 });
    if (error) {
      if (error.context && typeof error.context.json === 'function') {
        const detail = await error.context.json().catch(() => null);
        if (typeof detail?.error === 'string') throw new Error(detail.error);
      }
      throw new Error('Related thoughts could not be loaded. Your note is safe.');
    }
    return data as { status: string };
  }, 20000);
}

export const resurfacingEligible = (userId: string, noteId: string) => withDeadline(() => repo().eligible(userId,noteId),15000);
export const dismissRelatedNote = (noteId: string, relatedId: string) => withDeadline(() => repo().dismiss(noteId,relatedId),15000);

export const recordResurfacedNotes = (originId: string, noteIds: string[]) => withDeadline(async signal => {
  const {error} = await getSupabase().functions.invoke('discover-notes',{body:{action:'capture_seen',originId,noteIds},signal,timeout:15000});
  if(error) throw new Error('Could not record recently seen thoughts.');
},15000);
