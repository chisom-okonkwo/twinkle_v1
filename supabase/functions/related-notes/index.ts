import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { relatedTerms, relatedLinks } from '../_shared/related-ai.ts';
import type { RelatedInput } from '../_shared/related-contract.ts';
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(10000) }) } });
type Claim = { status: string; token: string; revision: number };
async function process(noteId: string, userId: string, claim: Claim) {
  try {
    const key = Deno.env.get('OPENAI_API_KEY'); if (!key) throw new Error('configuration');
    const config = { key, model: Deno.env.get('OPENAI_RELATED_MODEL') ?? Deno.env.get('OPENAI_CONTEXT_MODEL') ?? 'gpt-6-luna' };
    const input = await admin.rpc('related_note_input', { target_id: noteId, caller_id: userId });
    if (input.error || !input.data) throw new Error('missing');
    const origin = input.data as RelatedInput;
    const terms = await relatedTerms(origin, config);
    const candidates = await admin.rpc('related_note_candidates', { target_id: noteId, caller_id: userId, terms });
    if (candidates.error) throw new Error('provider');
    const links = await relatedLinks(origin, (candidates.data ?? []) as RelatedInput[], config);
    // Reuse the paid result on a transient database error; never blindly repeat AI calls.
    for (let attempt = 0; attempt < 2; attempt++) {
      const saved = await admin.rpc('finish_related_notes', { target_id: noteId, caller_id: userId, claim_token: claim.token, expected_revision: claim.revision, links, model_name: config.model });
      if (!saved.error) return; // false: changed collection, deleted note, or revoked consent.
    }
    throw new Error('provider');
  } catch {
    await admin.from('related_note_runs').update({ status: 'failed' }).eq('note_id', noteId).eq('user_id', userId).eq('token', claim.token).eq('status', 'processing').then(() => {}, () => {});
    // No note content, source information, responses, credentials or headers in logs.
  }
}
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  try {
    const bearer = request.headers.get('Authorization') ?? '';
    if (!bearer.startsWith('Bearer ')) return reply({ error: 'Sign in to view related thoughts.' }, 401);
    const auth = await admin.auth.getUser(bearer.slice(7));
    if (auth.error || !auth.data.user) return reply({ error: 'Sign in again to view related thoughts.' }, 401);
    const reader = request.body?.getReader(); let length = 0, raw = '';
    if (reader) while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length; if (length > 1024) { await reader.cancel(); return reply({ error: 'Request too large.' }, 413); } raw += new TextDecoder().decode(chunk.value); }
    const input = JSON.parse(raw);
    if (typeof input.noteId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.noteId) || input.retry !== undefined && typeof input.retry !== 'boolean') return reply({ error: 'Invalid note request.' }, 400);
    const userId = auth.data.user.id;
    const owned = await admin.from('notes').select('id').eq('id', input.noteId).eq('user_id', userId).maybeSingle();
    if (owned.error || !owned.data) return reply({ error: 'Note not found.' }, 404);
    const result = await admin.rpc('claim_related_notes', { target_id: input.noteId, caller_id: userId, retry: input.retry === true });
    if (result.error) return reply({ error: result.error.message.includes('RATE_LIMIT') ? 'Related thoughts have reached their hourly limit. Try again later.' : 'Related thoughts are unavailable. Your note is saved.' }, 409);
    const claim = result.data as Claim;
    if (claim.status === 'claimed') EdgeRuntime.waitUntil(process(input.noteId, userId, claim));
    return reply({ status: claim.status === 'claimed' ? 'processing' : claim.status }, claim.status === 'claimed' ? 202 : 200);
  } catch { return reply({ error: 'Related thoughts are unavailable. Your note is saved.' }, 400); }
});
