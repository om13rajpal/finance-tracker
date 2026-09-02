export interface RetryOptions {
  /** Total number of attempts (including the first try). Default 3. */
  attempts?: number;
  /** Base delay in milliseconds before the second attempt; doubles each subsequent attempt. Default 500. */
  baseDelayMs?: number;
}

/**
 * Runs `fn`, retrying on rejection with exponential backoff.
 *
 * - Retries up to `attempts` times total (default 3), including the first try.
 * - Waits `baseDelayMs * 2^(attempt-1)` between attempts (default base 500ms: 500ms,
 *   1000ms, 2000ms, ...): a real wait via setTimeout, not a fire-all-instantly loop.
 * - Does NOT wait after the final attempt: it rejects/throws immediately once attempts
 *   are exhausted.
 * - On total exhaustion, throws the LAST attempt's actual error (not a generic
 *   "retries exhausted" message), so callers/logs retain the real failure cause.
 *
 * This is the project's shared wrapper for every external call (Global Constraints),
 * used by the market-data HTTP clients here, and by every future external-API task.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
