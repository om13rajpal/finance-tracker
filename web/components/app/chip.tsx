import * as React from "react";

import { cn } from "@/lib/utils";
import { BUCKET_META, chipLabel, type Bucket, type ChipSpec } from "@/lib/buckets";
import { Icon } from "@/components/app/icons";

/**
 * Sorted · the chip
 *
 * The one bespoke primitive in the system: a 30px circle, a 1.5px ink border,
 * a flat colour fill, and ALWAYS a glyph inside it.
 *
 * The four fills are the four buckets and nothing else. Ink measures 8.10 /
 * 6.50 / 4.61 / 9.80 : 1 against them, so every one is textSafe and every one
 * carries its icon at full contrast.
 *
 * CHIPS NEVER GUESS. Three of the four shapes below are deliberately NOT
 * filled, because their row has no knowable bucket:
 *
 *   · income        — `type: "income"` has no destination bucket at all.
 *                     Solid ink stroke, up arrow.
 *   · expense       — direction known, destination not. Solid ink, down arrow.
 *   · uncategorised — `categoryId` is null. This is the Gmail parser's NORMAL
 *                     output, so it is a DASHED --dim-2 ring with a question
 *                     glyph: an actionable gap, never an error, never --alert.
 *
 * A filled chip is a promise that the money's destination is known. It is only
 * ever drawn when it is.
 */

export interface ChipProps {
  spec: ChipSpec;
  /** 30px is the row chip; 22px is the legend and dense/mobile variants. */
  size?: 30 | 22;
  className?: string;
  /**
   * By default the chip is decorative — the row already names its category in
   * text, and announcing "Guilt-free" twice is noise. Set this on a row where
   * the chip is the ONLY carrier of the bucket.
   */
  labelled?: boolean;
}

export function Chip({ spec, size = 30, className, labelled = false }: ChipProps) {
  const glyph = size === 30 ? 17 : 12.5;
  const label = chipLabel(spec);

  const base = cn(
    "grid place-items-center rounded-pill flex-none text-ink",
    size === 30 ? "h-chip w-chip" : "h-22 w-22",
    className
  );

  const a11y = labelled
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": true as const };

  if (spec.kind === "bucket") {
    const meta = BUCKET_META[spec.bucket];
    return (
      <span className={cn(base, "border-panel border-ink", meta.fill)} {...a11y}>
        <Icon name={meta.icon} size={glyph} />
      </span>
    );
  }

  if (spec.kind === "uncategorised") {
    return (
      <span
        className={cn(base, "border-panel border-dashed border-dim-2 bg-transparent text-dim-2")}
        {...a11y}
      >
        <Icon name="unknown" size={glyph} />
      </span>
    );
  }

  // income / expense — the direction chips. Hollow, solid ink stroke.
  return (
    <span className={cn(base, "border-panel border-ink bg-transparent")} {...a11y}>
      <Icon name={spec.kind === "income" ? "in" : "out"} size={glyph} />
    </span>
  );
}

/** Shorthand for the common "I have a bucket" case. */
export function BucketChip({
  bucket,
  size = 30,
  labelled,
  className,
}: {
  bucket: Bucket;
  size?: 30 | 22;
  labelled?: boolean;
  className?: string;
}) {
  return <Chip spec={{ kind: "bucket", bucket }} size={size} labelled={labelled} className={className} />;
}

/**
 * The skeleton chip.
 *
 * A dashed circle at the chip's exact 30px, so the silhouette of a loading row
 * matches the silhouette of a loaded one and nothing reflows when data lands.
 */
export function ChipSkeleton({ size = 30, className }: { size?: 30 | 22; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "rounded-pill border-panel border-dashed border-dim bg-transparent flex-none",
        "animate-chip-pulse motion-reduce:animate-none motion-reduce:opacity-50",
        size === 30 ? "h-chip w-chip" : "h-22 w-22",
        className
      )}
    />
  );
}
