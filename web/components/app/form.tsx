"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Label } from "@/components/shadcn/label";
import { Input } from "@/components/shadcn/input";
import { Icon } from "@/components/app/icons";

/**
 * Sorted · form controls
 *
 * The field: 1.5px ink border, pill radius, transparent fill, 16px text.
 *
 * 16px is not a style choice. Below it, iOS zooms the viewport the moment a
 * field takes focus and throws the layout sideways mid-entry. Every control
 * here is at least `text-input`.
 *
 * The focus ring is always an OUTLINE drawn OUTWARD. --focus on --ink measures
 * 1.37:1, so a ring sitting flush against a field's own ink border reproduces
 * exactly the adjacency that is invisible. Never `outline: none`, never a
 * box-shadow ring on anything with an ink border.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Field · label + control + helper, wired together
// ═══════════════════════════════════════════════════════════════════════════

export function Field({
  id,
  label,
  helper,
  hint,
  className,
  children,
}: {
  id: string;
  label: React.ReactNode;
  /** Sentence-length guidance under the control. Always --dim-2. */
  helper?: React.ReactNode;
  /** A short mono note to the right of the label. */
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-8", className)}>
      <div className="flex items-baseline justify-between gap-12">
        <Label htmlFor={id} variant="field">
          {label}
        </Label>
        {hint ? (
          <span className="font-num text-micro uppercase tracking-micro text-dim">{hint}</span>
        ) : null}
      </div>
      {children}
      {helper ? (
        <p className="m-0 font-sans text-caption leading-[1.45] text-dim-2">{helper}</p>
      ) : null}
    </div>
  );
}

/** A form's field grid. One column on a phone, two from `sm` up. */
export function FieldGrid({
  className,
  children,
  cols = 2,
}: {
  className?: string;
  children: React.ReactNode;
  cols?: 1 | 2 | 3;
}) {
  return (
    <div
      className={cn(
        "grid gap-14",
        cols === 2 && "sm:grid-cols-2",
        cols === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        className
      )}
    >
      {children}
    </div>
  );
}

/** The row a form's submit button sits on. Hairline above, right-aligned. */
export function FormActions({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mt-18 flex flex-wrap items-center justify-end gap-12 border-t border-rule pt-18",
        className
      )}
    >
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Select
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A NATIVE select, restyled.
 *
 * Deliberately not a listbox rebuilt in React. On a phone the native control
 * opens the platform's own wheel, it is keyboard-complete for free, it is
 * announced correctly by every screen reader, and it costs zero bytes. The
 * only thing worth taking from it is the browser's default arrow, which is
 * replaced by the house chevron.
 *
 * `appearance-none` removes the arrow but NOT the control's semantics, so the
 * focus ring, the keyboard behaviour and the accessibility tree are untouched.
 */
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...props },
  ref
) {
  return (
    <span className="relative block min-w-0">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "w-full appearance-none bg-transparent font-sans text-input text-ink",
          "rounded-pill border-panel border-ink py-14 pl-22 pr-44",
          "transition-[border-color] duration-hover ease-out",
          "focus-visible:outline-focus focus-visible:outline-[2.5px] focus-visible:outline-offset-[3px]",
          "disabled:cursor-default disabled:opacity-[.55]",
          invalid && "border-alert",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <Icon
        name="chevronDown"
        size={16}
        className="pointer-events-none absolute right-18 top-1/2 -translate-y-1/2 text-ink"
      />
    </span>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Text-ish inputs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A money input.
 *
 * Set in the mono face with tabular figures for the same reason every other
 * rupee figure is: so the digits you type line up with the digits the product
 * prints back at you. `inputMode="decimal"` gets the numeric keypad on a phone
 * without losing the minus sign, which `type="number"` + `inputMode="numeric"`
 * would.
 */
export const MoneyInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function MoneyInput({ className, ...props }, ref) {
  return (
    <Input
      ref={ref}
      type="number"
      inputMode="decimal"
      step="any"
      className={cn("money text-input", className)}
      {...props}
    />
  );
});

export const DateInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function DateInput({ className, ...props }, ref) {
  return <Input ref={ref} type="date" className={cn("font-num text-input", className)} {...props} />;
});

export const TextArea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function TextArea({ className, invalid, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full resize-y bg-transparent font-sans text-input text-ink",
        "rounded-panel border-panel border-ink px-22 py-14",
        "placeholder:text-dim",
        "focus-visible:outline-focus focus-visible:outline-[2.5px] focus-visible:outline-offset-[3px]",
        "disabled:cursor-default disabled:opacity-[.55]",
        invalid && "border-alert",
        className
      )}
      {...props}
    />
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Checkbox
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A checkbox drawn as a small square in the house stroke.
 *
 * The native input is kept and only its paint is replaced (`appearance-none`),
 * so it stays a real checkbox: space toggles it, a label click reaches it, and
 * a screen reader announces its state without any aria plumbing.
 */
export function Checkbox({
  id,
  label,
  helper,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: React.ReactNode;
  helper?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-start gap-12", className)}>
      <span className="relative mt-2 grid h-22 w-22 flex-none place-items-center">
        <input
          id={id}
          type="checkbox"
          className={cn(
            "peer h-22 w-22 appearance-none rounded-xs border-panel border-ink bg-transparent",
            "checked:bg-ink",
            "focus-visible:outline-focus focus-visible:outline-[2.5px] focus-visible:outline-offset-[3px]",
            "disabled:cursor-default disabled:opacity-[.55]"
          )}
          {...props}
        />
        <Icon
          name="check"
          size={13}
          className="pointer-events-none absolute text-bg opacity-0 peer-checked:opacity-100"
        />
      </span>
      <label htmlFor={id} className="min-w-0 select-none text-body-s text-ink">
        {label}
        {helper ? (
          <span className="mt-2 block font-sans text-caption leading-[1.45] text-dim-2">
            {helper}
          </span>
        ) : null}
      </label>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Segmented control · for a closed set of 2–4 options
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Radios drawn as one pill-shaped strip.
 *
 * Used where the option set is small, closed and worth showing at a glance:
 * expense/income, old/new regime. It is a `radiogroup` of real radio inputs,
 * so arrow keys work and the state is announced; only the paint is bespoke.
 */
export function Segmented<T extends string>({
  name,
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex flex-wrap items-center gap-2 rounded-pill border-panel border-ink p-2",
        className
      )}
    >
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        const active = value === option.value;
        return (
          <span key={option.value} className="relative">
            <input
              id={id}
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              onChange={() => onChange(option.value)}
              className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-pill"
            />
            <label
              htmlFor={id}
              className={cn(
                "pointer-events-none block cursor-pointer select-none rounded-pill px-18 py-8",
                "text-body-s transition-colors duration-hover ease-out",
                active ? "bg-ink text-bg" : "text-dim-2",
                "peer-focus-visible:outline-focus peer-focus-visible:outline-[2.5px] peer-focus-visible:outline-offset-[3px]"
              )}
            >
              {option.label}
            </label>
          </span>
        );
      })}
    </div>
  );
}
