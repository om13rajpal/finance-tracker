"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { apiFetch } from "@/lib/api-client";
import { toAuthError, validateCode, validateEmail, type AuthError } from "@/lib/auth-errors";
import {
  clearPending,
  formatClock,
  msRemaining,
  msUntilResend,
  readPending,
  writePending,
  type PendingLogin,
} from "@/lib/login-session";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import { Label } from "@/components/shadcn/label";
import { HeroConstellation } from "@/components/login/hero-constellation";
import { Notice } from "@/components/login/notice";
import { OtpInput } from "@/components/login/otp-input";

type Stage = "email" | "code";

/**
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * The resume check reads sessionStorage, so it can only run on the client,
 * but it must run BEFORE paint. With a plain `useEffect` a returning user sees
 * the email field for one frame and then watches it swap to the code entry.
 * React warns about `useLayoutEffect` during SSR, hence the swap.
 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * No request should hang forever. `fetch` has no default timeout, so without
 * this a stalled connection leaves the form disabled and spinning with no way
 * out. Generous, because /otp/request waits on an outbound email send.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * The server compares the address with `===` against ALLOWED_LOGIN_EMAIL
 * (auth.service.ts), so " Me@Example.com " never matches. Normalise once, here,
 * and use the SAME normalised value for both stages: the previous version
 * trimmed on request but sent the raw state on verify, so a stray space made
 * step one succeed and step two fail with a misleading "invalid code".
 */
function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export default function LoginPage() {
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<AuthError | null>(null);
  const [pending, setPending] = useState<PendingLogin | null>(null);
  const [now, setNow] = useState(() => Date.now());

  /**
   * The double-submit guard, kept in a ref as well as in state.
   *
   * State alone is not enough: two clicks inside the same React batch both read
   * the old `busy === false` and both fire. That matters more here than in most
   * forms, because `requestOtp` deletes every prior code for the address, so a
   * duplicate request silently invalidates the code already sitting in the
   * user's inbox, and the app looks like it emailed them a broken code.
   */
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  /**
   * Resume a code entry that is still alive. See lib/login-session.ts.
   *
   * The email stage is what renders on the server: it is the correct default
   * and the overwhelmingly common case, so the page ships real content rather
   * than a skeleton. This runs before paint, so a resumed session lands
   * straight on the code entry with no flash of the email field.
   */
  useIsomorphicLayoutEffect(() => {
    const resumed = readPending();
    if (!resumed) return;
    setPending(resumed);
    setEmail(resumed.email);
    setStage("code");
    setNow(Date.now());
  }, []);

  /**
   * Already signed in? Leave.
   *
   * The session is an httpOnly cookie, so it cannot be read from JS: the only
   * way to know is to ask. `/auth/me` answers 401 when unauthenticated, which
   * is the overwhelmingly common case here, so the form renders immediately
   * and this only ever redirects the rare visitor who still has a live session.
   * Blocking the whole page on this round trip would make every real sign-in
   * wait for an answer it already knows.
   */
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ email: string }>("/auth/me", { timeoutMs: REQUEST_TIMEOUT_MS })
      .then(() => {
        if (!cancelled) {
          clearPending();
          router.replace("/dashboard");
        }
      })
      // 401 is the expected answer. Anything else (API down) is not a reason to
      // block someone from signing in, so it is deliberately swallowed.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [router]);

  /**
   * Move focus to the error when one appears.
   *
   * `role="alert"` announces it, but a keyboard or screen-reader user still has
   * to hunt for it, especially a terminal error, where the fix is not "retry"
   * but "read this". The notice is programmatically focusable for exactly this.
   */
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error?.terminal) noticeRef.current?.focus();
  }, [error]);

  /** Tick only while a countdown is actually on screen. */
  useEffect(() => {
    if (stage !== "code" || !pending) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [stage, pending]);

  const remaining = pending ? msRemaining(pending.issuedAt, now) : 0;
  const untilResend = pending ? msUntilResend(pending.issuedAt, now) : 0;
  const expired = Boolean(pending) && remaining === 0;
  const canResend = Boolean(pending) && untilResend === 0;

  const run = useCallback(async (fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } finally {
      inFlight.current = false;
    }
  }, []);

  const requestCode = useCallback(
    (raw: string, { resend = false }: { resend?: boolean } = {}) =>
      run(async () => {
        const address = normaliseEmail(raw);
        try {
          await apiFetch("/auth/otp/request", {
            method: "POST",
            body: JSON.stringify({ email: address }),
            timeoutMs: REQUEST_TIMEOUT_MS,
          });
          // Store the normalised address so stage two verifies against exactly
          // what stage one sent.
          setEmail(address);
          const record = writePending(address);
          setPending(record);
          setNow(Date.now());
          if (!resend) setStage("code");
          setCode("");
          setBusy(false);
        } catch (e) {
          setError(toAuthError(e, "email"));
          setBusy(false);
        }
      }),
    [run],
  );

  const verifyCode = useCallback(
    (value: string) =>
      run(async () => {
        try {
          await apiFetch("/auth/otp/verify", {
            method: "POST",
            body: JSON.stringify({ email: normaliseEmail(email), code: value }),
            timeoutMs: REQUEST_TIMEOUT_MS,
          });
          clearPending();
          router.replace("/dashboard");
          // Deliberately NOT clearing `busy` on success: this navigates away,
          // and re-enabling the button first flashes it live mid-redirect.
          // `replace`, not `push`, so Back does not land on a login screen the
          // user has already completed.
        } catch (e) {
          setError(toAuthError(e, "code"));
          setBusy(false);
        }
      }),
    [email, router, run],
  );

  function backToEmail() {
    clearPending();
    setPending(null);
    setStage("email");
    setCode("");
    setError(null);
  }

  const heroStage = useMemo<Stage>(() => stage, [stage]);

  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="mx-auto grid min-h-screen max-w-[1180px] items-center gap-64 px-22 py-44 lg:grid-cols-[1fr_minmax(0,420px)] lg:px-44">
        {/* ── hero ─────────────────────────────────────────────────────── */}
        <section className="order-1 flex flex-col items-center justify-center lg:order-none lg:items-start">
          <HeroConstellation stage={heroStage} />
          <p className="mt-32 max-w-[36ch] text-center font-sans text-body text-dim-2 lg:text-left">
            Every rupee sorted into one of four buckets. Fixed costs, investments,
            savings, and what&rsquo;s left to spend without thinking about it.
          </p>
        </section>

        {/* ── form ─────────────────────────────────────────────────────── */}
        <section className="order-0 w-full lg:order-none">
          <span className="font-num text-label uppercase text-dim">
            {stage === "email" ? "Sign in" : "Check your email"}
          </span>

          <h1 className="mt-12 font-disp text-h1 tracking-disp text-ink">
            {stage === "email" ? "Sorted." : "Six digits."}
          </h1>

          <p className="mt-12 max-w-[42ch] font-sans text-body text-dim-2">
            {stage === "email" ? (
              <>No password. We&rsquo;ll email you a code that works for ten minutes.</>
            ) : (
              <>
                Sent to <span className="font-medium text-ink">{email}</span>. It expires in
                ten minutes.
              </>
            )}
          </p>

          <div className="mt-32 flex flex-col gap-18">
            {error && <Notice ref={noticeRef} error={error} />}

            {stage === "email" ? (
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  const invalid = validateEmail(email);
                  if (invalid) {
                    setError(invalid);
                    return;
                  }
                  requestCode(email);
                }}
                className="flex flex-col gap-14"
              >
                <div className="flex flex-col gap-8">
                  <Label htmlFor="login-email" variant="field">
                    Email
                  </Label>
                  <Input
                    id="login-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    invalid={error?.kind === "invalid-email" || error?.kind === "not-allowed"}
                    disabled={busy}
                    autoFocus
                  />
                </div>

                <Button type="submit" size="block" busy={busy}>
                  {busy ? "Sending…" : "Send code"}
                </Button>
              </form>
            ) : (
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  const invalid = validateCode(code);
                  if (invalid) {
                    setError(invalid);
                    return;
                  }
                  verifyCode(code);
                }}
                className="flex flex-col gap-14"
              >
                <div className="flex flex-col gap-8">
                  <Label htmlFor="login-code" variant="field">
                    Code
                  </Label>
                  <OtpInput
                    value={code}
                    onChange={setCode}
                    onComplete={(v) => verifyCode(v)}
                    disabled={busy}
                    invalid={error?.kind === "bad-code"}
                    describedBy="code-help"
                  />
                </div>

                <Button
                  type="submit"
                  size="block"
                  /* On expiry the primary action is no longer "Verify": the code
                     in hand cannot work. Verify steps down to ghost and the
                     resend takes over as primary. */
                  variant={expired ? "ghost" : "primary"}
                  busy={busy}
                >
                  {busy ? "Verifying…" : "Verify"}
                </Button>

                {/* ── the resend affordance ──────────────────────────────
                    Before the cooldown elapses this is NOT a button. It is a
                    mono clock with no border, no fill and no stamp: you cannot
                    double-submit an affordance that was never drawn. Resending
                    is destructive: it deletes the code already in the inbox. */}
                <div id="code-help" className="flex flex-col gap-8">
                  {expired ? (
                    <Button
                      type="button"
                      size="block"
                      variant="primary"
                      busy={busy}
                      onClick={() => requestCode(email, { resend: true })}
                    >
                      {busy ? "Sending…" : "Send a new code"}
                    </Button>
                  ) : canResend ? (
                    <Button
                      type="button"
                      size="block"
                      variant="ghost"
                      busy={busy}
                      onClick={() => requestCode(email, { resend: true })}
                    >
                      {busy ? "Sending…" : "Send a new code"}
                    </Button>
                  ) : (
                    <p className="m-0 font-num text-meta uppercase text-dim">
                      New code in {formatClock(untilResend)}
                    </p>
                  )}

                  <p className="m-0 font-sans text-caption text-dim-2">
                    {expired ? (
                      <>That code has expired. Send a new one to carry on.</>
                    ) : canResend ? (
                      <>Sending a new code will replace the one already emailed to you.</>
                    ) : (
                      <>Expires in {formatClock(remaining)}.</>
                    )}
                  </p>

                  <button
                    type="button"
                    onClick={backToEmail}
                    disabled={busy}
                    className="self-start rounded-xs font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-ink disabled:cursor-default disabled:opacity-[.55]"
                  >
                    Use a different email
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
