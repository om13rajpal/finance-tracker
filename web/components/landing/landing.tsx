/**
 * Sorted · the public landing page
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS PAGE BREAKS THE PRODUCT'S OWN VISUAL SYSTEM ON PURPOSE. Read this before
 * "fixing" anything, because most of what looks like a violation is a licensed
 * one, and the licence has boundaries.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A previous build of this page inherited the authenticated app too literally:
 * the same cream ground, the same 1.5px ink hairline between sections, the same
 * 1180px centred column, the same 108px type ceiling, the same one-accent-block
 * restraint. Scroll animation was then layered on top. It read as quiet,
 * because the substrate was quiet, and motion on a quiet substrate is still
 * quiet. It was rejected, correctly.
 *
 * The app is opened every single morning. This page is seen once. Those are
 * different jobs, and they justify different visual languages. So:
 *
 *   BROKEN HERE, DELIBERATELY, AND ONLY HERE
 *     · the cream ground        → full-bleed ink and full-bleed bucket colour
 *     · the hairline section rule → a section boundary is a colour change, and
 *                                   once, a diagonal cut
 *     · the 108px type ceiling  → viewport-scale display type to ~260px,
 *                                 tracking -0.055em, leading 0.82
 *     · the 1180px column       → full bleed, edge to edge
 *     · the one-accent-block rule → a bucket colour owns a whole viewport
 *                                   (that rule protects a dense screen of live
 *                                   numbers; there are none on this page)
 *     · the motion budget       → three pins, a horizontal jack, a scrub, a
 *                                 a flickering board, a custom cursor, magnetic hover
 *
 *   NOT BROKEN, ANYWHERE, EVER
 *     · the palette. Ink, cream, and the four bucket hexes, from tokens.css.
 *       `web/` contains zero hardcoded hex and this page does not change that.
 *     · Bricolage Grotesque 800 display, Geist for UI, Geist Mono tabular for
 *       every rupee figure without exception.
 *     · the four buckets, their colours, their icons, the rupee core, and the
 *       tether at 1.6px with `dasharray 4 6` and round caps.
 *     · the stamp press: translateY exactly the shadow offset, shadow collapsed
 *       to zero, both transitioned together over 110ms on one curve, NEVER with
 *       a scale(). On ink the stamp is drawn in guilt-free pink instead of ink,
 *       because an ink shadow on an ink ground is nothing.
 *     · no bounce, elastic or back easing. Anywhere. The house has three
 *       monotonic curves and this page uses those.
 *     · no shadows other than that one stamp. No blur, no elevation.
 *     · real data. Real Indian merchants, real amounts, en-IN grouping.
 *     · transform / opacity / clip-path only. No layout property is animated,
 *       and there is not one scroll listener on the page — ScrollTrigger only.
 *
 *   THE THREE GUARANTEES, LOCKED BY e2e/landing.spec.ts
 *     1. With JavaScript disabled the page is complete and readable. GSAP only
 *        ever sets a pre-animation state from inside an effect; nothing is
 *        hidden by CSS waiting to be revealed. The horizontal bucket rail
 *        degrades to a real native horizontal scroller, keyboard-reachable.
 *     2. Under prefers-reduced-motion everything sits at its final frame — no
 *        pins, no jack, no board flicker, no cursor, full opacity, real content.
 *     3. Both calls to action reach /login.
 *
 * SECTION SPINE
 *   00 hero        full-bleed ink · kinetic split wordmark · four cropped
 *                  a 480-cell departure board built from the raw feed · the guilt-free figure
 *   01 the sort    pinned scrub · twelve real rows flung into four lanes that
 *                  fill with colour while mono totals tick up
 *   02 the rooms   pinned horizontal jack through four full-viewport bucket
 *                  colours
 *   03 the payoff  full-bleed guilt-free pink · outlined display type · the
 *                  figure, scrambled then counted
 *   04 the parser  ink, entered through a diagonal · the oversized tether
 *   05 what it does big-list hover, six rows at 6vw
 *   06 the door    ink · discs converge on the core · magnetic CTA
 *
 * Composition only lives in this file. Every section is its own client
 * component so that this one stays a server component and the markup ships in
 * the HTML.
 */

import { Cursor } from "./cursor";
import { Hero } from "./hero";
import { SortStage } from "./sort-stage";
import { BucketRail } from "./bucket-rail";
import { GuiltFree } from "./guilt-free";
import { Parser } from "./parser";
import { Capabilities } from "./capabilities";
import { Close } from "./close";
import { RefreshOnFonts } from "./refresh";

export function Landing() {
  return (
    // No overflow container here on purpose: every section clips its own
    // bleed, and an overflow ancestor above a ScrollTrigger pin is a classic
    // way to break pinning.
    <main className="w-full bg-bg">
      <Cursor />
      <RefreshOnFonts />
      <Hero />
      <SortStage />
      <BucketRail />
      <GuiltFree />
      <Parser />
      <Capabilities />
      <Close />
    </main>
  );
}
