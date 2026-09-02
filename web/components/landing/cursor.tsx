"use client";

/**
 * Sorted · the cursor: a precision crosshair
 *
 * A small gapped crosshair that follows the pointer, and tightens into a
 * rotated mark with a guilt-free centre over anything you can act on.
 *
 * WHY A CROSSHAIR. The page's world is an instrument: a departure board of real
 * bank alerts, mono figures, hairline rules, a diagram drawn to scale. A ring
 * (the previous cursor, and the dot-and-lagging-ring before it) is the generic
 * agency cursor and belongs to no product in particular. A registration mark
 * belongs to this one. It also reads as precision rather than decoration, which
 * is the promise the product is making.
 *
 * VISIBILITY WITHOUT A BLEND MODE. Each stroke is CASED: an ink line 3.6px wide
 * underneath, a cream line 1.6px on top. That is the cartographer's trick for a
 * line that has to cross any terrain, and it means the mark is legible on the
 * ink hero, on cream, and on a saturated bucket fill without knowing which it
 * is over. The cursor before this used `mix-blend-mode: difference` for the
 * same guarantee and it cost a full-document recomposite on every pointer move;
 * casing costs nothing and never changes.
 *
 * THE STATE CHANGE IS ONE TWEEN. Over an interactive element the mark rotates
 * 45°, TIGHTENS to 0.8, and its guilt-free centre fades in: a plus becoming a
 * cross, locking on. It shrinks rather than swells on purpose: the first pass
 * scaled it up and put a 44px cross straight over the "Sign in" label, hiding
 * the word the pointer was aimed at. `closest()` runs on every move because it
 * is cheap; the tween only fires when the state actually flips.
 *
 * FENCED, unchanged: never on touch or coarse pointers, never under
 * prefers-reduced-motion, mounted by React only after the query matches so it
 * does not exist without JavaScript, `pointer-events: none` so it can never
 * steal a click, and the native cursor is hidden only while this one is drawn.
 */

import * as React from "react";

import { gsap, FINE_POINTER_QUERY } from "./gsap-setup";
import { useIsoLayoutEffect } from "./use-motion";

const SIZE = 34;
const C = SIZE / 2;
const ARM = 15; // outer reach
const GAP = 5; // centre gap

export function Cursor() {
  const [armed, setArmed] = React.useState(false);
  const markRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const mql = window.matchMedia(FINE_POINTER_QUERY);
    const sync = () => setArmed(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  useIsoLayoutEffect(() => {
    if (!armed) return;
    const mark = markRef.current;
    if (!mark) return;

    document.documentElement.classList.add("sorted-cursor");

    const ctx = gsap.context(() => {
      gsap.set(mark, { xPercent: -50, yPercent: -50, opacity: 0 });

      const x = gsap.quickTo(mark, "x", { duration: 0.1, ease: "none" });
      const y = gsap.quickTo(mark, "y", { duration: 0.1, ease: "none" });

      let shown = false;
      let hot = false;

      const onMove = (event: PointerEvent) => {
        x(event.clientX);
        y(event.clientY);

        if (!shown) {
          shown = true;
          gsap.to(mark, { opacity: 1, duration: 0.18, ease: "sortedOut" });
        }

        const target = event.target as Element | null;
        const next = Boolean(target?.closest?.("[data-cursor], a, button"));
        if (next !== hot) {
          hot = next;
          mark.dataset.hot = next ? "true" : "false";
          // It TIGHTENS onto the target rather than swelling over it. Scaling
          // up put a 44px cross on top of a "Sign in" label and hid the word
          // the pointer was aimed at: a cursor that obscures what it is
          // pointing at is working against itself. Rotating and shrinking reads
          // as locking on, and leaves the target readable.
          gsap.to(mark, {
            rotate: next ? 45 : 0,
            scale: next ? 0.8 : 1,
            duration: 0.3,
            ease: "sortedOut",
            overwrite: "auto",
          });
        }
      };

      const onLeave = () => {
        shown = false;
        gsap.to(mark, { opacity: 0, duration: 0.16, ease: "sortedOut" });
      };

      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave);
      return () => {
        window.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerleave", onLeave);
      };
    });

    return () => {
      document.documentElement.classList.remove("sorted-cursor");
      ctx.revert();
    };
  }, [armed]);

  if (!armed) return null;

  const arms = [
    [C, C - ARM, C, C - GAP],
    [C, C + GAP, C, C + ARM],
    [C - ARM, C, C - GAP, C],
    [C + GAP, C, C + ARM, C],
  ] as const;

  return (
    <div
      ref={markRef}
      aria-hidden="true"
      data-hot="false"
      className="sorted-mark pointer-events-none fixed left-0 top-0 z-[70]"
      style={{ width: SIZE, height: SIZE }}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} fill="none">
        {/* the casing: ink underneath, so the mark survives any ground */}
        <g stroke="var(--ink)" strokeWidth={3.6} strokeLinecap="round">
          {arms.map(([x1, y1, x2, y2]) => (
            <line key={`c${x1}${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </g>
        <g stroke="var(--bg)" strokeWidth={1.6} strokeLinecap="round">
          {arms.map(([x1, y1, x2, y2]) => (
            <line key={`f${x1}${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </g>
        <circle
          className="sorted-mark__eye"
          cx={C}
          cy={C}
          r={3}
          fill="var(--bucket-guiltfree)"
          stroke="var(--ink)"
          strokeWidth={1.2}
        />
      </svg>
    </div>
  );
}
