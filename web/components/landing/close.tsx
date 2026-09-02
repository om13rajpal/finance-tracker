"use client";

/**
 * Sorted · the door
 *
 * Back to ink, and back to the wordmark. The four discs converge on it,
 * which is the login constellation's own gesture aimed at the word instead of
 * at a second mark.
 *
 * That convergence used to be the answer to a hero that opened with the same
 * four discs scattered. The hero has since been stripped to the core alone, so
 * the gesture now closes a different and better arc: the buckets are not
 * pre-announced at the door, they are taught by the sort and walked through as
 * four rooms, and only here (once they mean something) do they gather back
 * into the word the product is named for. They are also small and held inside
 * the frame here, never cropped by it, which is what stopped the hero's version
 * from reading as composition.
 *
 * THE CTA, INVERTED. The stamp is `0 2px 0 var(--ink)` and is invisible on ink,
 * so here the pill is cream with the stamp drawn in `--bucket-guiltfree`. The
 * press rule is unchanged and is not negotiable: translateY exactly the 2px
 * shadow offset, shadow collapsed to zero, BOTH transitioned over 110ms on one
 * curve so the shadow's lower edge stays pinned and the button descends into
 * it. Never `scale()`. See `.stamp-on-ink` in globals.css.
 *
 * The magnetic follow is on a WRAPPER span, never on the anchor: GSAP writes an
 * inline transform, and an inline transform beats the `:active` translateY that
 * the press depends on.
 */

import * as React from "react";
import Link from "next/link";

import { gsap, MOTION_QUERY } from "./gsap-setup";
import { useIsoLayoutEffect, useMagnetic } from "./use-motion";
import { BucketDisc } from "./icons";
import { BUCKET_ORDER, BUCKETS } from "./data";

const START = [
  { css: "left-[6%] top-[12%]", from: { x: -180, y: -120 } },
  { css: "right-[8%] top-[8%]", from: { x: 200, y: -140 } },
  { css: "left-[14%] bottom-[14%]", from: { x: -220, y: 160 } },
  { css: "right-[10%] bottom-[10%]", from: { x: 190, y: 150 } },
] as const;

export function Close() {
  const rootRef = React.useRef<HTMLElement>(null);
  const ctaRef = useMagnetic<HTMLSpanElement>(0.45, 26);

  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const mm = gsap.matchMedia(root);

    mm.add(MOTION_QUERY, () => {
      const tl = gsap.timeline({
        defaults: { ease: "power4.out" },
        scrollTrigger: { trigger: root, start: "top 78%", once: true },
      });

      tl.from(".l-close-word", { yPercent: 26, opacity: 0, duration: 1.1 }, 0)
        .from(".l-close-cta", { y: 22, opacity: 0, duration: 0.8 }, 0.4)
        .from(".l-close-foot", { opacity: 0, duration: 0.7 }, 0.6);

      // The discs converge on the core as the section is scrubbed into view.
      BUCKET_ORDER.forEach((id, i) => {
        gsap.from(`.l-close-disc-${id}`, {
          ...START[i].from,
          scale: 0.7,
          ease: "none",
          scrollTrigger: { trigger: root, start: "top bottom", end: "top 30%", scrub: 0.6 },
        });
      });
    });

    return () => mm.revert();
  }, []);

  return (
    <section
      ref={rootRef}
      className="on-ink relative flex min-h-[100svh] w-full flex-col justify-between overflow-hidden bg-ink px-22 py-44 text-bg lg:px-44"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {BUCKET_ORDER.map((id, i) => (
          <BucketDisc
            key={id}
            id={id}
            size="clamp(76px, 12vw, 168px)"
            className={`l-close-disc-${id} absolute ${START[i].css}`}
          />
        ))}
        {/*
          NO RUPEE CORE HERE.
          It was centred at 520px, which put a dotted orbit and a 240px ₹
          straight through the middle of a 260px wordmark: the glyph landed
          between the T and the E of SORTED. Two marks fighting for the same
          space read as clutter, not as depth, and the word is the one that has
          to win.
          The core is the HERO's graphic and it is uncontested there. Here the
          four discs converging carry the gesture on their own; they now
          converge on the wordmark itself, which is a better target than a
          watermark of a different mark.
        */}
      </div>

      <p className="relative font-num text-meta uppercase tracking-label text-bg">
        § 06: sign in
      </p>

      <div className="relative flex flex-col items-start">
        <h2
          className="l-close-word font-disp uppercase text-bg"
          style={{ fontSize: "clamp(64px, 17vw, 260px)", lineHeight: 0.82, letterSpacing: "-0.055em" }}
        >
          Sorted.
        </h2>
        <p
          className="ink-prose mt-22 max-w-[40ch] font-sans"
          style={{ fontSize: "clamp(16px, 1.35vw, 22px)", lineHeight: 1.45 }}
        >
          One person. One ledger. Built for exactly one owner and no committee, which is
          why it can be this opinionated about where your money goes.
        </p>

        <span ref={ctaRef} className="l-close-cta mt-32 inline-block">
          <Link
            href="/login"
            data-cursor="ring"
            className="stamp-on-ink inline-flex items-center rounded-pill border-panel border-ink bg-bg px-44 py-18 font-sans text-body font-semibold text-ink"
          >
            Sign in
          </Link>
        </span>
      </div>

      {/*
        THE FOOT: a designed close, not a stranded line.

        It has been three things now. First three mono strips, the first of
        which was almost word-for-word the header's own, so the page opened and
        closed on the same sentence, plus the number-grouping trivia nobody
        chooses a finance tracker on, and a description of the sign-in mechanism
        aimed at someone who has not signed in. Then one line, which fixed the
        duplication by removing the composition: a single strip of 9.5px type
        floating under a 260px wordmark reads as an afterthought.

        What is here now is a foot with STRUCTURE and only true things in it. A
        hairline, then three fields on one baseline: the mark and the name at the
        left, the four buckets in the centre as the page's own summary of itself,
        and the promise at the right. The four dots are the only ornament and
        they are not ornament: they are the product, at 8px.
      */}
      <div className="l-close-foot relative">
        <div className="ink-hair border-t-hair" />

        <div className="flex flex-col gap-22 pt-22 md:flex-row md:items-center md:justify-between md:gap-32">
          <div className="flex items-center gap-12">
            {/*
              AND NO MARK ON THE WORD EITHER. A ring with a ₹ in it, set
              immediately left of the word "Sorted", read as an icon stuck onto
              the text rather than as a mark standing beside it: the same
              clutter as the core, one twentieth the size. The word is the
              wordmark; it does not need a badge.
            */}
            <span className="font-num text-micro uppercase tracking-micro text-bg">
              Sorted
            </span>
          </div>

          <ul className="m-0 flex list-none flex-wrap items-center gap-x-26 gap-y-10 p-0">
            {BUCKETS.map((bucket) => (
              <li key={bucket.id} className="flex items-center gap-8">
                <span
                  aria-hidden="true"
                  className="block h-8 w-8 shrink-0 rounded-pill"
                  style={{ background: `var(--bucket-${bucket.id})` }}
                />
                <span className="font-num text-micro uppercase tracking-micro ink-micro">
                  {bucket.name}
                </span>
              </li>
            ))}
          </ul>

          <p className="font-num text-micro uppercase tracking-micro ink-micro">
            Private by design · one owner, no sharing, no analytics
          </p>
        </div>
      </div>

    </section>
  );
}
