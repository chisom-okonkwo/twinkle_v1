import { ensureFlashback, recallAdmin } from '../_shared/recall-worker.ts';
const admin = recallAdmin();
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  try {
    const bearer = request.headers.get('Authorization') ?? '';
    if (!bearer.startsWith('Bearer ')) return reply({ error: 'Sign in to view flashbacks.' }, 401);
    const auth = await admin.auth.getUser(bearer.slice(7));
    if (auth.error || !auth.data.user) return reply({ error: 'Sign in again.' }, 401);
    // No client-supplied owner, note, date override, or scheduler action is accepted.
    const id = await ensureFlashback(admin, auth.data.user.id);
    return reply({ id });
  } catch {
    return reply({ error: 'Flashbacks are unavailable. Your notes are safe; try again later.' }, 503);
  }
});
