"use client";

/**
 * Sorted · hero: THE BOARD
 *
 * A departure board for money. The whole viewport is a grid of mono cells
 * flickering through real merchants and real amounts; the wordmark sits on top
 * of it, and under the wordmark is the one number the product exists to
 * produce. Chosen over two alternatives (a live sorting machine, and four
 * full-height bucket panels) because it is the only one of the three that
 * leads with the NUMBER rather than the mechanism; the number is the
 * reason anyone would use this.
 *
 * WHY THE BOARD IS NOT DECORATION. Every glyph in the grid is a character of a
 * real bank alert: a merchant that actually bills Indian accounts, or the
 * amount it billed. The colour accents land on the first letter of a merchant
 * name, never at random. It reads as ambient texture at a glance and survives
 * being looked at closely, which is the difference between atmosphere and
 * filler.
 *
 * THE VIGNETTE, AND WHY IT IS NOT A SHADOW. The shadow policy bans blur
 * everywhere except the stamp, so the wordmark does NOT get a `text-shadow`
 * glow to lift it off the grid. Instead an ink radial sits between the board
 * and the plate: a ground for the type to stand on, drawn as a background
 * layer rather than as an effect attached to a component. Cream on that
 * ground measures the full 16.08:1, which a soft glow could not have promised.
 *
 * RULE 12. No rupee figure animates behind the login, because a counting
 * number shows the owner a briefly-wrong balance and they act on balances.
 * This figure is illustrative (it is nobody's balance and nobody will act on
 * it), so the rule's reason does not reach it. It scrambles in once, then
 * holds. It does NOT tick perpetually: an unsettled number is exactly the
 * anxiety this product is built to remove.
 *
 * ONE AUTHORED MOMENT. The board's flicker is ambient and continuous; the
 * scramble-and-settle of the figure is the authored beat. Nothing else in this
 * hero moves, on purpose.
 *
 * FOCUS AND THE STAMP ON INK. `--focus` is 1.37:1 against ink, so `.on-ink`
 * re-points the ring at cream (16.08:1): recoloured, never removed. The
 * stamp `0 2px 0 var(--ink)` is invisible on an ink ground, so the CTA draws
 * the stamp in guilt-free pink instead; the press rule is untouched
 * (translateY exactly the 2px offset, shadow collapsed, both on one 110ms
 * curve, never `scale()`).
 *
 * DEGRADATION. The board's characters are in the markup, so with JavaScript
 * off the grid renders in full and simply holds still. Under reduced motion
 * the flicker is never created and the figure is already its real value.
 */

import * as React from "react";
import Link from "next/link";

import { gsap, SplitText, ScrambleTextPlugin, MOTION_QUERY } from "./gsap-setup";
import { useIsoLayoutEffect, useMagnetic } from "./use-motion";
import {
  BOARD_CELLS,
  BOARD_GLYPHS,
  BUCKETS,
  GUILT_FREE_FIGURE,
  GUILT_FREE_LABEL,
} from "./data";

export function Hero() {
  const rootRef = React.useRef<HTMLElement>(null);
  const wordRef = React.useRef<HTMLHeadingElement>(null);
  const figureRef = React.useRef<HTMLParagraphElement>(null);
  const ctaRef = useMagnetic<HTMLSpanElement>(0.42, 22);

  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    const word = wordRef.current;
    const figure = figureRef.current;
    if (!root || !word || !figure) return;

    const mm = gsap.matchMedia(root);

    mm.add(MOTION_QUERY, () => {
      const split = SplitText.create(word, { type: "chars", mask: "chars", aria: "auto" });

      const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
      tl.from(split.chars, { yPercent: 118, duration: 1.05, stagger: 0.04 }, 0)
        .from(".l-hero-cta", { y: 18, opacity: 0, duration: 0.7 }, 0.3)
        .from(".l-hero-say", { y: 22, opacity: 0, duration: 0.8 }, 0.5)
        .from(".l-hero-legend", { opacity: 0, duration: 0.7 }, 0.7)
        // The authored beat: the digits arrive as noise and resolve, which is
        // what the product does to a month of bank emails.
        .to(
          figure,
          {
            duration: 0.9,
            ease: "none",
            scrambleText: { text: GUILT_FREE_LABEL, chars: "0123456789", speed: 0.7, revealDelay: 0.15 },
          },
          0.35,
        );

      // ── the board flicker ──────────────────────────────────────────
      // Ambient, not choreographed. A handful of cells swap glyph and pulse
      // every beat, so the grid reads as a mechanical board mid-update rather
      // than as an animation with a beginning and an end.
      //
      // Cells are collected ONCE. Re-querying 480 nodes on every tick is the
      // kind of thing that looks harmless and quietly costs a frame.
      const cells = gsap.utils.toArray<HTMLElement>(".l-cell", root);
      const flick = gsap.utils.random(0, cells.length - 1, 1, true);
      const glyph = gsap.utils.random(BOARD_GLYPHS.split(""), true);

      // NO TWEEN PER CELL: that is what pays for the board being BUSY.
      //
      // The first version called `gsap.fromTo` on seven cells every 140ms:
      // fifty tween objects a second, allocated, ticked and discarded, forever,
      // for a background texture. Cutting the rate to four cells every 190ms
      // made it cheap and also made it dead, reviewed as "it's now simple".
      // That was the wrong lever. The cost was never the number of flips, it
      // was the machinery around each one.
      //
      // A flip is now two property writes with the fade owned by a CSS
      // transition, so it costs almost nothing and the rate can go far ABOVE
      // where it started: eighteen scattered cells plus a contiguous run,
      // every 110ms. Roughly two hundred flips a second, and still 60fps.
      //
      // The run is what makes it read as a mechanical board rather than
      // random noise: real split-flap boards update a whole row at once, so a
      // sweep of adjacent cells is the gesture the eye is looking for.
      const RUN = 9;
      // `const`, not `let`: the array is mutated in place (`push`, then
      // `.length = 0`) and never reassigned, which is deliberate: reallocating
      // it every 110ms is exactly the per-frame garbage this pass removed.
      const previous: HTMLElement[] = [];

      const light = (cell: HTMLElement | undefined) => {
        if (!cell) return;
        cell.textContent = glyph() as string;
        cell.style.opacity = "0.95";
        previous.push(cell);
      };

      const tick = () => {
        // Hand the last batch back to its resting value; the CSS transition
        // carries each one down while this batch lights up. Resetting here
        // rather than in a rAF keeps the whole thing allocation-free.
        for (const cell of previous) cell.style.opacity = "";
        previous.length = 0;

        for (let i = 0; i < 18; i += 1) light(cells[flick() as number]);

        const start = flick() as number;
        for (let i = 0; i < RUN; i += 1) light(cells[start + i]);
      };

      // A repeating TIMELINE, not `gsap.delayedCall(...).repeat(-1)`.
      // A delayedCall is a zero-duration tween: `repeat` replays that zero
      // duration, not the delay, so the callback fires once and the board sits
      // frozen forever. It looks correct in the source and does nothing on
      // screen: caught only because the reduced-motion test ships with a
      // positive control asserting the board DOES move otherwise.
      const loop = gsap.timeline({ repeat: -1 });
      loop.call(tick).to({}, { duration: 0.11 });

      return () => {
        split.revert();
        loop.kill();
      };
    });

    return () => mm.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      className="on-ink relative flex min-h-[100svh] w-full flex-col overflow-hidden bg-ink text-bg"
    >
      {/* ── the board ─────────────────────────────────────────────────── */}
      <div
        aria-hidden="true"
        className="l-board pointer-events-none absolute inset-0 z-0 grid content-start gap-4 p-22 pt-96"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))", gridAutoRows: "54px" }}
      >
        {BOARD_CELLS.map((cell, i) => (
          <span
            key={i}
            className="l-cell grid select-none place-items-center rounded-xs font-num text-[15px]"
            style={{
              background: "var(--board-cell)",
              color: cell.bucket ? `var(--bucket-${cell.bucket})` : "var(--on-ink-micro)",
            }}
          >
            {cell.ch}
          </span>
        ))}
      </div>

      {/* The ground the plate stands on. A background layer, not a shadow:
          see the note at the top of this file. */}
      <div aria-hidden="true" className="l-vignette pointer-events-none absolute inset-0 z-10" />

      {/* ── chrome ────────────────────────────────────────────────────── */}
      <header className="relative z-30 flex items-center justify-end px-22 py-22 lg:px-44">
        <span ref={ctaRef} className="l-hero-cta inline-block shrink-0">
          <Link
            href="/login"
            data-cursor="ring"
            className="stamp-on-ink inline-flex items-center whitespace-nowrap rounded-pill border-panel border-ink bg-bg px-26 py-10 font-sans text-body-s font-semibold text-ink"
          >
            Sign in
          </Link>
        </span>
      </header>

      {/* ── the plate ─────────────────────────────────────────────────── */}
      <div className="relative z-20 flex flex-1 flex-col items-center justify-center px-22 text-center lg:px-44">
        <h1
          ref={wordRef}
          className="l-hero-line font-disp uppercase text-bg"
          style={{
            fontSize: "clamp(58px, 12.5vw, 186px)",
            lineHeight: 0.82,
            letterSpacing: "-0.055em",
            paddingBottom: "0.06em",
          }}
        >
          Sorted.
        </h1>

        <p
          className="l-hero-figure money mt-8 leading-none tabular-nums"
          style={{
            fontSize: "clamp(30px, 5.5vw, 74px)",
            letterSpacing: "-0.03em",
            color: "var(--bucket-guiltfree)",
          }}
        >
          <span ref={figureRef}>{GUILT_FREE_LABEL}</span>
          <span className="ml-[0.3em] font-sans text-[0.42em] font-medium text-bg">left to spend</span>
        </p>

        <p
          className="l-hero-say ink-prose mx-auto mt-26 max-w-[46ch] font-sans"
          style={{ fontSize: "clamp(16px, 1.45vw, 21px)", lineHeight: 1.45 }}
        >
          Rent is paid. The SIPs went out. Savings are set aside. This is the number
          underneath all of it, worked out again every time an email lands.
        </p>
      </div>

      {/* ── the four, named ───────────────────────────────────────────── */}
      <div className="l-hero-legend l-legend-ground relative z-20 flex flex-wrap items-center justify-center gap-x-32 gap-y-12 px-22 pb-44 pt-44 lg:px-44">
        {BUCKETS.map((bucket) => (
          <span key={bucket.id} className="flex items-center gap-10">
            <span
              aria-hidden="true"
              className="block h-8 w-8 rounded-pill"
              style={{ background: `var(--bucket-${bucket.id})` }}
            />
            <span className="font-num text-micro uppercase tracking-micro ink-micro">
              {bucket.name}
            </span>
          </span>
        ))}
      </div>
    </section>
  );
}
