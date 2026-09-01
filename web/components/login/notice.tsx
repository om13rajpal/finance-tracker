"use client";

import * as React from "react";

import type { AuthError } from "@/lib/auth-errors";

/**
 * Sorted · error notice
 *
 * Replaces the previous raw red `<p>`. Two rules:
 *
 *  · An error is an ink-bordered panel, not coloured text. Colour alone never
 *    carries meaning, and a wall of red on a cream page reads as a crash.
 *    `--alert` is used for the rule and the label only.
 *
 *  · Every notice NAMES THE FIX. The title says what happened; the second line
 *    says what to do. If a message cannot offer a fix it is not ready to ship.
 *
 * `role="alert"` so screen readers announce it the moment it appears, and
 * `aria-live="assertive"` because the user is blocked until they act on it.
 */
export const Notice = React.forwardRef<HTMLDivElement, { error: AuthError }>(
  function Notice({ error }, ref) {
  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-testid="login-error"
      role="alert"
      aria-live="assertive"
      className="border-panel border-ink rounded-notice px-22 py-18 bg-ink-wash focus-visible:outline-focus focus-visible:outline-[2.5px] focus-visible:outline-offset-[3px]"
    >
      <div className="flex items-center gap-8 mb-6">
        <span aria-hidden className="inline-block w-12 h-12 rounded-pill bg-alert" />
        <span className="font-num text-label uppercase text-alert">
          {error.terminal ? "Blocked" : "Didn't work"}
        </span>
      </div>
      <p className="font-sans text-body-s font-semibold text-ink m-0">{error.title}</p>
      {/* Sentence-length, so --dim-2 (5.71:1), never --dim (4.37:1). */}
      <p className="font-sans text-caption text-dim-2 mt-4 mb-0">{error.fix}</p>
    </div>
  );
});
