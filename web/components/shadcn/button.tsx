"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Sorted · Button
 *
 * shadcn/ui Button, retokenised onto the Sorted system. Three locked rules
 * live here and must not be edited away:
 *
 * 1. THE STAMP PRESS. The primary button carries `shadow-stamp`
 *    (`0 2px 0 var(--ink)`) — the single permitted shadow in the whole
 *    system. Pressing translates it down by exactly the shadow offset and
 *    collapses the shadow to zero, with BOTH properties transitioned over one
 *    duration and one curve so the shadow's lower edge stays pinned and the
 *    button descends into it.
 *
 *    NEVER add `scale()`. A composited scale and a shadow repaint run on
 *    different pipelines, so a 1.5px hard border visibly glitches on press.
 *    This was a real reported bug, not a preference.
 *
 * 2. FOCUS RINGS ARE DRAWN OUTWARD. `--focus` on `--ink` measures 1.37:1, so
 *    an inset ring on the ink-filled primary is invisible. The ring is an
 *    `outline` with `outline-offset`, landing on cream at 11.77:1. Note that
 *    stock shadcn uses `ring-offset-background`, which assumes a white page —
 *    that is why this component does not use it.
 *
 * 3. THE BUSY STATE NEVER DIMS. See `busy` below.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-8 whitespace-nowrap",
    "font-sans font-semibold",
    "border-panel border-ink rounded-pill",
    "cursor-pointer select-none",
    "transition-[transform,box-shadow,background-color,color] duration-press ease-out",
    "disabled:cursor-default",
    // Reduced motion: the press still reads, it just stops moving.
    "motion-reduce:transition-none",
  ].join(" "),
  {
    variants: {
      variant: {
        /** Ink fill, cream text, the stamp. The only shadow in the system. */
        primary:
          "bg-ink text-bg shadow-stamp active:translate-y-2 active:shadow-stamp-pressed",
        /** Transparent fill, ink text, same stamp and same press. */
        ghost:
          "bg-transparent text-ink shadow-stamp active:translate-y-2 active:shadow-stamp-pressed",
        /** No border, no stamp, no press. For anything that must not look pressable. */
        bare: "border-transparent shadow-none bg-transparent text-dim-2 hover:text-ink",
      },
      size: {
        default: "text-body px-32 py-14",
        sm: "text-caption px-22 py-10",
        block: "w-full text-body px-32 py-14",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * In flight. LOCKED: a busy button is NOT dimmed.
   *
   * The house `opacity:.55` would drop cream-on-ink from 16.08:1 to roughly
   * 4:1 at the exact moment the user most needs to read the label. Instead the
   * button holds itself pressed — translated down by the full stamp offset
   * with the shadow collapsed — reusing the press vocabulary the user just
   * triggered. It reads as "still held", which is what is actually happening.
   *
   * It is also `aria-busy` and `disabled`, so the double-submit guard is
   * enforced by the DOM and not only by React state.
   */
  busy?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, busy = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        aria-busy={busy || undefined}
        // `||`, never `??`. With `disabled ?? busy` a caller passing an
        // explicit `disabled={false}` (which every form here does, to gate on
        // an empty field) short-circuits the nullish check and the busy state
        // never reaches the DOM — leaving the button clickable mid-flight and
        // the double-submit guard resting entirely on the React ref.
        disabled={Boolean(disabled) || busy}
        data-busy={busy ? "" : undefined}
        className={cn(
          buttonVariants({ variant, size }),
          // Held-pressed, not dimmed. Contrast is preserved at 16.08:1.
          busy && "translate-y-2 shadow-stamp-pressed",
          // A genuinely disabled control (not busy) may dim — nothing is
          // being read from it.
          !busy && "disabled:opacity-[.55] disabled:shadow-stamp-pressed disabled:translate-y-2",
          className,
        )}
        {...props}
      >
        {children}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
