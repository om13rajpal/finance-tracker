/**
 * Sorted · landing page marks
 *
 * The four bucket glyphs and the rupee core, drawn inline rather than pulled
 * from a `<defs>` sprite. That is deliberate: the LOCKED icon rule says every
 * `<svg>` wrapping a `<use href="#id">` must carry `viewBox="0 0 24 24"`,
 * because the sprite's icons are `<g>` elements and a `<g>` has no intrinsic
 * viewBox to inherit. Inlining sidesteps the whole class of bug — there is no
 * `<use>` on this page at all — and it also means the marks ship inside the
 * server-rendered HTML, so they are present with JavaScript disabled.
 *
 * Everything here is stroke-only on a 24-unit grid, so a single mark scales
 * from a 30px chip to a 420px hero disc without a second asset.
 */

import type { BucketId } from "./data";

const GLYPHS: Record<BucketId, JSX.Element> = {
  // A lock: money that leaves whether you look or not.
  fixed: (
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.4" />
      <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
    </>
  ),
  // A line that goes up and to the right, with the arrowhead it earned.
  invest: (
    <>
      <path d="M4 16.6 9.2 10l3.8 3.8L19.4 5" />
      <path d="M14.8 5h4.8v4.8" />
    </>
  ),
  // A jar.
  savings: (
    <>
      <ellipse cx="12" cy="6.6" rx="7.2" ry="2.8" />
      <path d="M4.8 6.6v10.8c0 1.55 3.22 2.8 7.2 2.8s7.2-1.25 7.2-2.8V6.6" />
      <path d="M4.8 12c0 1.55 3.22 2.8 7.2 2.8s7.2-1.25 7.2-2.8" />
    </>
  ),
  // A small sun. The hero bucket gets the only cheerful glyph in the set.
  guiltfree: (
    <>
      <path d="M12 3.4v3.1M12 17.5v3.1M3.4 12h3.1M17.5 12h3.1" />
      <path d="M6.2 6.2 8.4 8.4M15.6 15.6l2.2 2.2M17.8 6.2 15.6 8.4M8.4 15.6l-2.2 2.2" />
      <circle cx="12" cy="12" r="3.1" />
    </>
  ),
};

export function BucketGlyph({
  id,
  className,
  style,
  stroke = "var(--ink)",
  strokeWidth = 2,
}: {
  id: BucketId;
  className?: string;
  style?: React.CSSProperties;
  stroke?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {GLYPHS[id]}
    </svg>
  );
}

/**
 * The 30px taxonomy chip, exactly as the authenticated app draws it: flat
 * bucket fill, 1.5px ink border, the glyph at 56% of the diameter so a 2-unit
 * stroke on the 24-grid lands at ~1.42px — the locked `--stroke-icon` maths.
 */
export function BucketChip({ id, size = 30 }: { id: BucketId; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-pill border-panel border-ink"
      style={{ width: size, height: size, background: `var(--bucket-${id})` }}
    >
      <BucketGlyph id={id} strokeWidth={2} style={{ width: size * 0.56, height: size * 0.56 }} />
    </span>
  );
}

/**
 * The hero disc: the chip at 8–14× scale, cropped by the viewport edge.
 * Same object, same stroke logic, absurd size. That is the whole joke.
 */
export function BucketDisc({
  id,
  size,
  className,
  style,
}: {
  id: BucketId;
  /** A CSS length — usually a clamp(), so a 420px disc on a desktop is a
   *  160px disc on a phone instead of swallowing the copy. */
  size: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      className={`grid place-items-center rounded-pill border-core border-ink ${className ?? ""}`}
      style={{ width: size, height: size, background: `var(--bucket-${id})`, ...style }}
    >
      <BucketGlyph id={id} strokeWidth={1.4} style={{ width: "44%", height: "44%" }} />
    </div>
  );
}

/**
 * The rupee core. Cream stroke on ink — the login constellation's centre,
 * blown up to fill a hero. Hollow, so the wordmark in front of it never loses
 * contrast: cream type over a 22%-cream stroke on ink still measures ~9.9:1.
 */
export function RupeeCore({
  className,
  glyphSize,
  style,
}: {
  className?: string;
  /** CSS length for the ₹. Explicit rather than relative: the core is sized in
   *  viewport units and there is no container query to hang an `em` off. */
  glyphSize: string;
  style?: React.CSSProperties;
}) {
  return (
    <div aria-hidden="true" className={`relative grid place-items-center ${className ?? ""}`} style={style}>
      <svg viewBox="0 0 200 200" focusable="false" className="absolute inset-0 h-full w-full" fill="none">
        <circle cx="100" cy="100" r="94" stroke="var(--bg)" strokeWidth="0.6" />
        <circle
          cx="100"
          cy="100"
          r="74"
          stroke="var(--bg)"
          strokeWidth="0.6"
          strokeDasharray="4 6"
          strokeLinecap="round"
        />
      </svg>
      {/*
        The ₹ is set as HTML, not as an SVG <text>. SVG text takes the whole
        run in one resolved family, so if the display face has no U+20B9 the
        glyph falls apart; HTML does per-character font fallback and simply
        borrows the rupee from the next family in the stack. Outlined rather
        than filled — hairline thinking, at 280px.
      */}
      <span
        className="relative font-disp leading-none"
        style={{
          fontSize: glyphSize,
          letterSpacing: "-0.035em",
          color: "transparent",
          WebkitTextStroke: "2.5px var(--bg)",
        }}
      >
        ₹
      </span>
    </div>
  );
}

/**
 * The tether: the dotted lead-in that marks a row the Gmail parser filed
 * itself. LOCKED stroke — 1.6px, `dasharray 4 6`, round caps.
 *
 * It is revealed by scaling this SVG from its left edge, NEVER by animating
 * `strokeDashoffset` against a path-length `strokeDasharray`. Doing that
 * replaces the `4 6` pattern with one enormous dash and the tether arrives
 * SOLID — a documented, shipped-and-fixed defect (`landing-tether-lost-its-dots`).
 * A solid line is simply not the tether.
 */
export function Tether({
  className,
  stroke = "var(--ink)",
  style,
}: {
  className?: string;
  stroke?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 1000 24"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
      fill="none"
    >
      <path
        d="M0 12 H1000"
        stroke={stroke}
        strokeWidth="1.6"
        strokeDasharray="4 6"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
