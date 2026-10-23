import type { Database } from './database.types';
import { getSupabase } from './supabase';

export type Note = Database['public']['Tables']['notes']['Row'];
export const MAX_NOTE_LENGTH = 100_000;

function validateContent(content: string) {
  if (!content.trim()) throw new Error('Write something before saving your note.');
  if (Array.from(content).length > MAX_NOTE_LENGTH) throw new Error('Please keep notes under 100,000 characters.');
}

export async function listNotes(userId: string, offset = 0) {
  const { data, error } = await getSupabase().from('notes').select('*')
    .eq('user_id', userId).order('updated_at', { ascending: false }).order('id')
    .range(offset, offset + 29);
  if (error) throw error;
  return data;
}

export async function saveNote(userId: string, content: string, id?: string) {
  validateContent(content);
  const client = getSupabase();
  const query = id
    ? client.from('notes').update({ content }).eq('id', id).eq('user_id', userId)
    : client.from('notes').insert({ user_id: userId, content });
  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

export async function deleteNote(userId: string, id: string) {
  const { data, error } = await getSupabase().from('notes').delete()
    .eq('id', id).eq('user_id', userId).select('id').single();
  if (error) throw error;
  return data;
}
