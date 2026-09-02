"use client";

import * as React from "react";

import { formatInr } from "@/lib/format";

/**
 * Sorted · the Net Worth count-up
 *
 * MOTION RULE 12 IS: no rupee figure animates. No count-up, no odometer roll.
 * The number is known, or it is a skeleton. A counting figure shows its owner a
 * sequence of numbers that are all WRONG, and this is a product people open to
 * decide whether they can afford something.
 *
 * THIS IS THE SOLE CARVE-OUT, and it is narrow on purpose:
 *
 *   · Net Worth ONLY. Guilt-Free Money never animates: that is the number you
 *     act on. Net Worth is the number you admire.
 *   · 600ms hard cap.
 *   · ONCE PER SESSION. Returning to the dashboard from another route does not
 *     replay it; a figure that re-introduces itself on every visit is a tic.
 *   · Disabled entirely under `prefers-reduced-motion`.
 *   · The final value is in the DOM from first render, so with JS off, on a
 *     slow paint, or under reduced motion the correct number is simply there.
 *
 * WHY rAF AND NOT GSAP. GSAP is already a dependency, but only on the login
 * route: importing it here would put ~70KB of animation engine into the
 * bundle of the most-opened screen in the product to move one number once. The
 * curve below is the system's own `--ease-out`, cubic-bezier(.23, 1, .32, 1),
 * sampled directly.
 */

/**
 * Newton–Raphson solve for x given a progress t on a cubic-bezier with fixed
 * endpoints (0,0) and (1,1). Four iterations is well inside a pixel at these
 * durations, and it avoids shipping a sampling table.
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const curveX = (t: number) =>
    3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const curveY = (t: number) =>
    3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  const slopeX = (t: number) =>
    3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);

  return (x: number) => {
    let t = x;
    for (let i = 0; i < 4; i += 1) {
      const slope = slopeX(t);
      if (slope === 0) break;
      t -= (curveX(t) - x) / slope;
    }
    return curveY(Math.min(1, Math.max(0, t)));
  };
}

const easeOut = cubicBezier(0.23, 1, 0.32, 1);

const DURATION_MS = 600;
const SESSION_KEY = "sorted:networth-counted";

/**
 * A LAYOUT effect, so the reset to zero happens BEFORE paint.
 *
 * With a plain `useEffect` the true figure painted for one frame, jumped to
 * ₹0, and only then counted up: a visible flash of the right answer followed
 * by the wrong one, which is the exact opposite of what the carve-out is for.
 * `useLayoutEffect` warns during server rendering, hence the swap; this
 * component only ever mounts on the client, after a query has resolved.
 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export function CountUpInr({
  value,
  className,
  id,
}: {
  value: number;
  className?: string;
  id?: string;
}) {
  // The true value renders first and always. The animation only ever replaces
  // it after mount, so no render path can show an incomplete number.
  const [display, setDisplay] = React.useState(value);
  const target = React.useRef(value);
  target.current = value;
  /**
   * True only while the one 600ms run is in flight.
   *
   * The value-sync effect below must not fire during it. Without this guard the
   * two effects fight on mount: the count-up sets 0, the sync effect sees
   * 0 !== value and snaps straight back to the final figure, so the animation
   * silently never plays and the source looks correct.
   */
  const counting = React.useRef(false);

  useIsomorphicLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let alreadyPlayed = false;
    try {
      alreadyPlayed = window.sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      // Private mode / storage disabled. Falling through means the figure
      // animates once per page load instead of once per session, which is a
      // strictly better failure than throwing on a dashboard render.
    }
    if (alreadyPlayed) return;

    const to = target.current;
    // Nothing to count to.
    if (!Number.isFinite(to) || to === 0) return;

    let frame = 0;
    const start = performance.now();
    counting.current = true;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      if (t < 1) {
        setDisplay(Math.round(to * easeOut(t)));
        frame = requestAnimationFrame(tick);
      } else {
        counting.current = false;
        // Land on the exact figure, never on a rounded sample of it.
        setDisplay(target.current);
        /**
         * THE FLAG IS WRITTEN ON COMPLETION, NOT ON START.
         *
         * Written at the top of the effect it was consumed by React Strict
         * Mode: in development every effect is invoked, cleaned up and invoked
         * again, so run one claimed the flag and was cancelled, and run two
         * read "already played" and bailed. The figure snapped straight to its
         * final value and the animation silently never existed, in the one
         * environment where anyone would notice it missing.
         *
         * Claiming it here means an interrupted run (a navigation mid-count)
         * simply plays again next time, which is the honest reading of "once
         * per session" anyway.
         */
        try {
          window.sessionStorage.setItem(SESSION_KEY, "1");
        } catch {
          /* private mode: see the note above */
        }
      }
    };
    setDisplay(0);
    frame = requestAnimationFrame(tick);
    return () => {
      counting.current = false;
      cancelAnimationFrame(frame);
    };
  }, []);

  // A later data refresh must land instantly, not re-animate.
  React.useEffect(() => {
    if (counting.current) return;
    setDisplay(value);
  }, [value]);

  return (
    <span id={id} className={className}>
      {formatInr(display)}
    </span>
  );
}
