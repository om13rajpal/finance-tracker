import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Sorted · icons
 *
 * Every glyph is authored on a 24×24 grid at a 2px stroke, which lands at
 * ~1.42px once drawn at the chip's 17px — the weight the system is tuned to.
 *
 * WHY THESE ARE INLINE PATHS AND NOT A `<use href>` SPRITE.
 *
 * The locked icon rule in the brand kit says every `<svg>` wrapping a `<use>`
 * MUST carry `viewBox="0 0 24 24"`, because the sprite's symbols are `<g>`
 * elements and a `<g>` carries no intrinsic viewBox for the `<use>` to inherit.
 * Miss it once and the icon draws at native size and clips to the top-left —
 * which reads as "the icon isn't centred" rather than as a markup bug, so it
 * hides in plain sight. It shipped 42 times before it was caught.
 *
 * A single React component with the viewBox baked in makes that failure
 * unrepresentable: there is no call site that can forget it. This satisfies the
 * rule's intent rather than routing around it — the grep guard
 * (`<svg><use` must return zero) still passes trivially, because there are no
 * `<use>` elements left in the authenticated app at all.
 */

const PATHS = {
  // ── navigation ───────────────────────────────────────────────────────────
  // A route is not a category, so these are ink strokes with no fill — drawn
  // in the chip's circular form but never wearing a bucket colour.
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  accounts: (
    <>
      <path d="M3.5 9.5 12 4.2l8.5 5.3" />
      <path d="M6 9.8v8.4M10 9.8v8.4M14 9.8v8.4M18 9.8v8.4" />
      <path d="M3.5 19.6h17" />
    </>
  ),
  transactions: (
    <>
      <path d="M4 8.4h13" />
      <path d="M13.6 5 17 8.4 13.6 11.8" />
      <path d="M20 15.6H7" />
      <path d="M10.4 12.2 7 15.6l3.4 3.4" />
    </>
  ),
  budgets: (
    <>
      <path d="M3.8 17.6a8.2 8.2 0 1 1 16.4 0" />
      <path d="M12 17.6 16.2 10.4" />
      <circle cx="12" cy="17.6" r="1.3" />
    </>
  ),
  goals: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  investments: (
    <>
      <path d="M4 16.6 9.2 10l3.8 3.8L19.4 5" />
      <path d="M14.8 5h4.8v4.8" />
    </>
  ),
  recurring: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4.2V9.2h-5" />
    </>
  ),
  tax: (
    <>
      <path d="M5.6 3.6h8.6l4.2 4.3v12.5H5.6z" />
      <path d="M14 3.6v4.3h4.4" />
      <path d="M9 17.4 14.6 11.8" />
      <circle cx="9.6" cy="12.4" r=".9" />
      <circle cx="14" cy="16.8" r=".9" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7.2h9.4M18.6 7.2h1.4M4 16.8h4.4M13.6 16.8h6.4" />
      <circle cx="16" cy="7.2" r="2.4" />
      <circle cx="11" cy="16.8" r="2.4" />
    </>
  ),

  // ── the four buckets ─────────────────────────────────────────────────────
  // Unlike the retired six-chip set the glyph is REINFORCING rather than
  // load-bearing (all four colours separate on hue alone, tightest gap 65°) —
  // but it is never omitted. A chip with no icon is a bug, not a variant.
  "b-fixed": (
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.4" />
      <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
    </>
  ),
  "b-invest": (
    <>
      <path d="M4 16.6 9.2 10l3.8 3.8L19.4 5" />
      <path d="M14.8 5h4.8v4.8" />
    </>
  ),
  "b-savings": (
    <>
      <ellipse cx="12" cy="6.6" rx="7.2" ry="2.8" />
      <path d="M4.8 6.6v10.8c0 1.55 3.22 2.8 7.2 2.8s7.2-1.25 7.2-2.8V6.6" />
      <path d="M4.8 12c0 1.55 3.22 2.8 7.2 2.8s7.2-1.25 7.2-2.8" />
    </>
  ),
  "b-guiltfree": (
    <>
      <path d="M12 3.4v3.1M12 17.5v3.1M3.4 12h3.1M17.5 12h3.1" />
      <path d="M6.2 6.2 8.4 8.4M15.6 15.6l2.2 2.2M17.8 6.2 15.6 8.4M8.4 15.6l-2.2 2.2" />
      <circle cx="12" cy="12" r="3.1" />
    </>
  ),

  // ── direction ────────────────────────────────────────────────────────────
  // The ARROW carries direction, not the hue. Under deuteranopia and in
  // greyscale the arrow still says which way the money went.
  in: (
    <>
      <path d="M12 19.5v-14" />
      <path d="M5.8 11.7 12 5.5l6.2 6.2" />
    </>
  ),
  out: (
    <>
      <path d="M12 4.5v14" />
      <path d="M5.8 12.3 12 18.5l6.2-6.2" />
    </>
  ),
  /** The chipless "we don't know yet" glyph. An open question, not an error. */
  unknown: (
    <>
      <path d="M9.1 9.2a3 3 0 1 1 3.9 2.9c-.7.25-1 .8-1 1.5v.7" />
      <path d="M12 17.6v.6" />
    </>
  ),

  // ── account types ────────────────────────────────────────────────────────
  // An account type is NOT a bucket, so these are ink strokes in the chip's
  // circular form with no fill — the same rule the nav rail follows. Filling
  // one would say "this account is a spending destination", which is a lie the
  // colour system must not tell.
  card: (
    <>
      <rect x="3.4" y="5.6" width="17.2" height="12.8" rx="2.4" />
      <path d="M3.4 10h17.2" />
      <path d="M6.8 14.6h3.6" />
    </>
  ),
  cash: (
    <>
      <rect x="3" y="6.4" width="18" height="11.2" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6.4 12h.1M17.5 12h.1" />
    </>
  ),
  vault: (
    <>
      <rect x="3.6" y="4.4" width="16.8" height="15.2" rx="2.4" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 4.4v3.9M12 15.7v3.9M3.6 12h4.8M15.6 12h4.8" />
    </>
  ),
  flag: (
    <>
      <path d="M5.6 20.4V4.2" />
      <path d="M5.6 5.2h11.6l-2 3.6 2 3.6H5.6z" />
    </>
  ),

  // ── controls ─────────────────────────────────────────────────────────────
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />,
  plus: <path d="M12 5.2v13.6M5.2 12h13.6" />,
  minus: <path d="M5.2 12h13.6" />,
  check: <path d="M4.8 12.6 9.6 17.4 19.2 6.8" />,
  chevronDown: <path d="M6 9.5 12 15.5 18 9.5" />,
  chevronRight: <path d="M9.5 6 15.5 12 9.5 18" />,
  trash: (
    <>
      <path d="M4.4 6.6h15.2" />
      <path d="M9.4 6.6V4.6h5.2v2" />
      <path d="M6.4 6.6 7.3 20h9.4l.9-13.4" />
      <path d="M10.2 10.2v6M13.8 10.2v6" />
    </>
  ),
  pause: <path d="M9.2 5.4v13.2M14.8 5.4v13.2" />,
  play: <path d="M7.6 5.2 18.4 12 7.6 18.8z" />,
  upload: (
    <>
      <path d="M12 15.6V4.4" />
      <path d="M7.6 8.8 12 4.4l4.4 4.4" />
      <path d="M4.6 15.4v3.2a1 1 0 0 0 1 1h12.8a1 1 0 0 0 1-1v-3.2" />
    </>
  ),
  download: (
    <>
      <path d="M12 4.4v11.2" />
      <path d="M7.6 11.2 12 15.6l4.4-4.4" />
      <path d="M4.6 15.4v3.2a1 1 0 0 0 1 1h12.8a1 1 0 0 0 1-1v-3.2" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="M15.4 15.4 20 20" />
    </>
  ),
  filter: <path d="M3.8 6.2h16.4L14 13.2v5.4l-4 2.2v-7.6z" />,
  mail: (
    <>
      <rect x="3.4" y="5.6" width="17.2" height="12.8" rx="2.2" />
      <path d="M3.9 7 12 12.6 20.1 7" />
    </>
  ),
  history: (
    <>
      <path d="M4.2 12a7.8 7.8 0 1 0 2.4-5.6" />
      <path d="M4.2 4.4v4.6h4.6" />
      <path d="M12 7.8V12l3 1.8" />
    </>
  ),
  /** The one alert glyph. Reserved for a real failure, never for a gap. */
  alert: (
    <>
      <path d="M12 7.4v5.4" />
      <path d="M12 16.4v.6" />
    </>
  ),
  wall: <path d="M12 4v16" />,
  logout: (
    <>
      <path d="M15.4 7.6V5.4a1 1 0 0 0-1-1H5.6a1 1 0 0 0-1 1v13.2a1 1 0 0 0 1 1h8.8a1 1 0 0 0 1-1v-2.2" />
      <path d="M9.8 12h9.6" />
      <path d="M16.4 9 19.4 12l-3 3" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Pixel size. Defaults to the chip's 17px. */
  size?: number;
  /** Give it a label only when the icon is the sole carrier of meaning. */
  title?: string;
}

export function Icon({ name, size = 17, title, className, ...props }: IconProps) {
  return (
    <svg
      // viewBox is not optional and cannot be overridden from a call site.
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={cn("block flex-none", className)}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}

/**
 * THE TETHER · a static provenance mark, never an event.
 *
 * The identical stroke to the login constellation's connectors — 1.6px ink,
 * dash `4 6`, round caps. It marks a row the Gmail parser filed by itself,
 * which makes the product's most unusual capability visible in the one place
 * it actually happened.
 *
 * It does not animate. When a parser-filed row arrives live the WHOLE ROW
 * fades in and the tether comes along inside it; it never has a motion of its
 * own. It is a mark, not an announcement.
 */
export function Tether({ label, className }: { label?: string; className?: string }) {
  return (
    <svg
      width={16}
      height={12}
      viewBox="0 0 16 12"
      fill="none"
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cn("block text-ink", className)}
    >
      {label ? <title>{label}</title> : null}
      <path
        d="M1 6h14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeDasharray="4 6"
        strokeLinecap="round"
      />
    </svg>
  );
}
