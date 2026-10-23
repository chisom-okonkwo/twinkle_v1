import { getSupabase } from './supabase';
import { createRecallRepository } from './recall-repository';
import { withDeadline } from './capture-network';
export * from './recall-repository';
export const recallRepository = () => createRecallRepository(getSupabase());
export async function refreshFlashback(userId: string) {
  const response = await withDeadline(
    (signal) => getSupabase().functions.invoke('flashbacks', { body: {}, signal }),
    20000,
  );
  if (response.error) {
    const detail = await response.error.context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? 'Could not refresh flashbacks. Try again later.');
  }
  return response.data.id
    ? recallRepository().get(userId, response.data.id)
    : recallRepository().current(userId);
}
