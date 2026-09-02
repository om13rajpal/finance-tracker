import { ApiError, TimeoutError } from "./api-client";

/**
 * Every failure the login flow can actually produce, mapped to copy that names
 * the fix. Derived from the real API, not invented:
 *
 *   api/src/modules/auth/auth.routes.ts    : zod schemas, the rate limiter
 *   api/src/modules/auth/auth.service.ts   : requestOtp / verifyOtp throws
 *   api/src/lib/errorHandler.ts            : the { error: string } envelope
 *   web/lib/api-client.ts                  : how that envelope becomes ApiError
 *
 * Two sharp edges worth knowing about:
 *
 * 1. THE 429 HAS NO JSON BODY. `express-rate-limit` answers with its default
 *    `text/plain` payload, so `res.json()` in apiFetch throws, the body falls
 *    back to `{}`, and the message degrades to the useless string
 *    "Request failed: 429". We therefore branch on `status`, never on message.
 *
 * 2. THE LIMITER IS SHARED BY BOTH ROUTES. `otpRequestLimiter` is mounted on
 *    /otp/request AND /otp/verify, so failed code attempts burn the same
 *    budget as resends: 30 requests per 15 minutes, combined.
 */
export type AuthErrorKind =
  | "not-allowed"
  | "invalid-email"
  | "bad-code"
  | "rate-limited"
  | "timeout"
  | "send-failed"
  | "offline"
  | "server";

export interface AuthError {
  kind: AuthErrorKind;
  /** One line, states what happened. */
  title: string;
  /** One line, states what to do about it. Never blames the user. */
  fix: string;
  /** True when retrying the exact same action cannot possibly help. */
  terminal: boolean;
}

const RATE_LIMIT = { max: 30, windowMinutes: 15 } as const;

export function toAuthError(err: unknown, stage: "email" | "code"): AuthError {
  // The server accepted the connection but never answered. Distinct from being
  // offline, and the advice differs: a request that timed out may well have
  // been processed, so "nothing was sent" would be a lie.
  if (err instanceof TimeoutError) {
    return {
      kind: "timeout",
      title: "The server took too long to answer.",
      fix: stage === "email"
        ? "The code may still arrive. Check your inbox before asking for another one."
        : "Check your connection and try the code again.",
      terminal: false,
    };
  }

  // fetch() rejects with a TypeError when the network is unreachable. This is
  // not an ApiError and has no status: it must be caught before anything else
  // or it surfaces to the user as the raw string "Failed to fetch".
  if (!(err instanceof ApiError)) {
    return {
      kind: "offline",
      title: "Couldn't reach the server.",
      fix: "Check your connection and try again. Nothing was sent.",
      terminal: false,
    };
  }

  switch (err.status) {
    case 429:
      return {
        kind: "rate-limited",
        title: "Too many attempts.",
        fix: `The limit is ${RATE_LIMIT.max} requests per ${RATE_LIMIT.windowMinutes} minutes, and code checks count toward it too. Wait a few minutes, then try again.`,
        terminal: true,
      };

    case 403:
      return {
        kind: "not-allowed",
        title: "That address can't sign in here.",
        fix: "This tracker accepts exactly one address. Check for a typo, or use the address it was set up with.",
        terminal: true,
      };

    case 401:
      return {
        kind: "bad-code",
        title: "That code didn't work.",
        fix: "It may have expired, or a newer code may have replaced it. Check the most recent email, or send a new code.",
        terminal: false,
      };

    case 400:
      return stage === "email"
        ? {
            kind: "invalid-email",
            title: "That doesn't look like an email address.",
            fix: "Check the spelling and try again.",
            terminal: false,
          }
        : {
            kind: "bad-code",
            title: "The code needs to be six digits.",
            fix: "Enter all six digits from the email.",
            terminal: false,
          };

    default:
      // 5xx. On /otp/request this is very often the mail provider refusing the
      // send: the API surfaces Resend's own message, so show it verbatim
      // rather than flattening it to a generic failure.
      if (stage === "email") {
        return {
          kind: "send-failed",
          title: "The code couldn't be emailed.",
          fix: err.message && !/^Request failed/.test(err.message)
            ? `The mail service said: ${err.message}`
            : "Something went wrong on the server. Try again in a moment.",
          terminal: false,
        };
      }
      return {
        kind: "server",
        title: "Something went wrong on the server.",
        fix: "Try again in a moment. Your code is still valid.",
        terminal: false,
      };
  }
}

/**
 * Client-side validation, so an obviously-empty or malformed field never costs
 * a network round trip, and, just as importantly, never burns one of the 30
 * requests in the shared rate-limit window.
 *
 * Returns null when the value is worth sending.
 */
export function validateEmail(raw: string): AuthError | null {
  const value = raw.trim();
  if (!value) {
    return {
      kind: "invalid-email",
      title: "Enter your email address first.",
      fix: "It's the address this tracker was set up with.",
      terminal: false,
    };
  }
  // Deliberately loose. The server runs zod's .email() and is the real
  // authority; this only catches the obviously-not-an-address case.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return {
      kind: "invalid-email",
      title: "That doesn't look like an email address.",
      fix: "Check the spelling and try again.",
      terminal: false,
    };
  }
  return null;
}

export function validateCode(code: string): AuthError | null {
  if (code.length === 6) return null;
  return {
    kind: "bad-code",
    title: code.length === 0 ? "Enter the six-digit code." : "That code is too short.",
    fix: "It's the six digits in the email we just sent.",
    terminal: false,
  };
}

