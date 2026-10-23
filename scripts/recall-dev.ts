// Operator-only CLI. Never imported by the application or deployed as an endpoint.
import {
  ensureFlashback,
  deliverFlashback,
  checkReceipts,
  recallAdmin,
} from '../supabase/functions/_shared/recall-worker.ts';
if (Deno.env.get('TWINKLE_DEV_RECALL') !== '1')
  throw new Error('Set TWINKLE_DEV_RECALL=1 in a private operator environment.');
const [userId, action = 'select'] = Deno.args;
if (
  !userId ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) ||
  !['seed', 'select', 'send', 'receipts'].includes(action)
)
  throw new Error('Usage: recall-dev.ts <test-user-uuid> [seed|select|send|receipts]');
const admin = recallAdmin();
const owner = await admin.auth.admin.getUserById(userId);
if (owner.error || !owner.data.user) throw new Error('Test account not found.');
if (action === 'seed') {
  if (Deno.env.get('TWINKLE_DEV_SEED') !== '1')
    throw new Error('Set TWINKLE_DEV_SEED=1 for an empty disposable test account only.');
  const content =
    'Development test note (synthetic).\nI am considering the Northstar internship or continuing the Atlas prototype. I want to compare mentorship with time for my portfolio before deciding.';
  const old = new Date(Date.now() - 35 * 86400000).toISOString();
  const note = await admin
    .from('notes')
    .insert({ user_id: userId, content, created_at: old, updated_at: old })
    .select('id')
    .single();
  if (note.error) throw new Error('Could not seed a synthetic note.');
  const context = await admin
    .from('note_contexts')
    .update({
      status: 'completed',
      model: 'synthetic-development-fixture',
      generated_context: {
        topics: [],
        details: [],
        situation: {
          quote: 'I am considering the Northstar internship or continuing the Atlas prototype.',
          certainty: 'explicit',
        },
        intentions: [
          {
            quote: 'I want to compare mentorship with time for my portfolio before deciding.',
            certainty: 'explicit',
          },
        ],
        concerns: [],
        open_questions: [],
        emotions: [],
      },
    })
    .eq('note_id', note.data.id)
    .eq('user_id', userId);
  if (context.error)
    throw new Error(
      'Synthetic note saved, but fixture context failed; remove that test note before retrying.',
    );
  console.log(`Synthetic eligible note: ${note.data.id}. Delete it after testing.`);
} else if (action === 'receipts') {
  await checkReceipts(admin);
  console.log('Due receipts checked.');
} else {
  const id = await ensureFlashback(admin, userId);
  console.log(
    id
      ? `Flashback: ${id}`
      : 'No eligible flashback. Age, relevance, exclusions and repeat limits still apply.',
  );
  if (action === 'send') {
    if (Deno.env.get('TWINKLE_DEV_SEND_PUSH') !== '1')
      throw new Error('Set TWINKLE_DEV_SEND_PUSH=1 to explicitly send a real test push.');
    console.log(
      (await deliverFlashback(admin, userId))
        ? 'Delivery attempted; inspect private.push_deliveries for ticket/receipt status.'
        : 'Skipped: check preferences, delivery window, device/session registration and history.',
    );
  }
}
