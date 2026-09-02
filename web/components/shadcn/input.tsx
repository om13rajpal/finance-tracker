"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Sorted · Input
 *
 * shadcn/ui Input retokenised onto the Sorted field: 1.5px ink border, pill
 * radius, transparent fill.
 *
 * Two locked rules:
 *
 * 1. FONT SIZE NEVER DROPS BELOW 16px. iOS zooms the viewport on focus at
 *    15px and under, which yanks the layout sideways mid-flow. `text-input`
 *    is exactly 16px.
 *
 * 2. THE FOCUS RING IS AN OUTLINE, OFFSET OUTWARD: never a box-shadow ring.
 *    A zero-offset ring sits flush against the field's own 1.5px ink border
 *    and reproduces the forbidden 1.37:1 `--focus`-on-`--ink` adjacency. The
 *    field is transparent-filled, which makes this look safe; it is not, the
 *    border is the filled part. This shipped as a real defect once already.
 */
export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, invalid, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "w-full bg-transparent text-ink font-sans text-input",
          "border-panel border-ink rounded-pill px-22 py-14",
          "placeholder:text-dim",
          "transition-[border-color] duration-hover ease-out",
          // Never outline:none without an equivalent replacement: the
          // replacement is the global :focus-visible outline, offset outward.
          "focus-visible:outline-focus focus-visible:outline-[2.5px] focus-visible:outline-offset-[3px]",
          "disabled:opacity-[.55] disabled:cursor-default",
          invalid && "border-alert",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
