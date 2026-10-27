// Reuse a completed paid result when persistence briefly fails.
export async function retrySemanticWrite<T>(
  operation: () => Promise<T>,
): Promise<T> {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      return await operation();
    } catch (cause) {
      last = cause;
    }
  }
  throw last;
}
