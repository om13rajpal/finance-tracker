import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge, taught the Sorted scales.
 *
 * This is not optional configuration. Out of the box, tailwind-merge only
 * knows Tailwind's stock class names, so every one of our custom `text-*`
 * utilities looked like a colour to it, and it resolved the "conflict" by
 * silently deleting the font size:
 *
 *   twMerge("text-h1 text-ink")        -> "text-ink"      // 40px lost
 *   twMerge("text-input text-ink")     -> "text-ink"      // 16px lost
 *   twMerge("text-label text-dim")     -> "text-dim"      // 10px lost
 *   twMerge("text-caption text-dim-2") -> "text-dim-2"    // 13.5px lost
 *
 * The 16px one is the dangerous case: it is the iOS zoom guard on form fields.
 * Below 16px, iOS zooms the viewport on focus and throws the layout sideways
 * mid-sign-in. Losing it is a real bug, not a cosmetic one, and it fails
 * silently, in production, on one platform.
 *
 * `input` is genuinely ambiguous: it is a font size in our scale AND a colour
 * in shadcn's variable bridge. We resolve it as a size, which is how the app
 * uses it.
 */
const FONT_SIZES = [
  "micro",
  "label",
  "meta",
  "caption",
  "body-s",
  "body",
  "input",
  "h3",
  "h2",
  "h1",
  "figure-2",
  "figure-1",
  "wordmark",
] as const;

const COLORS = [
  "bg",
  "ink",
  "rule",
  "ink-wash",
  "hero-field",
  "dim",
  "dim-2",
  "focus",
  "alert",
  "bucket-fixed",
  "bucket-invest",
  "bucket-savings",
  "bucket-guiltfree",
  // shadcn variable bridge
  "background",
  "foreground",
  "border",
  "ring",
  "primary",
  "secondary",
  "muted",
  "accent",
  "destructive",
  "card",
  "popover",
] as const;

const RADII = ["xs", "sm", "otp", "notice", "panel", "card", "pill"] as const;
const BORDER_WIDTHS = ["hair", "panel", "tether", "icon", "focus", "display", "core"] as const;
const SHADOWS = ["stamp", "stamp-pressed", "none"] as const;

export const cn = (() => {
  const twMerge = extendTailwindMerge({
    extend: {
      classGroups: {
        "font-size": [{ text: [...FONT_SIZES] }],
        "text-color": [{ text: [...COLORS] }],
        "bg-color": [{ bg: [...COLORS] }],
        "border-color": [{ border: [...COLORS] }],
        "border-w": [{ border: [...BORDER_WIDTHS] }],
        // Directional widths too. `border-r-panel` is how a one-sided 1.5px
        // rule is drawn: writing `border-r border-panel` instead sets 1.5px on
        // ALL FOUR sides, because `border-panel` is the all-sides utility. That
        // mistake draws three phantom hairlines and is nearly invisible against
        // a panel that already has a border.
        "border-w-t": [{ "border-t": [...BORDER_WIDTHS] }],
        "border-w-r": [{ "border-r": [...BORDER_WIDTHS] }],
        "border-w-b": [{ "border-b": [...BORDER_WIDTHS] }],
        "border-w-l": [{ "border-l": [...BORDER_WIDTHS] }],
        rounded: [{ rounded: [...RADII] }],
        "shadow": [{ shadow: [...SHADOWS] }],
        "outline-color": [{ outline: [...COLORS] }],
      },
    },
  });

  return (...inputs: ClassValue[]) => twMerge(clsx(inputs));
})();
