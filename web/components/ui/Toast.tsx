"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { Icon } from "@/components/app/icons";

/**
 * Sorted · toasts
 *
 * A toast here is a cream panel with the house 1.5px ink border and the notice
 * radius. No lift, no blur, no coloured fill behind the words — the shadow
 * policy has exactly one exception and it is the stamp under a button, not
 * this.
 *
 * Success and failure are told apart by a BADGE, not by tinting the surface.
 * A green card and a red card differ only in hue, which is the one channel that
 * cannot be relied on; a tick and a bang differ in shape, which survives
 * greyscale, deuteranopia, and a glance from across the desk.
 *
 * --alert is 6.90:1 and appears on the failure badge only. It is not a
 * decorative colour and it never fills a whole surface.
 *
 * ANNOUNCEMENT. The live region is `polite` and it is in the DOM from first
 * render — a live region inserted at the same moment as its content is
 * frequently missed by screen readers, because there was nothing to observe
 * until the change had already happened.
 */

interface Toast {
  id: number;
  message: string;
  variant: "error" | "success";
}

interface ToastContextValue {
  showToast: (message: string, variant?: Toast["variant"]) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DISMISS_AFTER_MS = 5000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (message: string, variant: Toast["variant"] = "error") => {
      // Date.now() collides when two toasts fire inside the same millisecond —
      // which happens on a mutation that reports twice — and React then renders
      // two children with the same key.
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, message, variant }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_AFTER_MS)
      );
    },
    [dismiss]
  );

  // Clear every pending timer on unmount, so a navigation mid-toast cannot
  // call setState on a component that is gone.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => clearTimeout(t));
      pending.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-18 bottom-18 z-[60] flex flex-col items-end gap-12 sm:inset-x-auto sm:right-32 sm:bottom-32"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex w-full max-w-[420px] items-start gap-12",
              "rounded-notice border-panel border-ink bg-bg p-14 pr-12",
              "animate-[toast-in_200ms_cubic-bezier(.23,1,.32,1)_both] motion-reduce:animate-none"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "mt-2 grid h-22 w-22 flex-none place-items-center rounded-pill border-panel border-ink",
                t.variant === "error" ? "bg-alert text-bg" : "bg-bucket-invest text-ink"
              )}
            >
              <Icon name={t.variant === "error" ? "alert" : "check"} size={13} />
            </span>
            <p className="m-0 min-w-0 flex-1 text-caption leading-[1.45] text-ink">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="grid h-22 w-22 flex-none place-items-center rounded-pill bg-transparent text-dim-2 transition-colors duration-hover ease-out hover:text-ink"
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
