"use client";

/**
 * Sorted · the payoff
 *
 * Full-bleed guilt-free pink, and the only figure on the page that behaves like
 * a hero number. Ink on `--bucket-guiltfree` measures 9.80:1 (the best of the
 * four), so an entire viewport of it carries ink type comfortably.
 *
 * RULE 12 AND WHY IT DOES NOT APPLY HERE
 * Motion rule 12 is in force everywhere behind the login: no rupee figure
 * animates, no count-up, no odometer. The reason is specific: a counting
 * number shows the owner a briefly-wrong balance, and they make decisions on
 * balances. Guilt-Free Money is the number that changes behaviour, so it is the
 * single figure most protected by that rule.
 *
 * The figure below is illustrative. It is not anyone's balance, it is not read
 * from an API, and nobody will act on it. The rule's reason does not reach it,
 * so it counts, and it gets a scramble beat first, which is the point: the
 * digits arrive as noise and resolve into a number, which is exactly what the
 * product does to a month of bank emails.
 *
 * Under prefers-reduced-motion neither the scramble nor the count is created,
 * and the real figure is already in the markup.
 */

import * as React from "react";

import { gsap, MOTION_QUERY } from "./gsap-setup";
import { useIsoLayoutEffect } from "./use-motion";
import { GUILT_FREE_FIGURE, GUILT_FREE_LABEL, formatINR } from "./data";

export function GuiltFree() {
  const rootRef = React.useRef<HTMLElement>(null);
  const figureRef = React.useRef<HTMLParagraphElement>(null);

  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    const figure = figureRef.current;
    if (!root || !figure) return;

    const mm = gsap.matchMedia(root);

    mm.add(MOTION_QUERY, () => {
      const counter = { v: 0 };

      const tl = gsap.timeline({
        scrollTrigger: { trigger: root, start: "top 62%", once: true },
      });

      tl.from(".l-gf-outline", { yPercent: 22, opacity: 0, duration: 1.1, ease: "power4.out" }, 0)
        .to(
          figure,
          {
            duration: 0.62,
            ease: "none",
            scrambleText: { text: GUILT_FREE_LABEL, chars: "0123456789", speed: 0.62, revealDelay: 0 },
          },
          0.15,
        )
        .to(
          counter,
          {
            v: GUILT_FREE_FIGURE,
            duration: 1.35,
            ease: "power3.out",
            onUpdate: () => {
              figure.textContent = formatINR(counter.v);
            },
            onComplete: () => {
              figure.textContent = GUILT_FREE_LABEL;
            },
          },
          0.8,
        )
        .from(".l-gf-body", { y: 22, opacity: 0, duration: 0.9, ease: "power4.out" }, 0.5);

      return () => {
        figure.textContent = GUILT_FREE_LABEL;
      };
    });

    return () => mm.revert();
  }, []);

  // `min-h` is a full viewport only from lg up. On a phone this section's
  // content is roughly a third of 100svh, so a full-viewport floor plus
  // `justify-center` pushed a quarter-screen of empty pink between the rail's
  // last room and this kicker: dead space, not composure. 62svh keeps the
  // section reading as a full-bleed band while closing that seam.
  return (
    <section
      ref={rootRef}
      className="relative flex min-h-[62svh] w-full flex-col justify-center overflow-hidden px-22 py-64 text-ink lg:min-h-[100svh] lg:px-44"
      style={{ background: "var(--bucket-guiltfree)" }}
    >
      <p className="font-num text-meta uppercase tracking-label">§ 03: what is left to spend</p>

      {/*
        SOLID, NOT OUTLINED.
        This was `-webkit-text-stroke: 2px` with a transparent fill: outlined
        display type, on the theory that a hairline system earns a hairline
        headline. It did not survive the render. Bricolage 800 at -0.055em
        tracking sets glyphs that already touch, and once each one is a hollow
        ring those contours cross INSIDE the letterforms: the counters of the
        double-e in "free" and the join on the hyphen turn into a lattice of
        stray strokes. Reviewed as "I don't understand this font, it looks
        broken", and it did, because a 2px outline at 168px is drawing the
        skeleton of a typeface rather than the typeface.
        Solid ink, one size down, and the giant number below it stays the only
        thing on this screen operating at poster scale.
      */}
      <h2
        className="l-gf-outline mt-14 font-disp uppercase"
        style={{
          fontSize: "clamp(30px, 7.5vw, 104px)",
          lineHeight: 0.86,
          letterSpacing: "-0.05em",
        }}
      >
        Guilt-free
        <br />
        money
      </h2>

      <p
        ref={figureRef}
        className="l-figure money mt-8 leading-[0.82] tabular-nums"
        style={{ fontSize: "clamp(64px, 22vw, 340px)", letterSpacing: "-0.045em" }}
      >
        {GUILT_FREE_LABEL}
      </p>

      <p
        className="l-gf-body mt-26 max-w-[44ch] font-sans"
        style={{ fontSize: "clamp(16px, 1.35vw, 22px)", lineHeight: 1.45 }}
      >
        Rent is paid. The SIPs went out. The recurring deposit went out. This is what is
        left, and it is yours. Sorted works it out again every time an email lands, so the
        number is never a guess.
      </p>
    </section>
  );
}
