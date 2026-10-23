import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import {
  chooseFlashbackWording,
  flashbackMessage,
  pushPayload,
  rankRecallNotes,
  sendRecallPush,
  type RecallCandidate,
} from './recall-contract.ts';
export const recallAdmin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(5000) }),
    },
  });
export type Admin = ReturnType<typeof recallAdmin>;
export async function recallService(
  admin: Admin,
  action: string,
  owner_id: string | null = null,
  payload: unknown = {},
) {
  const result = await admin.rpc('recall_service', { action, owner_id, payload });
  if (result.error) throw new Error('recall_unavailable');
  return result.data;
}
export async function ensureFlashback(admin: Admin, userId: string) {
  const scan = await recallService(admin, 'scan', userId);
  if (scan.active) return scan.active as string;
  const selected = rankRecallNotes((scan.candidates ?? []) as RecallCandidate[])[0];
  if (!selected) return null;
  const quote = selected.excerpts[0];
  const saved = await recallService(admin, 'reserve', userId, {
    note_id: selected.note.id,
    source_hash: selected.note.context.source_hash,
    context_revision: selected.note.context.revision,
    user_version: selected.note.context.user_version,
    quote,
    message: flashbackMessage(quote),
    reason: selected.reason,
  });
  if (!saved) return null;
  // Factual fallback is already persisted, so a crash/refusal never loses the flashback.
  const consent = await admin
    .from('context_preferences')
    .select('enabled')
    .eq('user_id', userId)
    .maybeSingle();
  const key = Deno.env.get('OPENAI_API_KEY');
  if (key && consent.data?.enabled) {
    try {
      const wording = await chooseFlashbackWording(
        selected,
        key,
        Deno.env.get('OPENAI_CONTEXT_MODEL') ?? 'gpt-6-luna',
      );
      await recallService(admin, 'wording', userId, { id: saved.id, ...wording });
    } catch {
      /* Keep the persisted fallback; no paid retry. */
    }
  }
  return saved.id as string;
}
export async function deliverFlashback(admin: Admin, userId: string) {
  const prepared = await recallService(admin, 'prepare_send', userId);
  if (!prepared) return false;
  const outcome = await sendRecallPush(
    pushPayload(prepared.device.expo_token, prepared.flashback, prepared.preferences.detailed_previews),
    Deno.env.get('EXPO_ACCESS_TOKEN'),
  );
  await recallService(admin, 'sent', null, { id: prepared.delivery.id, ...outcome });
  return true;
}
export async function checkReceipts(admin: Admin) {
  const rows = (await recallService(admin, 'receipts')) as {
    id: string;
    ticket_id: string;
    receipt_attempts: number;
    updated_at: string;
  }[];
  if (!rows.length) return;
  try {
    const access = Deno.env.get('EXPO_ACCESS_TOKEN');
    const response = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/json',
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
      },
      body: JSON.stringify({ ids: rows.map((row) => row.ticket_id) }),
    });
    if (!response.ok) return;
    const data = (await response.json()).data ?? {};
    const started = Date.now();
    for (const row of rows) {
      if (Date.now() - started > 20000) break;
      const receipt = data[row.ticket_id];
      if (!receipt) {
        if (row.receipt_attempts >= 48 || Date.parse(row.updated_at) < Date.now() - 86400000)
          await recallService(admin, 'receipt', null, {
            id: row.id,
            status: 'unknown',
            error: 'receipt_missing',
          });
        continue;
      }
      await recallService(admin, 'receipt', null, {
        id: row.id,
        status: receipt.status === 'ok' ? 'delivered' : 'failed',
        error:
          receipt.details?.error === 'DeviceNotRegistered'
            ? 'DeviceNotRegistered'
            : receipt.status === 'ok'
              ? null
              : 'receipt_rejected',
      });
    }
  } catch {
    /* Receipt lookup is safe to retry on the next scheduled pass. */
  }
}
export async function runRecallSchedule(admin: Admin, onlyUser?: string) {
  const started = Date.now();
  await checkReceipts(admin);
  const users = onlyUser ? [onlyUser] : ((await recallService(admin, 'users')) as string[]);
  let processed = 0;
  for (const userId of users) {
    // Leave room for the final bounded network operations within the Edge runtime limit.
    if (Date.now() - started > 60000) break;
    try {
      await ensureFlashback(admin, userId);
      await deliverFlashback(admin, userId);
      processed++;
    } catch {
      /* No private content or tokens in logs. Next pass recovers. */
    }
  }
  return { processed };
}
