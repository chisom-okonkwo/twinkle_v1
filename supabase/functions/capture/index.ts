import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { checkSignature, MEDIA_BUCKET, validateMedia, validateResult } from '../_shared/capture-contract.ts';
import { extractMedia } from '../_shared/openai.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const url = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) }) } });

async function discard(id: string, callerId?: string) {
  const { data, error } = await admin.rpc('claim_capture_deletion', { capture_id: id, caller_id: callerId ?? null });
  if (error) throw new Error('This capture is saved or processing. Please wait before discarding it.');
  if (!data?.id) return;
  const removed = await admin.storage.from(MEDIA_BUCKET).remove([data.storage_path]);
  if (removed.error) throw new Error('Could not remove the source yet. Please retry.');
  const deleted = await admin.from('note_captures').delete().eq('id', id).eq('status', 'deleting');
  if (deleted.error) throw new Error('Source cleanup is pending. Please retry.');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  let captureId: string | undefined;
  let claimed = false;
  let claimAttempt: number | undefined;
  try {
    // The gateway JWT check is disabled for modern signing keys; getUser below
    // validates every normal request. The only exception is the internal cron token.
    const maintenance = request.headers.get('x-capture-cleanup-token');
    if (maintenance) {
      const { data, error } = await admin.rpc('authorize_capture_cleanup', { token: maintenance });
      if (error || data !== true) return reply({ error: 'Unauthorized.' }, 401);
      const expired = await admin.from('note_captures').select('id').neq('status', 'saved')
        .or(`expires_at.lt.${new Date().toISOString()},user_id.is.null`).limit(100);
      if (expired.error) return reply({ error: 'Cleanup unavailable.' }, 503);
      let removed = 0;
      for (const row of expired.data) { try { await discard(row.id); removed++; } catch { /* Retry next hour. No private data in logs. */ } }
      return reply({ removed });
    }
    const authorization = request.headers.get('Authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) return reply({ error: 'Sign in to process a capture.' }, 401);
    const { data: { user }, error: authError } = await admin.auth.getUser(authorization.slice(7));
    if (authError || !user) return reply({ error: 'Your session expired. Please sign in again.' }, 401);
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > 1024) { await reader.cancel(); return reply({ error: 'Request too large.' }, 413); }
        chunks.push(next.value);
      }
    }
    const raw = chunks.map((chunk) => new TextDecoder().decode(chunk)).join('');
    if (raw.length > 1024) return reply({ error: 'Request too large.' }, 413);
    const input = JSON.parse(raw);
    if (!['process', 'discard', 'prepare'].includes(input.action) || typeof input.captureId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.captureId)) return reply({ error: 'Invalid capture request.' }, 400);
    captureId = input.captureId;
    const found = await admin.from('note_captures').select('*').eq('id', captureId).eq('user_id', user.id).maybeSingle();
    if (found.error || !found.data) return reply({ error: 'Capture not found.' }, 404);
    if (input.action === 'discard') { await discard(captureId!, user.id); return reply({ discarded: true }); }
    if (input.action === 'prepare') {
      const capture = found.data;
      if (capture.status === 'deleting' || capture.status === 'processing' || capture.status !== 'saved' && Date.parse(capture.expires_at) < Date.now()) return reply({ error: 'This source is processing or unavailable. Please retry shortly.' }, 409);
      if (capture.verified_at) return reply({ prepared: true });
      const file = await admin.storage.from(MEDIA_BUCKET).download(capture.storage_path);
      if (file.error || !file.data) throw new Error('The source could not be loaded. Retry the upload.');
      const bytes = new Uint8Array(await file.data.arrayBuffer());
      validateMedia(capture.kind, capture.mime_type, bytes.length);
      if (bytes.length !== capture.byte_size) throw new Error('The uploaded source is incomplete. Please choose it again.');
      checkSignature(bytes, capture.mime_type);
      const verified = await admin.from('note_captures').update({ verified_at: new Date().toISOString() }).eq('id', captureId).eq('user_id', user.id).in('status', ['pending', 'failed', 'ready', 'saved']).select('id').maybeSingle();
      if (verified.error || !verified.data) throw new Error('The source changed while preparing it. Please retry.');
      return reply({ prepared: true });
    }
    if (found.data.result && found.data.status === 'ready') return reply(validateResult(found.data.result));
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) return reply({ error: 'AI processing is not configured yet. Your source is safe; please retry after server setup.' }, 503);
    const claim = await admin.rpc('claim_note_capture', { capture_id: captureId, caller_id: user.id });
    if (claim.error) {
      const message = claim.error.message;
      return reply({ error: message.includes('RATE_LIMIT') ? 'You have reached the processing limit. Please try again next hour.' : message.includes('ATTEMPTS') ? 'This capture has reached its retry limit. Keep the source and try a new capture later.' : message.includes('BUSY') ? 'This capture is already processing. Wait two minutes before retrying.' : 'This capture has expired or is unavailable.' }, 409);
    }
    const capture = claim.data;
    if (capture.status === 'ready' && capture.result) return reply(validateResult(capture.result));
    if (capture.status !== 'processing') return reply({ error: 'This capture is already saved.' }, 409);
    claimed = true;
    claimAttempt = capture.attempts;
    const file = await admin.storage.from(MEDIA_BUCKET).download(capture.storage_path);
    if (file.error || !file.data) throw new Error('The source could not be loaded. Retry the upload before processing.');
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    validateMedia(capture.kind, capture.mime_type, bytes.length);
    if (bytes.length !== capture.byte_size) throw new Error('The uploaded source is incomplete. Please discard it and select the source again.');
    checkSignature(bytes, capture.mime_type);
    // Avoid multiple base64/JSON copies of a 20 MiB image in the Edge runtime.
    // Only the server can mint this short-lived URL after verifying ownership.
    let imageUrl: string | undefined;
    if (capture.kind === 'image') {
      const signed = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(capture.storage_path, 180);
      if (signed.error || !signed.data?.signedUrl) throw new Error('The private photo could not be prepared. Please retry.');
      imageUrl = signed.data.signedUrl;
    }
    const result = await extractMedia(capture.kind, bytes, capture.mime_type, { key,
      imageUrl,
      visionModel: Deno.env.get('OPENAI_VISION_MODEL') ?? 'gpt-6-luna', audioModel: Deno.env.get('OPENAI_TRANSCRIPTION_MODEL') ?? 'gpt-transcribe',
      photoInstructions: Deno.env.get('PHOTO_EXTRACTION_INSTRUCTIONS'), audioInstructions: Deno.env.get('AUDIO_TRANSCRIPTION_INSTRUCTIONS'),
    });
    const saved = await admin.from('note_captures').update({ status: 'ready', result, verified_at: new Date().toISOString() }).eq('id', captureId).eq('status', 'processing').eq('attempts', claimAttempt!).select('id').maybeSingle();
    if (saved.error || !saved.data) throw new Error('Processing finished but the result could not be retained. Please retry.');
    return reply(result);
  } catch (error) {
    if (claimed && captureId) await admin.from('note_captures').update({ status: 'failed' }).eq('id', captureId).eq('status', 'processing').eq('attempts', claimAttempt!);
    // Never return SDK/database/provider payloads or media in logs.
    const message = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      ? 'Processing timed out. Your source is safe; wait two minutes before retrying.'
      : error instanceof Error && !error.message.includes('JSON') ? error.message : 'Invalid capture request.';
    return reply({ error: message }, 400);
  }
});
