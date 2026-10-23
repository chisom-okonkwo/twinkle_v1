import { recallAdmin, runRecallSchedule } from '../_shared/recall-worker.ts';
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };
const admin = recallAdmin();
Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Not found', { status: 404 });
  try {
    const secret = request.headers.get('x-recall-secret');
    if (!secret || secret.length > 256) return new Response('Unauthorized', { status: 401 });
    const valid = await admin.rpc('authorize_recall_scheduler', { secret });
    if (valid.error || valid.data !== true) return new Response('Unauthorized', { status: 401 });
    EdgeRuntime.waitUntil(runRecallSchedule(admin).catch(() => {}));
    return Response.json({ accepted: true }, { status: 202 });
  } catch {
    return new Response('Unavailable', { status: 503 });
  }
});
