// Keep deadlines around response bodies as well as the initial HTTP response.
export async function withDeadline<T>(action: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  let rejectAbort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    rejectAbort = () => {
      const error = new Error(timedOut ? 'The request timed out. Check your connection and retry.' : 'The request was stopped. You can retry with the same source.');
      error.name = timedOut ? 'TimeoutError' : 'AbortError'; reject(error);
    };
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, milliseconds);
  try {
    // Also reject if a platform's request implementation fails to honor abort.
    return await Promise.race([stopped, controller.signal.aborted ? stopped : action(controller.signal)]);
  } finally {
    clearTimeout(timer); parent?.removeEventListener('abort', abort);
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
  }
}

export function uploadedSize(info: { size?: number; metadata?: { size?: number } | null } | null) {
  // Storage info() v2 puts size at the top level. Older responses used metadata.
  return Number(info?.size ?? info?.metadata?.size ?? -1);
}

export async function ensureUploaded(size: number, operations: {
  info: () => Promise<{ size?: number; metadata?: { size?: number } | null } | null>;
  upload: () => Promise<void>;
}, signal?: AbortSignal) {
  // Check first: a previous attempt may have uploaded successfully but lost its response.
  const matches = async () => uploadedSize(await operations.info().catch(() => null)) === size;
  if (await matches()) return;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new Error('Upload stopped. The source is kept here for retry.');
    try { await operations.upload(); return; }
    catch (error) { lastError = error; }
    if (signal?.aborted) throw new Error('Upload stopped. The source is kept here for retry.');
    if (await matches()) return;
    // Permission, size and unsupported-format errors will not improve on retry.
    if (lastError instanceof Error && /sign in|too large|format|permission|not permitted/i.test(lastError.message)) throw lastError;
  }
  throw new Error('The upload could not finish. Check your connection and retry; the source is kept here.');
}

export async function processWithRecovery<T>(operations: { readReady: () => Promise<T | null>; process: () => Promise<T> }, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new Error('Processing stopped. The source is kept for retry.');
  const cached = await operations.readReady();
  if (cached) return cached;
  try { return await operations.process(); }
  catch (error) {
    if (!signal?.aborted) { const recovered = await operations.readReady().catch(() => null); if (recovered) return recovered; }
    throw error;
  }
}
