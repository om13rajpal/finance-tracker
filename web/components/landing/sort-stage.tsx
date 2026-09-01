"use client";

/**
 * Sorted · THE SORT
 *
 * The centrepiece, and the one thing on this page that no other product could
 * show. Twelve real transactions sit in a stack; as you scrub, they are flung
 * one at a time into four vertical lanes, each lane filling with its bucket
 * colour from the bottom while a mono total ticks up beside it. You do not read
 * about the mechanic. You turn the crank and watch it run.
 *
 * HOW IT DEGRADES, WHICH IS THE WHOLE DESIGN
 * The markup IS the final frame: every row is already rendered inside the lane
 * it belongs to, every lane fill is already at its level, every total already
 * reads its real number. GSAP measures where each row ended up and animates it
 * FROM a point near the top-centre of the stage. So with JavaScript disabled,
 * or under prefers-reduced-motion, you get a finished static diagram of twelve
 * transactions correctly sorted — which is a perfectly good graphic, and is
 * exactly what the animation resolves to anyway.
 *
 * WHY IT DOES NOT THRASH
 *   · Lane fills are `scaleY` on a colour layer with `transform-origin: bottom`.
 *     Never a height animation. The levels are PRE-COMPUTED constants in
 *     data.ts, so the scrub performs no layout read at all.
 *   · Row start positions are measured once per ScrollTrigger.refresh via
 *     `offsetLeft`/`offsetTop`, which — unlike getBoundingClientRect — are not
 *     contaminated by the transform GSAP has already applied to the element.
 *     `invalidateOnRefresh` re-runs them on resize.
 *   · Transform and opacity only. No layout property is animated anywhere.
 *
 * RULE 12 NOTE. Inside the product no rupee figure ever animates: a counting
 * number shows the owner a briefly-wrong balance, and they act on balances. The
 * lane totals here belong to nobody and describe no account — they are a
 * demonstration of an arithmetic the product does. The reason for the rule does
 * not reach this page. It still reaches every screen behind the login.
 */

import * as React from "react";

import { gsap, MOTION_QUERY } from "./gsap-setup";
import { useIsoLayoutEffect } from "./use-motion";
import { BucketChip } from "./icons";
import { LANES, SORT_ROWS, formatINR } from "./data";

/** Deterministic, so the layout is identical on every load and on the server. */
const tiltFor = (i: number) => (((i * 37) % 13) - 6) * 1.5;

/** Position in the incoming stack, spread just enough to read as a pile. */
const STEP = 0.62;

function offsetWithin(el: HTMLElement, ancestor: HTMLElement) {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== ancestor) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

export function SortStage() {
  const rootRef = React.useRef<HTMLElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);

  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return;

    const mm = gsap.matchMedia(root);

    mm.add(MOTION_QUERY, () => {
      const rows = gsap.utils.toArray<HTMLElement>(".l-row", root);
      const fills = gsap.utils.toArray<HTMLElement>(".l-lane-fill", root);
      const totals = gsap.utils.toArray<HTMLElement>(".l-lane-total", root);

      gsap.set(fills, { scaleY: 0, transformOrigin: "50% 100%" });
      totals.forEach((el) => {
        el.textContent = formatINR(0);
      });

      const tl = gsap.timeline({
        defaults: { ease: "power4.out" },
        scrollTrigger: {
          trigger: root,
          start: "top top",
          end: "+=340%",
          pin: true,
          scrub: 0.55,
          invalidateOnRefresh: true,
        },
      });

      // The statement holds still while the machine runs beside it.
      tl.from(".l-sort-say", { y: 34, opacity: 0, duration: 1.2 }, 0);

      // Fling in CHRONOLOGICAL order, not DOM order. The DOM is grouped by
      // lane (all three fixed rows, then all three investment rows, …) so
      // using the array index here would sort one whole lane at a time and
      // desync the rows from the lane fills, which ARE keyed to arrival order.
      // `data-order` carries the real position in the week.
      rows.forEach((row) => {
        const i = Number(row.dataset.order ?? 0);
        tl.from(
          row,
          {
            // The stack sits near the top centre of the stage; each row travels
            // from there to wherever it already is in the DOM.
            x: () => stage.clientWidth * 0.5 - (offsetWithin(row, stage).x + row.offsetWidth / 2),
            y: () => stage.clientHeight * 0.08 - (offsetWithin(row, stage).y + row.offsetHeight / 2),
            rotation: tiltFor(i),
            scale: 1.14,
            opacity: 0,
            duration: 1,
          },
          i * STEP,
        );
      });

      LANES.forEach((lane, laneIndex) => {
        const fill = fills[laneIndex];
        const total = totals[laneIndex];
        const counter = { v: 0 };
        let running = 0;

        lane.rows.forEach((row, rowIndex) => {
          const at = SORT_ROWS.indexOf(row) * STEP;
          running += row.value;
          const level = lane.fill * ((rowIndex + 1) / lane.rows.length);

          tl.to(fill, { scaleY: level, duration: 1, ease: "power3.out" }, at);
          tl.to(
            counter,
            {
              v: running,
              duration: 1,
              ease: "power3.out",
              onUpdate: () => {
                // Formatted through Intl every frame so lakh/crore grouping
                // stays correct mid-count.
                total.textContent = formatINR(counter.v);
              },
            },
            at,
          );
        });
      });

      return () => {
        // Put the static diagram back exactly as the server rendered it.
        totals.forEach((el, i) => {
          el.textContent = LANES[i].totalLabel;
        });
      };
    });

    return () => mm.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      className="relative flex h-[100svh] w-full flex-col overflow-hidden bg-bg text-ink lg:grid lg:grid-cols-[34%_minmax(0,1fr)] lg:gap-32"
    >
      {/* ── the statement ───────────────────────────────────────────────── */}
      <div className="l-sort-say flex shrink-0 flex-col justify-center px-22 pb-18 pt-32 lg:px-44 lg:pb-44 lg:pt-44">
        {/* On desktop the copy takes the lanes' exact vertical measure —
            `min(74vh,660px)`, the same constant the grid below uses — and pins
            the kicker to its top edge and the statement to its bottom edge. The
            column and the machine then start and stop on the same two lines,
            instead of a centred paragraph bottoming out a quarter-screen above
            the lanes and leaving the lower-left empty. On mobile the wrapper
            has no height and the three lines simply stack. */}
        <div className="flex flex-col lg:h-[min(74vh,660px)] lg:justify-between">
          <p className="font-num text-meta uppercase tracking-label text-dim">
            <span style={{ color: "var(--bucket-guiltfree)" }}>§</span> 01 — how it sorts
          </p>
          <div>
            <h2
              className="mt-14 font-disp uppercase lg:mt-0"
              style={{ fontSize: "clamp(34px, 5.4vw, 92px)", lineHeight: 0.86, letterSpacing: "-0.05em" }}
            >
              Watch it work.
            </h2>
            <p
              className="mt-18 max-w-[34ch] font-sans text-dim-2"
              style={{ fontSize: "clamp(15px, 1.15vw, 20px)" }}
            >
              Twelve transactions, one week, four accounts. Every one of them arrived as a
              bank email. You typed none of them, and you categorised none of them.
            </p>
          </div>
        </div>
      </div>

      {/* ── the machine ─────────────────────────────────────────────────── */}
      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 items-center px-14 pb-32 pt-8 lg:px-44 lg:py-44"
      >
        {/* The lanes are capped and centred rather than stretched to the full
            section height: four vessels a third full read as a machine, four
            empty pipes read as a mistake. */}
        <div className="grid h-[min(54vh,470px)] w-full grid-cols-4 gap-8 lg:h-[min(74vh,660px)] lg:gap-14">
          {LANES.map((lane) => (
            <div
              key={lane.id}
              data-cursor-tint={lane.id}
              className="flex h-full min-w-0 flex-col"
            >
              <div className="flex items-center gap-6 pb-8">
                <BucketChip id={lane.id} size={18} />
                <span className="l-lane-total money truncate text-[11px] tabular-nums">
                  {lane.totalLabel}
                </span>
              </div>
              <p className="hidden pb-8 font-num text-micro uppercase tracking-micro text-dim lg:block">
                {lane.label}
              </p>

              <div className="relative min-h-0 flex-1 overflow-hidden rounded-panel border-panel border-ink">
                <div
                  aria-hidden="true"
                  className="l-lane-fill absolute inset-0"
                  style={{
                    background: `var(--bucket-${lane.id})`,
                    transformOrigin: "50% 100%",
                    transform: `scaleY(${lane.fill})`,
                  }}
                />
                <ul className="relative flex h-full flex-col justify-end gap-4 p-6 lg:gap-6 lg:p-10">
                  {lane.rows.map((row) => (
                    <li
                      key={row.merchant}
                      data-sort-row
                      data-order={SORT_ROWS.indexOf(row)}
                      className="l-row rounded-sm border-panel border-ink bg-bg px-6 py-6 lg:px-10 lg:py-8"
                    >
                      <p className="hidden truncate font-sans text-[12px] font-semibold leading-tight lg:block">
                        {row.merchant}
                      </p>
                      <p className="hidden truncate pt-2 font-num text-micro uppercase tracking-micro text-dim lg:block">
                        {row.source}
                      </p>
                      <p className="money truncate pt-0 text-[9.5px] leading-tight lg:pt-6 lg:text-[12px]">
                        {row.amount}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
