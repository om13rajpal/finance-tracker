"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Sorted · six-digit code entry
 *
 * Bespoke. Shadcn has no equivalent primitive in this project, and the
 * six-separate-inputs pattern most OTP components use is worth avoiding: it
 * breaks paste, fights password managers, and gives screen readers six unlabelled
 * boxes instead of one field.
 *
 * So this is ONE real input, visually presented as six slots:
 *
 *  · `autoComplete="one-time-code"` + `inputMode="numeric"` gets the iOS/Android
 *    keyboard right and lets the OS autofill the code straight from the email.
 *  · Paste works, because there is genuinely one field.
 *  · The caret is hidden and the text is transparent; the slots below render the
 *    value. The input itself stays a real, focusable, labelled control.
 *  · The focus ring is drawn on the slot row via `peer-focus-visible`, as an
 *    outline offset outward: never a box-shadow ring against an ink border.
 */
export interface OtpInputProps {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  describedBy?: string;
}

export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  id = "login-code",
  describedBy,
}: OtpInputProps) {
  const slots = [0, 1, 2, 3, 4, 5];

  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    // Strip anything that isn't a digit so a pasted "123 456" or "code: 123456"
    // still lands correctly.
    const next = e.target.value.replace(/\D/g, "").slice(0, 6);
    onChange(next);
    if (next.length === 6) onComplete?.(next);
  }

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        /*
         * Deliberately NO maxLength.
         *
         * maxLength truncates the raw string on the way in, BEFORE onChange can
         * strip separators, so a password manager or OS autofill pasting
         * "123 456" gets clipped to "123 45" and lands as five digits with no
         * error. The length cap belongs after the strip, in the handler below.
         */
        value={value}
        onChange={handle}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoFocus
        className={cn(
          "peer absolute inset-0 w-full h-full z-10",
          "bg-transparent text-transparent caret-transparent selection:bg-transparent",
          "border-0 outline-none",
          "disabled:cursor-default",
          // 16px minimum: iOS zooms the viewport on focus at 15px and under.
          "text-input",
        )}
      />

      <div
        aria-hidden
        className={cn(
          "grid grid-cols-6 gap-8 rounded-otp",
          "peer-focus-visible:outline peer-focus-visible:outline-[2.5px]",
          "peer-focus-visible:outline-focus peer-focus-visible:outline-offset-[3px]",
        )}
      >
        {slots.map((i) => {
          const char = value[i];
          const active = !disabled && i === Math.min(value.length, 5);
          return (
            <div
              key={i}
              className={cn(
                "h-64 grid place-items-center rounded-otp border-panel",
                "font-num text-h3 tabular-nums text-ink",
                "transition-[border-color] duration-hover ease-out",
                invalid ? "border-alert" : active ? "border-ink" : "border-rule",
                disabled && "opacity-[.55]",
              )}
            >
              {char ?? ""}
            </div>
          );
        })}
      </div>
    </div>
  );
}
