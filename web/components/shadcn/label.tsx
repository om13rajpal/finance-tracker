"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Sorted · Label
 *
 * LOCKED contrast rule, enforced by the variants below:
 *
 *   --dim   (#7D7169) measures 4.37:1 on cream and FAILS AA at body size.
 *           It is permitted ONLY for mono micro-labels.
 *   --dim-2 (#6B5F57) measures 5.71:1 and is required for anything
 *           sentence-length.
 *
 * The shipped test: if the string contains a verb, it is `--dim-2`.
 */
const labelVariants = cva("inline-block select-none", {
  variants: {
    variant: {
      /** Mono micro-label. Uppercase, tracked. The only sanctioned use of --dim. */
      micro: "font-num text-label uppercase text-dim",
      /** Sentence-length helper text. Must be --dim-2. */
      helper: "font-sans text-caption text-dim-2",
      /** A field label proper. */
      field: "font-sans text-body-s font-medium text-ink",
    },
  },
  defaultVariants: { variant: "field" },
});

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, variant, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants({ variant }), className)}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label, labelVariants };
