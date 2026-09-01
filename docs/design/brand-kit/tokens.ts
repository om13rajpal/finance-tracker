/* @moodforge
schema: 1.0
round: 4
phase: brand-kit
worker: moodforge-brand-architect
theme: sorted
version: v1
created_at: 2026-08-30T00:00:00Z
sha256: 2faa62027147322f6d81c2a2d982be94eef24cc794b6d68e13949d8af23b35a5
artifact_role: tokens
exports: [colors, buckets, bucketMeta, chipless, fonts, type, spacing, stroke, radius, shadow, motion, contrast]
summary: Sorted typed TypeScript tokens — mirrors tokens.css value-for-value. Includes the measured contrast table and the chip metadata (icon id, deuteranopia note) so runtime code can never pick a colour without its icon.
*/

/* ─────────────────────────────────────────────────────────────────────
   SORTED · design tokens (TypeScript)

   This file is the typed twin of tokens.css. Every value here appears
   verbatim there. If you change one, change both — or better, generate
   both from tokens.json.

   Import for values you need in JS (GSAP tweens, canvas, chart libs,
   inline SVG). For anything CSS can express, use the custom property.
   ───────────────────────────────────────────────────────────────────── */

// ── surface ──────────────────────────────────────────────────────────
export const colors = {
  /** the canvas — warm cream is load-bearing, never swap for white */
  bg: '#FAF5F2',
  /** text, borders, the one fill · 16.08:1 on bg */
  ink: '#1A1A1A',
  /** 1px row dividers · 1.30:1 — decorative only, never a boundary */
  rule: '#E2D8D0',
  /** nav hover/active fill · ink on it 14.40:1 */
  inkWash: '#F1E8E2',
  /** login hero panel only · ink on it 14.16:1 */
  heroField: '#FCE4CA',

  /**
   * 4.37:1 — FAILS AA at body size.
   * Mono micro-labels ONLY: uppercase, >=0.13em tracking, <=11px.
   * If your string contains a verb, you want `dim2`.
   */
  dim: '#7D7169',
  /** 5.71:1 — passes AA everywhere. REQUIRED for readable secondary prose. */
  dim2: '#6B5F57',

  /** system · focus ring. 11.77:1 on bg but only 1.37:1 on ink — always offset outward. */
  focus: '#14199C',
  /** system · errors. 6.90:1 on bg, and cream on it is 6.90:1. */
  alert: '#A61B2B',
} as const;

// ── the four-bucket taxonomy · closed set ────────────────────────────
// The four literal values of CategoryNode.bucket. Fixed in the API type,
// so a chip is always assignable honestly. Category names are unbounded
// and user-defined — they carry in TEXT, never in colour.
export const buckets = {
  fixed_costs: '#F1A007',
  investments: '#23B471',
  savings: '#5483D3',
  guilt_free: '#F9ACCE',
} as const;

export type Bucket = keyof typeof buckets;

/**
 * Bucket metadata. `icon` is not optional: colour is never the sole
 * carrier of meaning, and under deuteranopia fixed / investments move
 * toward each other. Unlike the retired six-chip set the glyph is
 * reinforcing rather than load-bearing — all six pairs separate on hue
 * alone, tightest gap 65deg.
 *
 * `inkOnFill` is the measured contrast of ink against the fill.
 * EVERY bucket is textSafe (>=4.5:1). The old set had two that were not.
 */
export const bucketMeta = {
  fixed_costs: { hex: buckets.fixed_costs, icon: 'b-fixed',     label: 'Fixed',       hsl: [ 39, 94, 49], inkOnFill: 8.10, textSafe: true },
  investments: { hex: buckets.investments, icon: 'b-invest',    label: 'Investments', hsl: [152, 67, 42], inkOnFill: 6.50, textSafe: true },
  savings:     { hex: buckets.savings,     icon: 'b-savings',   label: 'Savings',     hsl: [218, 59, 58], inkOnFill: 4.61, textSafe: true },
  guilt_free:  { hex: buckets.guilt_free,  icon: 'b-guiltfree', label: 'Guilt-free',  hsl: [334, 87, 83], inkOnFill: 9.80, textSafe: true },
} as const;

/**
 * Rows with no bucket. Transaction.categoryId is `string | null`, and
 * RecurringItem has no category at all. These NEVER get a filled chip.
 *  - uncategorised : dashed 1.5px --dim-2, no fill, question glyph.
 *                    An actionable gap, not an error — the Gmail parser
 *                    produces these by design.
 *  - income        : hollow chip, ink stroke, up arrow. Buckets describe
 *                    where money goes; income has no destination.
 */
export const chipless = {
  uncategorised: { icon: 'i-q',  style: 'dashed', stroke: '#6B5F57' },
  income:        { icon: 'i-up', style: 'solid',  stroke: '#1A1A1A' },
} as const;

// ── typography ───────────────────────────────────────────────────────
export const fonts = {
  display: "'Bricolage Grotesque', 'Geist', system-ui, sans-serif",
  ui: "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

export const type = {
  micro:    { family: fonts.mono,    weight: 500, size:   9.5, tracking:  0.13, uppercase: true,  role: 'row sub-labels' },
  label:    { family: fonts.mono,    weight: 500, size:  10,   tracking:  0.16, uppercase: true,  role: 'section labels' },
  meta:     { family: fonts.mono,    weight: 600, size:  11,   tracking:  0.20, uppercase: true,  role: 'section numbers' },
  caption:  { family: fonts.ui,      weight: 400, size:  13.5, tracking:  0,    uppercase: false, role: 'notice body, helper copy' },
  bodyS:    { family: fonts.ui,      weight: 600, size:  14.5, tracking:  0,    uppercase: false, role: 'row names, nav labels' },
  body:     { family: fonts.ui,      weight: 400, size:  15,   tracking:  0,    uppercase: false, role: 'default paragraph' },
  input:    { family: fonts.ui,      weight: 400, size:  16,   tracking:  0,    uppercase: false, role: 'form fields — never below 16, iOS zooms' },
  h3:       { family: fonts.display, weight: 800, size:  22,   tracking: -0.035, uppercase: false, role: 'panel titles' },
  h2:       { family: fonts.display, weight: 800, size:  26,   tracking: -0.035, uppercase: false, role: 'dashboard date, module headings' },
  h1:       { family: fonts.display, weight: 800, size:  40,   tracking: -0.035, uppercase: false, role: 'page titles' },
  figure2:  { family: fonts.mono,    weight: 500, size:  52,   tracking: -0.02, uppercase: false, role: 'Net Worth — the number you admire' },
  figure1:  { family: fonts.mono,    weight: 500, size: 108,   tracking: -0.02, uppercase: false, role: 'Guilt-Free Money — one per screen, never two' },
  wordmark: { family: fonts.display, weight: 800, size: 180,   tracking: -0.035, uppercase: false, role: 'brand book / cover lockup only' },
} as const;

export const leading = { tight: 1.05, snug: 1.25, body: 1.55 } as const;

// ── spacing · 2px base ───────────────────────────────────────────────
/** 14 (row gap) and 22 (panel padding) are structural. Treat them as fixed. */
export const spacing = [2, 4, 6, 8, 10, 12, 14, 18, 22, 26, 32, 44, 64, 96] as const;

// ── stroke · Sorted has no shadows, so every edge is a stroke ────────
export const stroke = {
  hair: 1,        // row dividers in `rule`
  panel: 1.5,     // THE structural weight — if it is a boundary, it is 1.5
  tether: 1.6,    // the dotted connector, deliberately 0.1 above panel
  icon: 2,        // glyphs on a 24-unit grid → 1.42px rendered at 17px
  focus: 2.5,
  display: 4,     // hero chips
  core: 4.5,      // hero rupee core
} as const;

export const dashTether = '4 6' as const;

// ── radius · no sharp corner exists in Sorted ────────────────────────
export const radius = {
  xs: 4, sm: 14, otp: 16, notice: 18, panel: 22, card: 26, pill: 999,
} as const;

// ── shadow · the single documented exception ─────────────────────────
/**
 * There are no shadows in Sorted. No blur, no spread, no elevation.
 * The stamp is the one exception and it is permitted ONLY on the primary
 * pill CTA. It is not a lift — it is a stamp sitting on paper.
 * `offset` MUST equal the press translateY. See `motion.stampPress`.
 */
export const shadow = {
  stamp: '0 2px 0 #1A1A1A',
  stampPressed: '0 0 0 #1A1A1A',
  offset: 2,
} as const;

// ── motion ───────────────────────────────────────────────────────────
export const motion = {
  ease: {
    out: 'cubic-bezier(.23, 1, .32, 1)',
    inOut: 'cubic-bezier(.77, 0, .175, 1)',
    drawer: 'cubic-bezier(.32, .72, 0, 1)',
  },
  /** GSAP string equivalents — closest match to the CSS curves above. */
  gsapEase: {
    out: 'power4.out',
    inOut: 'power4.inOut',
    drawer: 'power3.out',
  },
  duration: {
    press: 110, hover: 150, tooltip: 160, dropdown: 200,
    drawer: 320, modal: 400, skeleton: 1150,
  },
  /**
   * LOCKED (user bug report, round 3). Any component carrying the stamp
   * presses by translating down exactly the shadow offset while the
   * shadow collapses to zero — both properties transitioned together,
   * same duration, same curve.
   *
   *   correct:   transform: translateY(2px); box-shadow: 0 0 0 var(--ink)
   *   incorrect: transform: translateY(2px) scale(.985); ...
   *
   * scale() desyncs: the box-shadow repaint and the GPU-composited scale
   * run on different pipelines, so a 1.5px hard border glitches on press.
   * translateY alone, matched to the offset and sharing the shadow's
   * curve, pins the shadow's lower edge in place and the button descends
   * into it. Applies to EVERY stamp component, not just the button.
   */
  stampPress: {
    translateY: 2,
    shadowFrom: shadow.stamp,
    shadowTo: shadow.stampPressed,
    transitionBoth: true,
    neverScale: true,
  },
} as const;

// ── measured contrast · WCAG 2.1 relative luminance ──────────────────
/** Computed, not estimated. Regenerate if any colour changes. */
export const contrast = {
  'ink/bg':        { ratio: 16.08, aaBody: true,  aaLarge: true,  note: 'body, headings, borders' },
  'dim2/bg':       { ratio:  5.71, aaBody: true,  aaLarge: true,  note: 'required for readable secondary prose' },
  'dim/bg':        { ratio:  4.37, aaBody: false, aaLarge: true,  note: 'mono micro-labels ONLY — see README' },
  'rule/bg':       { ratio:  1.30, aaBody: false, aaLarge: false, note: 'non-text decorative divider — see README exemption' },
  'focus/bg':      { ratio: 11.77, aaBody: true,  aaLarge: true,  note: 'focus ring, offset outward' },
  'focus/ink':     { ratio:  1.37, aaBody: false, aaLarge: false, note: 'NEVER draw the ring against an ink fill' },
  'alert/bg':      { ratio:  6.90, aaBody: true,  aaLarge: true,  note: 'error text' },
  'bg/ink':        { ratio: 16.08, aaBody: true,  aaLarge: true,  note: 'cream label on the ink pill CTA' },
  'ink/inkWash':   { ratio: 14.40, aaBody: true,  aaLarge: true,  note: 'nav row on hover fill' },
  'dim2/inkWash':  { ratio:  5.11, aaBody: true,  aaLarge: true,  note: 'idle nav label on hover fill' },
  'ink/heroField': { ratio: 14.16, aaBody: true,  aaLarge: true,  note: 'login hero panel' },
  'bg/alert':      { ratio:  6.90, aaBody: true,  aaLarge: true,  note: 'cream on the notice bang' },
} as const;

// ── types ────────────────────────────────────────────────────────────
export type ColorToken = keyof typeof colors;
export type BucketToken = keyof typeof buckets;
export type TypeToken = keyof typeof type;
export type RadiusToken = keyof typeof radius;
export type StrokeToken = keyof typeof stroke;
export type DurationToken = keyof typeof motion.duration;
export type EaseToken = keyof typeof motion.ease;

/** Indian currency format used everywhere. Matches web/ runtime exactly. */
export const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
});
