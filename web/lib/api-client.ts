// Always same-origin, proxied through next.config.mjs's rewrite to the real
// API. The browser must never call the API's own origin directly — the
// session cookie is sameSite=lax, so a cross-site fetch silently drops it,
// and every request after login comes back 401.
export const API_BASE = "/api";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * The request never resolved within `timeoutMs`.
 *
 * Distinct from a network failure: the connection was made, the server just
 * never answered. `fetch` has no built-in timeout, so without this a hung
 * request leaves a form disabled and spinning forever with no way out.
 */
export class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

export interface ApiFetchOptions extends RequestInit {
  /**
   * Abort and throw `TimeoutError` after this many ms. Opt-in — omitting it
   * preserves the original behaviour exactly, so existing callers are
   * unaffected.
   */
  timeoutMs?: number;
}

export async function apiFetch<T>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  const { timeoutMs, signal, ...init } = opts;

  const controller = timeoutMs != null ? new AbortController() : null;
  const timer =
    controller != null
      ? setTimeout(() => controller.abort(new TimeoutError(timeoutMs!)), timeoutMs)
      : null;

  // Respect a caller-supplied signal as well as our own timeout.
  if (controller && signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller ? controller.signal : signal,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...opts.headers },
    });
  } catch (err) {
    // An abort surfaces as a DOMException; re-throw our reason so callers can
    // tell "timed out" apart from "offline".
    if (controller?.signal.aborted && controller.signal.reason instanceof TimeoutError) {
      throw controller.signal.reason;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `Request failed: ${res.status}`, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
