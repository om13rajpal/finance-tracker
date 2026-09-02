"use client";

/**
 * Sorted · the split
 *
 * One income arrives as a single ink bar and physically DIVIDES into four
 * coloured streams that pour down into four vessels, each filling to its real
 * level. The ribbon widths are the buckets' true shares of the month, so the
 * picture and the arithmetic are the same object.
 *
 * WHY THIS, AFTER THREE FAILURES.
 *
 * Four colour rooms, a static proportional bar, and furnished rooms all failed
 * the same way: each one restated the four bucket names in a bigger font. They
 * showed the RESULT of sorting. This shows the ACT of it: the one thing the
 * product does that a headline cannot say.
 *
 * IT IS ALSO THE ONLY CURVE ON THE PAGE. The hero is a grid of cells, the sort
 * is rows in lanes, the capabilities are rules, the close is type. A calendar
 * of thirty day-cells (the other strong candidate, and the one I preferred in
 * isolation) is ink plus a grid of small cells, which is precisely what the
 * hero already is. Two grids of small squares two sections apart is the same
 * trick twice, and this page has been punished for repetition more than for
 * anything else. Ribbons share no vocabulary with anything else here, which is
 * what makes the section land as a change of gear rather than a reprise.
 *
 * NARRATIVE HAND-OFF. Guilt-free is the last vessel, and the payoff section
 * immediately below blows that exact number up to 340px. The stream literally
 * pours into the thing the next screen is about.
 *
 * NO SCROLL-JACK. The pour is scrubbed to ordinary page scroll: you drive it,
 * but the scrollbar is never taken away from you.
 *
 * MOTION. `clip-path` on the ribbons (an inset wipe travelling downward) and
 * `scaleY` on the vessel levels. Both are on the permitted list; no layout
 * property is touched. Geometry is computed once from the shares, so the
 * drawing cannot drift from the data.
 *
 * DEGRADATION. Every path, level, figure and share is in the markup at its
 * final value. With JavaScript off the diagram is simply already poured.
 */

import * as React from "react";

import { gsap, MOTION_QUERY } from "./gsap-setup";
import { useIsoLayoutEffect } from "./use-motion";
import { BUCKETS, MONTH_TOTAL, formatINR } from "./data";

/** viewBox geometry. Fixed units so the ribbons are computed, never drawn. */
const W = 1000;
const H = 640;
const BAR = 54; // the incoming bar's depth
const MID = 310; // where the beziers turn over
const LIP = 462; // the vessels' rim
const VES_H = 152;
const GAP = 16;
const VES_W = (W - GAP * 3) / 4;

type Ribbon = { id: string; d: string; lvlY: number; lvlH: number; x: number; w: number };

const GEOMETRY: Ribbon[] = (() => {
  const out: Ribbon[] = [];
  let x = 0;
  BUCKETS.forEach((b, i) => {
    const x1 = x + (W * b.share) / 100;
    const bx0 = i * (VES_W + GAP);
    const bx1 = bx0 + VES_W;
    // Level height is proportional to the share, scaled so the largest bucket
    // nearly fills its vessel: the vessels are equal so the LEVELS carry the
    // comparison a second time, after the ribbon widths have made it once.
    const lvlH = (VES_H - 16) * (b.share / BUCKETS[0].share);
    out.push({
      id: b.id,
      d: `M${x.toFixed(1)},${BAR} C${x.toFixed(1)},${MID} ${bx0.toFixed(1)},${MID} ${bx0.toFixed(1)},${LIP} L${bx1.toFixed(1)},${LIP} C${bx1.toFixed(1)},${MID} ${x1.toFixed(1)},${MID} ${x1.toFixed(1)},${BAR} Z`,
      lvlY: LIP + VES_H - lvlH - 5,
      lvlH,
      x: bx0,
      w: VES_W,
    });
    x = x1;
  });
  return out;
})();

export function BucketRail() {
  const rootRef = React.useRef<HTMLElement>(null);

  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const mm = gsap.matchMedia(root);

    mm.add(MOTION_QUERY, () => {
      const st = () => ({
        trigger: root,
        start: "top 78%",
        end: "top 22%",
        scrub: 0.5,
      });

      // The pour. An inset wipe travelling down each ribbon, staggered so the
      // four streams leave the bar in order rather than as one slab.
      gsap.from(".l-rib", {
        clipPath: "inset(0 0 100% 0)",
        ease: "none",
        stagger: 0.12,
        scrollTrigger: st(),
      });

      // The levels rise as the streams arrive.
      gsap.from(".l-lvl", {
        scaleY: 0,
        transformOrigin: "bottom",
        ease: "none",
        stagger: 0.12,
        scrollTrigger: { ...st(), start: "top 66%" },
      });

      gsap.from(".l-cap", {
        y: 16,
        opacity: 0,
        duration: 0.7,
        ease: "power3.out",
        stagger: 0.07,
        scrollTrigger: { trigger: root, start: "top 55%", once: true },
      });
    });

    return () => mm.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      className="relative flex min-h-[100svh] w-full flex-col justify-center bg-bg px-22 py-44 text-ink lg:px-44"
    >
      <h2
        className="max-w-[17ch] font-disp uppercase"
        style={{ fontSize: "clamp(36px, 6.4vw, 96px)", lineHeight: 0.87, letterSpacing: "-0.05em" }}
      >
        It splits at the door.
      </h2>
      <p className="mt-18 max-w-[54ch] font-sans text-body text-dim-2 lg:text-[20px] lg:leading-snug">
        One income arrives. Four buckets take their cut before you have to think about any
        of it. Filed from the emails your bank already sends. This is that, drawn to scale.
      </p>

      {/* The diagram and its captions share ONE measure, derived from the
          viewBox aspect, so every figure sits under its own vessel. */}
      <div
        className="mx-auto mt-26 w-full"
        style={{ maxWidth: `min(100%, calc(40vh * ${W} / ${H}))` }}
      >
        <div className="flex items-baseline justify-between gap-18">
          <span className="font-num text-micro uppercase tracking-micro text-dim-2">
            In this month
          </span>
          <span className="money text-[clamp(18px,2.2vw,32px)] leading-none">
            {formatINR(MONTH_TOTAL)}
          </span>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          fill="none"
          aria-hidden="true"
          className="mt-10 block h-auto w-full"
        >
          <rect x="0" y="0" width={W} height={BAR} rx="7" fill="var(--ink)" />

          {GEOMETRY.map((g) => (
            <path key={g.id} className={`l-rib l-rib-${g.id}`} d={g.d} fill={`var(--bucket-${g.id})`} />
          ))}

          {GEOMETRY.map((g) => (
            <g key={g.id}>
              <rect
                x={g.x}
                y={LIP}
                width={g.w}
                height={VES_H}
                rx="12"
                fill="var(--bg)"
                stroke="var(--ink)"
                strokeWidth="2.5"
              />
              <rect
                className="l-lvl"
                x={g.x + 5}
                y={g.lvlY}
                width={g.w - 10}
                height={g.lvlH}
                rx="8"
                fill={`var(--bucket-${g.id})`}
              />
            </g>
          ))}
        </svg>

        <div className="mt-14 flex flex-wrap md:flex-nowrap" style={{ gap: `18px ${(GAP / W) * 100}%` }}>
          {BUCKETS.map((bucket) => (
            <div key={bucket.id} className="l-cap min-w-0 basis-[calc(50%-1%)] border-t-panel border-ink pt-10 md:basis-0 md:grow">
              <p className="flex items-center gap-8 font-num text-micro uppercase tracking-micro">
                <span
                  aria-hidden="true"
                  className="block h-8 w-8 shrink-0 rounded-pill"
                  style={{ background: `var(--bucket-${bucket.id})` }}
                />
                {bucket.name}
              </p>
              {/* Guilt-free deliberately prints no figure here. The payoff
                  section is the NEXT thing on the page and its entire job is
                  to set ₹18,240 at 340px; on a phone this caption and that
                  figure share a viewport, and two printings of one number a
                  screen apart read as a duplication bug: the worse for the
                  payoff being mid-scramble at that moment, so the two disagree
                  by a rupee. The stream pours into it; the number belongs to
                  the screen it pours into. */}
              {bucket.figure ? (
                <p className="money mt-6 text-[clamp(16px,1.7vw,26px)] leading-none">
                  {bucket.figure}
                </p>
              ) : (
                <p className="mt-6 whitespace-nowrap font-num text-[clamp(11px,1vw,14px)] uppercase leading-none tracking-micro">
                  {bucket.foot}
                </p>
              )}
              <p className="mt-4 font-num text-micro uppercase tracking-micro text-dim-2">
                {bucket.share.toFixed(1)}%
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
