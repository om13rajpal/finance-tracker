"use client";

/**
 * Sorted · landing page motion runtime
 *
 * One module registers every GSAP plugin the page uses, so registration happens
 * exactly once instead of once per section component (and never inside a render
 * that can run again).
 *
 * All GSAP plugins are free as of 3.13 (SplitText and ScrambleText included)
 * and ship inside the public `gsap` npm package. There is no auth token, no
 * private registry and no Club membership involved.
 *
 * WHAT IS NOT HERE, AND WHY: ScrollSmoother. It is installed and it was in
 * scope, but it requires wrapping the whole document in #smooth-wrapper /
 * #smooth-content, which changes the containing block for every `position:
 * fixed` descendant (including the custom cursor) and interacts badly with
 * three pinned ScrollTriggers plus Next's hydration boundary. It was the
 * lowest-value / highest-risk item on the list, so it is deliberately cut. The
 * page uses native scroll.
 */

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { CustomEase } from "gsap/CustomEase";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin, CustomEase);

  /**
   * The house curves, as GSAP eases.
   *
   * `--ease-out` is cubic-bezier(.23, 1, .32, 1) and `--ease-in-out` is
   * cubic-bezier(.77, 0, .175, 1). Both are monotonic: they never overshoot.
   * That is the point: Sorted has no bounce, elastic or back easing anywhere,
   * because a financial figure that overshoots its final value has lied to the
   * reader for eighty milliseconds. Registering them here means the landing
   * page uses the same curves as the CSS rather than an approximation.
   */
  CustomEase.create("sortedOut", "M0,0 C0.23,1 0.32,1 1,1");
  CustomEase.create("sortedInOut", "M0,0 C0.77,0 0.175,1 1,1");
}

/** Reduced motion is honoured through gsap.matchMedia(), never a bare check. */
export const NO_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const MOTION_QUERY = "(prefers-reduced-motion: no-preference)";
/** The custom cursor and magnetic hover are mouse-only affordances. */
export const FINE_POINTER_QUERY = "(prefers-reduced-motion: no-preference) and (pointer: fine)";

export { gsap, ScrollTrigger, SplitText, ScrambleTextPlugin, CustomEase };
