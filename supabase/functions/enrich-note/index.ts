import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { analyzeContext } from '../_shared/context-ai.ts';
import { selectContextPrompt } from '../_shared/context-contract.ts';
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(10000) }) } });

type Claim = { status: string; content: string; source_hash: string; revision: number; token: string };
async function process(noteId: string, userId: string, claim: Claim) {
  const parameters = { target_id: noteId, caller_id: userId, expected_revision: claim.revision, claim_token: claim.token };
  try {
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) throw new Error('configuration');
    const model = Deno.env.get('OPENAI_CONTEXT_MODEL') ?? 'gpt-6-luna';
    const { missing_context, ...context } = await analyzeContext(claim.content, { key, model });
    const question = selectContextPrompt(missing_context, claim.content);
    // The claim is valid only for this content revision, lease and current consent.
    // Retrying persistence never repeats the paid OpenAI call.
    for (let attempt = 0; attempt < 2; attempt++) {
      const saved = await admin.rpc('finish_note_context', { ...parameters, payload: context, question, model_name: model });
      if (!saved.error) return; // false means superseded, deleted or opted out.
    }
    throw new Error('provider');
  } catch (error) {
    const code = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout'
      : error instanceof Error && ['configuration', 'invalid_result'].includes(error.message) ? error.message : 'provider';
    await admin.rpc('fail_note_context', { ...parameters, code }).then(() => {}, () => {});
    // Do not log note text, model responses, answers, headers, or provider payloads.
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  try {
    const bearer = request.headers.get('Authorization') ?? '';
    if (!bearer.startsWith('Bearer ')) return reply({ error: 'Sign in to analyze a note.' }, 401);
    const authenticated = await admin.auth.getUser(bearer.slice(7));
    if (authenticated.error || !authenticated.data.user) return reply({ error: 'Sign in again to analyze a note.' }, 401);
    const reader = request.body?.getReader(); let length = 0; let raw = '';
    if (reader) while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.length; if (length > 1024) { await reader.cancel(); return reply({ error: 'Request too large.' }, 413); }
      raw += new TextDecoder().decode(chunk.value);
    }
    const input = JSON.parse(raw);
    if (typeof input.noteId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.noteId) || (input.manual !== undefined && typeof input.manual !== 'boolean') || (input.retry !== undefined && typeof input.retry !== 'boolean')) return reply({ error: 'Invalid note request.' }, 400);
    const userId = authenticated.data.user.id;
    // Check owner before returning even consent/status information.
    const owned = await admin.from('notes').select('id').eq('id', input.noteId).eq('user_id', userId).maybeSingle();
    if (owned.error || !owned.data) return reply({ error: 'Note not found.' }, 404);
    const result = await admin.rpc('claim_note_context', { target_id: input.noteId, caller_id: userId, manual: input.manual === true, retry: input.retry === true });
    if (result.error) {
      const message = result.error.message;
      return reply({ error: message.includes('DISABLED') ? 'Enable AI context on Notes Home first.' : message.includes('RATE_LIMIT') ? 'Context processing limit reached. Try next hour.' : message.includes('ATTEMPTS') ? 'This version has reached its retry limit. Your note is saved.' : 'Context is unavailable. Please retry.' }, 409);
    }
    const claim = result.data as Claim;
    if (claim.status === 'claimed') EdgeRuntime.waitUntil(process(input.noteId, userId, claim));
    return reply({ status: claim.status === 'claimed' ? 'processing' : claim.status }, claim.status === 'claimed' ? 202 : 200);
  } catch { return reply({ error: 'Context could not be started. Your note is saved; please retry.' }, 400); }
});
