"use client";

/**
 * Sorted · what it actually does
 *
 * Six capabilities as full-width rows at ~6vw, not a three-column card grid.
 * A grid would make six equal small things; the list makes six big ones, and
 * these six are the entire argument for the product existing. Hover (or
 * keyboard focus, which matters more) floods the row with its bucket colour
 * and inverts the title.
 *
 * WHY THEY ARE LINKS. A row-scale hover state on a `<div>` needs `tabindex` to
 * be reachable, and a tabbable non-interactive element is a lie to a screen
 * reader. Each row goes to the same place the CTAs go, so they are anchors:
 * real focus, real hover, real semantics, no `tabindex` anywhere.
 *
 * The description is ALWAYS visible in `--dim-2` (5.71:1: the readable
 * secondary, not `--dim`, which is 4.37:1 and licensed only for mono
 * micro-labels). Hover moves it with a transform and never with opacity, so
 * nothing on this page is hidden behind an interaction a keyboard, a screen
 * reader or a JavaScript-less browser cannot perform.
 */

import * as React from "react";
import Link from "next/link";

import { gsap, MOTION_QUERY } from "./gsap-setup";
import { useIsoLayoutEffect } from "./use-motion";
import { CAPABILITIES } from "./data";

export function Capabilities() {
  const rootRef = React.useRef<HTMLElement>(null);

  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const mm = gsap.matchMedia(root);

    mm.add(MOTION_QUERY, () => {
      // Each tween gets its OWN ScrollTrigger config object. Sharing one
      // literal across several `gsap.from()` calls looks harmless and is not:
      // GSAP attaches internal state to the vars object it is handed, so the
      // second and third tweens inherit a trigger that already believes it has
      // fired. The symptom was the six titles sitting permanently at their
      // pre-animation offset: pushed out of their own clip, invisible, while
      // still reporting full opacity to any test that only checked opacity.
      const trig = () => ({ trigger: root, start: "top 72%", once: true });

      // The titles rise out of their own clip; everything else settles under
      // them. The first pass moved each whole ROW up 40% of its own height,
      // which on an 84px title is a ~70px jump: six slabs sliding, read as
      // clunky rather than composed. A masked reveal covers the same distance
      // but the eye only ever sees type arriving, not boxes travelling.
      //
      // The mask is on the TITLE, never on the row: the row is an anchor and
      // its focus ring is drawn outward at a 3px offset, so clipping at the
      // row would clip the focus ring off a keyboard user's screen.
      //
      // GSAP owns the transform on `.cap-title`; CSS owns the transform on the
      // mask around it. They must never be the same element: an inline
      // transform from GSAP cannot be overridden by a stylesheet rule, so a
      // hover translate written onto the element GSAP is animating silently
      // does nothing.
      gsap.from(".cap-title", {
        yPercent: 108,
        duration: 0.9,
        ease: "power4.out",
        stagger: 0.06,
        scrollTrigger: trig(),
      });
      // Only the supporting marks fade. The title never does: it is revealed
      // by its clip, and layering an opacity fade on top of a masked rise is
      // the thing that makes a reveal look soft instead of sharp.
      gsap.from(".l-cap .cap-meta", {
        y: 18,
        opacity: 0,
        duration: 0.7,
        ease: "power3.out",
        stagger: 0.06,
        scrollTrigger: trig(),
      });
    });

    return () => mm.revert();
  }, []);

  return (
    <section ref={rootRef} className="w-full bg-bg px-22 py-96 text-ink lg:px-44">
      <p className="font-num text-meta uppercase tracking-label text-dim">
        <span style={{ color: "var(--bucket-invest)" }}>§</span> 05: what it does
      </p>

      <h2
        className="mt-14 max-w-[18ch] font-disp uppercase"
        style={{ fontSize: "clamp(34px, 6vw, 108px)", lineHeight: 0.86, letterSpacing: "-0.05em" }}
      >
        Six things, done properly.
      </h2>

      <ul className="mt-44 border-t-hair border-rule">
        {CAPABILITIES.map((cap, i) => (
          <li key={cap.title} className="l-cap border-b-hair border-rule">
            <Link
              href="/login"
              data-cursor="ring"
              className="cap-row group relative flex w-full items-start gap-14 px-14 py-22 lg:gap-18 lg:px-26 lg:py-32"
              style={{
                ["--cap-fill" as string]: cap.accent,
                ["--cap-on" as string]: cap.on,
              }}
            >
              {/* the flood: scaleX from the left, transform only */}
              <span aria-hidden="true" className="cap-fill" />

              {/*
                Colour lives here now, not in the flood. The dot says which
                bucket this capability serves, so when two rows share a colour
                it is because they genuinely share a bucket, a fact, not a
                palette running out. Fill only, no border: all four hues sit
                above 3:1 against BOTH cream and ink, so the dot survives the
                row inverting underneath it.
              */}
              <span className="cap-meta relative flex shrink-0 items-center pt-8 lg:pt-14">
                {/* colour comes from --cap-fill on the row, not from here */}
                <span aria-hidden="true" className="cap-dot block h-10 w-10 rounded-pill" />
              </span>

              <span className="relative min-w-0 flex-1">
                {/* the title's own clip: see the reveal note in the effect */}
                <span className="cap-title-mask block overflow-hidden pb-[0.06em]">
                  <span
                    className="cap-title block font-disp uppercase"
                    style={{
                      fontSize: "clamp(28px, 6vw, 84px)",
                      lineHeight: 0.94,
                      letterSpacing: "-0.05em",
                    }}
                  >
                    {cap.title}
                  </span>
                </span>
                <span className="cap-detail cap-meta mt-8 block max-w-[54ch] font-sans text-caption text-dim-2 lg:text-body">
                  {cap.detail}
                </span>
              </span>

              <span
                aria-hidden="true"
                className="cap-arrow cap-meta relative shrink-0 self-center font-num text-[clamp(18px,2.4vw,34px)]"
              >
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
