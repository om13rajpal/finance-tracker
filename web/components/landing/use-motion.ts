"use client";

/**
 * Sorted · landing page motion hooks
 *
 * `@gsap/react` (the `useGSAP` hook package) is not installed in this repo, so
 * cleanup is done the way the rest of the app already does it: a
 * `gsap.context()` created inside a layout effect and reverted on unmount.
 * `gsap.matchMedia()` handles the reduced-motion and pointer gates, and
 * reverting the matchMedia instance tears down every tween, ScrollTrigger,
 * SplitText and pin it created, including the inline styles they set.
 *
 * That last part is what makes the no-JS guarantee hold: GSAP is only ever
 * allowed to establish a pre-animation state from INSIDE the effect. Nothing on
 * this page is hidden by CSS waiting for JavaScript to reveal it.
 */

import * as React from "react";
import { gsap, FINE_POINTER_QUERY } from "./gsap-setup";

/** useLayoutEffect on the client, useEffect on the server (no hydration warning). */
export const useIsoLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

/**
 * Magnetic hover.
 *
 * The element leans toward the pointer and snaps home when it leaves. Applied
 * to a WRAPPER, never to the pressable control itself: the stamp press writes
 * `transform: translateY(2px)` from CSS, and a GSAP inline transform on the
 * same node would win and eat the press. Wrapper moves, button presses.
 */
export function useMagnetic<T extends HTMLElement>(strength = 0.3, cap = 26) {
  const ref = React.useRef<T | null>(null);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const mm = gsap.matchMedia();
    mm.add(FINE_POINTER_QUERY, () => {
      const clamp = gsap.utils.clamp(-cap, cap);
      const xTo = gsap.quickTo(el, "x", { duration: 0.42, ease: "sortedOut" });
      const yTo = gsap.quickTo(el, "y", { duration: 0.42, ease: "sortedOut" });

      const onMove = (event: PointerEvent) => {
        const rect = el.getBoundingClientRect();
        xTo(clamp((event.clientX - (rect.left + rect.width / 2)) * strength));
        yTo(clamp((event.clientY - (rect.top + rect.height / 2)) * strength));
      };
      const onLeave = () => {
        xTo(0);
        yTo(0);
      };

      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerleave", onLeave);
      return () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerleave", onLeave);
      };
    });

    return () => mm.revert();
  }, [strength, cap]);

  return ref;
}
