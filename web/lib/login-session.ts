/**
 * Mid-flow recovery for the OTP login.
 *
 * The previous implementation held `stage` and `email` in component state
 * only, so a reload or a back-navigation between "Send code" and "Verify"
 * dropped the user back to an empty email field while a perfectly valid code
 * sat in their inbox. They had to request a second code — which, because
 * `requestOtp` deletes every prior code for the address, silently invalidated
 * the one they had just been emailed.
 *
 * So we persist the minimum needed to resume: the address, and when the code
 * was issued. Never the code itself.
 *
 * `sessionStorage`, not `localStorage`, deliberately — a pending sign-in
 * should not outlive the tab. And the record is only honoured while it could
 * still be true: the server sets `expiresAt` to issue + 10 minutes
 * (auth.service.ts), so a record older than that is discarded on read rather
 * than resuming the user into a code entry that is already dead.
 */
const KEY = "sorted.login.pending";

/** api/src/modules/auth/auth.service.ts — `Date.now() + 10 * 60 * 1000`. */
export const OTP_TTL_MS = 10 * 60 * 1000;

/**
 * How long to wait before offering a resend. Resending is destructive — it
 * deletes the code already sitting in the inbox — so it is not offered while
 * the email is plausibly still in flight.
 */
export const RESEND_COOLDOWN_MS = 60 * 1000;

export interface PendingLogin {
  email: string;
  /** ms epoch when /otp/request returned 200. */
  issuedAt: number;
}

function available(): boolean {
  try {
    return typeof window !== "undefined" && !!window.sessionStorage;
  } catch {
    // Safari in private mode, or storage blocked by policy. The flow still
    // works end to end; it just cannot resume after a reload.
    return false;
  }
}

export function readPending(): PendingLogin | null {
  if (!available()) return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PendingLogin>;
    if (typeof parsed?.email !== "string" || typeof parsed?.issuedAt !== "number") {
      window.sessionStorage.removeItem(KEY);
      return null;
    }

    // Expired, or a clock that has moved backwards. Either way the code it
    // refers to cannot be verified any more — do not resume into a dead stage.
    const age = Date.now() - parsed.issuedAt;
    if (age < 0 || age >= OTP_TTL_MS) {
      window.sessionStorage.removeItem(KEY);
      return null;
    }

    return { email: parsed.email, issuedAt: parsed.issuedAt };
  } catch {
    return null;
  }
}

export function writePending(email: string): PendingLogin {
  const record: PendingLogin = { email, issuedAt: Date.now() };
  if (available()) {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(record));
    } catch {
      /* quota or private mode — recovery is a nicety, not a requirement */
    }
  }
  return record;
}

export function clearPending(): void {
  if (!available()) return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** ms until the current code expires. 0 once it has. */
export function msRemaining(issuedAt: number, now: number = Date.now()): number {
  return Math.max(0, issuedAt + OTP_TTL_MS - now);
}

/** ms until a resend is offered. 0 once it is. */
export function msUntilResend(issuedAt: number, now: number = Date.now()): number {
  return Math.max(0, issuedAt + RESEND_COOLDOWN_MS - now);
}

/** `m:ss`, for the resend clock. */
export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
