import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { formatInr } from "@/lib/format";
import { Icon, type IconName } from "@/components/app/icons";

/**
 * Sorted · the shared surfaces
 *
 * Everything behind the login is built from these. Depth comes from strokes,
 * never from shadows: the only shadow in the whole system is the 2px flat
 * stamp under a primary button, and it is a stamp, not a lift.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Panel · the container
// ═══════════════════════════════════════════════════════════════════════════

export function Panel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-panel border-panel border-ink bg-bg p-22",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * A `Panel` whose body starts collapsed (or open, via `defaultOpen`) behind
 * a click on its own header. For supporting/audit-detail content that
 * doesn't need to compete with the primary content on a page for attention
 * on first load (a lots table under a holdings summary, a tax deduction
 * editor under the regime comparison a visit is usually actually for) —
 * everything is still one click away, just not fighting for the same amount
 * of visual weight as the thing the page is for. `meta` stays visible even
 * collapsed (e.g. a count), so the header alone answers "is there anything
 * here worth opening."
 */
export function CollapsiblePanel({
  title,
  meta,
  defaultOpen = false,
  children,
  className,
  id,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  /** Forwarded to the root `Panel`: lets another screen deep-link here
   * (e.g. an anchor href="#this-id") the same way a plain `Panel` would. */
  id?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <Panel id={id} className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mb-0 flex w-full items-center justify-between gap-14 bg-transparent p-0 text-left"
      >
        <SectionLabel>{title}</SectionLabel>
        <span className="flex items-center gap-10">
          {meta ? <SectionLabel className="text-right">{meta}</SectionLabel> : null}
          <Icon
            name="chevronDown"
            size={14}
            className={cn("transition-transform duration-hover ease-out", open && "rotate-180")}
          />
        </span>
      </button>
      {open ? <div className="reveal-in mt-14">{children}</div> : null}
    </Panel>
  );
}

/**
 * The § label. Mono, uppercase, tracked, --dim.
 *
 * --dim is 4.37:1 and fails AA at body size, which is exactly why it is
 * confined to this: a mono micro-label, never a sentence. If the string you
 * are about to set has a verb in it, you want `<Helper>` instead.
 */
export function SectionLabel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("block font-num text-label uppercase text-dim", className)}
      {...props}
    >
      {children}
    </span>
  );
}

/** Sentence-length secondary text. --dim-2 at 5.71:1: passes AA at any size. */
export function Helper({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("m-0 font-sans text-caption leading-[1.45] text-dim-2", className)} {...props}>
      {children}
    </p>
  );
}

export function PanelHeader({
  title,
  meta,
  id,
  className,
  children,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  id?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("mb-14 flex items-baseline justify-between gap-14", className)}>
      <SectionLabel id={id}>{title}</SectionLabel>
      {meta ? <SectionLabel className="text-right">{meta}</SectionLabel> : null}
      {children}
    </div>
  );
}

/** The footnote strip under a panel's content. Hairline above, mono, --dim. */
export function PanelFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "mt-14 flex items-center gap-8 border-t border-rule pt-12",
        "m-0 font-num text-micro uppercase tracking-micro text-dim",
        className
      )}
    >
      {children}
    </p>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Figures · ink colours totals, always
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The 108px figure. There is exactly ONE of these on any screen.
 *
 * On the dashboard it is Guilt-Free Money, which is the number that decides
 * whether you order in tonight. Elsewhere it is whatever that screen exists to
 * tell you. It is never tinted: a total is ink, a category is colour.
 */
export function FigurePrimary({
  value,
  className,
  ...props
}: { value: string } & React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "money m-0 mt-10 text-[52px] leading-[1.05] sm:text-[72px] lg:text-figure-1",
        className
      )}
      {...props}
    >
      {value}
    </p>
  );
}

/** The 52px companion. Half the weight of attention, deliberately. */
export function FigureSecondary({
  value,
  className,
  ...props
}: { value: string } & React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("money m-0 text-h2 leading-[1.05] sm:text-[40px] lg:text-figure-2", className)}
      {...props}
    >
      {value}
    </p>
  );
}

/** A labelled sub-figure. Used under the primary figure and in stat strips. */
export function Stat({
  label,
  value,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <span className="block font-num text-micro uppercase tracking-micro text-dim">{label}</span>
      <span className="money mt-2 block text-body">{value}</span>
    </div>
  );
}

/** A row of stats separated from what is above it by a hairline. */
export function StatRow({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mt-18 grid gap-22 border-t border-rule pt-14",
        "grid-cols-2",
        className
      )}
    >
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Rows
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The row: chip · content · amount. The single most repeated layout in the
 * product, and the reason the chip column is a fixed 30px: an untethered row
 * leaves its gutter EMPTY rather than shifting left, so the chip column never
 * wavers as you scan down.
 */
export function Row({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "grid grid-cols-row items-center gap-x-14 gap-y-8 border-b border-rule py-12",
        "last:border-b-0",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** The tether variant: an empty 22px gutter ahead of the chip. */
export function TetherRow({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "grid grid-cols-row-tether items-center border-b border-rule py-10",
        "last:border-b-0",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** A row's primary name, with an optional mono sub-line under it. */
export function RowName({
  name,
  sub,
  className,
}: {
  name: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("min-w-0 pr-14 text-body-s", className)}>
      <span className="block truncate">{name}</span>
      {sub ? (
        <span className="mt-2 block truncate font-num text-micro uppercase tracking-micro text-dim">
          {sub}
        </span>
      ) : null}
    </span>
  );
}

/** A row's amount. Mono, tabular, never wrapping. */
export function Amount({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("money whitespace-nowrap text-body-s", className)} {...props}>
      {children}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// The bar
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A progress bar with shadcn Progress's mechanics: the indicator is full width
 * and slides in from the left with `translateX`. Transform only: never width,
 * because animating width is a layout property and a layout property in a list
 * of forty rows is a jank generator.
 *
 * It renders at its final value on first paint. The transition is opt-in
 * (`live`), so the bar never fills from zero on load; only a real mid-session
 * change moves it.
 *
 * OVER BUDGET. `Math.min(100, …)` clamps the fill, so the bar physically
 * cannot say how far past the line you went. Three signals carry it instead:
 * the fill runs to 100%, it hits a 7px INK WALL inside the clipped track, and
 * the overage is named in words. The wall is a SHAPE, so it survives greyscale
 * and deuteranopia, and the total is never tinted, because a total is ink.
 */
export function Bar({
  percent,
  fill,
  over = false,
  live = false,
  label,
  className,
}: {
  percent: number;
  /** A Tailwind background utility: always a bucket token, never a raw hex. */
  fill: string;
  over?: boolean;
  live?: boolean;
  label: string;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "relative h-track overflow-hidden rounded-pill border-panel border-ink bg-transparent",
        className
      )}
    >
      <div
        className={cn(
          "h-full w-full",
          fill,
          live && "transition-transform duration-dropdown ease-in-out",
          "motion-reduce:transition-none"
        )}
        style={{ transform: `translateX(${clamped - 100}%)` }}
      />
      {over ? (
        <span aria-hidden className="absolute inset-y-0 right-0 w-[7px] bg-ink" />
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// States · loading, empty, error
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The skeleton. The ONE keyframe in the system: 1150ms, --ease-in-out,
 * opacity .34 → .72, and the one thing removed outright under reduced motion,
 * because a pulsing block is exactly the kind of unrequested movement that rule
 * exists to stop.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden
      className={cn(
        "block rounded-pill bg-dim",
        "animate-chip-pulse motion-reduce:animate-none motion-reduce:opacity-50",
        className
      )}
      {...props}
    />
  );
}

/** A dashed track at the bar's exact height, so nothing reflows on the swap. */
export function BarSkeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block h-track rounded-pill border-panel border-dashed border-dim bg-transparent",
        "animate-chip-pulse motion-reduce:animate-none motion-reduce:opacity-50",
        className
      )}
    />
  );
}

/**
 * The empty state: one of the few places the authenticated app is allowed a
 * little delight. It is a sentence and a way forward, never a shrug.
 */
export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-14 py-26", className)}>
      <h3 className="m-0 font-disp text-h3 leading-[1.25] tracking-disp text-ink">{title}</h3>
      {body ? <Helper className="max-w-[42ch]">{body}</Helper> : null}
      {action}
    </div>
  );
}

/**
 * The notice: the only error surface in the product.
 *
 * `role="alert"` announces it. It is programmatically focusable because a
 * keyboard or screen-reader user otherwise has to hunt for the thing that just
 * changed. --alert is 6.90:1 and appears ONLY here and on a named overage: it
 * is not a decorative colour.
 */
export const Notice = React.forwardRef<
  HTMLDivElement,
  {
    title: React.ReactNode;
    body?: React.ReactNode;
    action?: React.ReactNode;
    tone?: "alert" | "quiet";
    className?: string;
  }
>(function Notice({ title, body, action, tone = "alert", className }, ref) {
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className={cn(
        "flex max-w-[560px] items-start gap-12 rounded-notice border-panel border-ink p-14 pr-18",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-2 grid h-22 w-22 flex-none place-items-center rounded-pill border-panel border-ink",
          tone === "alert" ? "bg-alert text-bg" : "bg-transparent text-ink"
        )}
      >
        <Icon name="alert" size={13} />
      </span>
      <div className="min-w-0">
        <p className="m-0 text-caption font-semibold leading-[1.25]">{title}</p>
        {body ? <Helper className="mt-2">{body}</Helper> : null}
        {action ? <div className="mt-12">{action}</div> : null}
      </div>
    </div>
  );
});

/**
 * A single component for the three states every query has.
 *
 * Every screen routes its loading / error / empty branches through here so the
 * vocabulary cannot drift between pages: the failure mode this replaces is
 * nine screens each inventing their own "Loading…".
 */
export function QueryState<T>({
  query,
  skeleton,
  errorTitle,
  errorBody,
  isEmpty,
  empty,
  children,
}: {
  query: { isLoading: boolean; isError: boolean; data: T | undefined };
  skeleton: React.ReactNode;
  errorTitle: string;
  errorBody?: React.ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: React.ReactNode;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isLoading) return <>{skeleton}</>;
  if (query.isError || query.data === undefined) {
    return (
      <Notice
        title={errorTitle}
        body={errorBody ?? "Please try again shortly. Nothing has been lost."}
      />
    );
  }
  if (isEmpty?.(query.data)) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Page furniture
// ═══════════════════════════════════════════════════════════════════════════

export function PageHeader({
  title,
  meta,
  actions,
  className,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-22 flex flex-wrap items-end justify-between gap-22", className)}>
      <div className="min-w-0">
        <h1 className="m-0 font-disp text-h2 leading-[1.05] tracking-disp text-ink sm:text-h1">
          {title}
        </h1>
        {meta ? (
          <p className="m-0 mt-8 font-num text-micro uppercase tracking-micro text-dim">{meta}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-12">{actions}</div> : null}
    </div>
  );
}

/** A grid of panels. 7fr/5fr on the desktop dashboard, even elsewhere. */
export function PanelGrid({
  className,
  children,
  cols = "even",
}: {
  className?: string;
  children: React.ReactNode;
  cols?: "even" | "wide-left" | "wide-right";
}) {
  return (
    <div
      className={cn(
        "grid gap-22",
        cols === "even" && "lg:grid-cols-2",
        cols === "wide-left" && "lg:grid-cols-[7fr_5fr]",
        cols === "wide-right" && "lg:grid-cols-[5fr_7fr]",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * The right-hand side of a page's own `grid items-start gap-22
 * xl:grid-cols-[7fr_5fr]` split (an add/edit form, mostly, sometimes a few
 * stacked panels — see Settings). At `xl` and up it sticks below the page's
 * own top padding and scrolls on its own once its content outgrows the room
 * that's left, instead of either scrolling away above the fold while the
 * wider column still has more below it, or (its old failure mode here: it
 * used to be `sticky` with no height cap at all) hanging off the bottom of
 * the screen with no way to reach the rest. Below `xl` it's a plain block —
 * both columns already stack there and share the page's own scroll, which is
 * correct on a narrow screen.
 *
 * `top-32` matches `ProtectedLayout`'s own `<main>` top padding at this
 * breakpoint (`lg:pt-32`, unchanged going into `xl`), so the panel settles
 * exactly where it started once it's scrolled into its stuck position rather
 * than jumping flush to the very top of the viewport. `76px` is that same
 * 32px plus `<main>`'s `pb-44` bottom padding, so this column's own
 * scrollbar (once it needs one) never runs its content under that padding.
 */
export function PinnedColumn({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "xl:sticky xl:top-32 xl:max-h-[calc(100vh-76px)] xl:self-start xl:overflow-y-auto",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** A small circular icon button: the row-level affordance. */
export const IconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }
>(function IconButton({ icon, label, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "grid h-chip w-chip flex-none place-items-center rounded-pill",
        "border-panel border-ink bg-transparent text-ink",
        "transition-colors duration-hover ease-out hover:bg-ink-wash",
        "disabled:cursor-default disabled:opacity-[.55]",
        className
      )}
      {...props}
    >
      <Icon name={icon} size={15} />
    </button>
  );
});

/**
 * A table that can still be reached when it does not fit.
 *
 * `overflow-x: auto` alone is a mouse-and-trackpad affordance: a keyboard user
 * cannot scroll a container that is not focusable, so any column past the fold
 * is simply unreachable for them. Giving the wrapper `tabIndex={0}` and a
 * `role="region"` with a name makes it a real, focusable, announced scroller:
 * the same fix the landing page's horizontal rail carries.
 *
 * The columns that matter most are still visible without scrolling at every
 * width; see the `hidden sm:table-cell` treatment at each call site.
 */
export function ScrollableTable({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "-mx-4 overflow-x-auto px-4",
        "focus-visible:outline-focus focus-visible:outline-[2.5px] focus-visible:outline-offset-[3px]",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * A hairline sparkline.
 *
 * Deliberately axis-less, label-less and tooltip-less: it answers "which way,
 * and how steadily" and nothing else. The exact numbers are already printed in
 * the table underneath it, so a chart that repeats them would be decoration.
 *
 * Drawn as a single 1.5px ink polyline with no fill and no dots: the same
 * stroke weight as every panel border, so it reads as part of the frame rather
 * than as a chart pasted into it. A flat series still draws a flat line rather
 * than dividing by zero.
 */
export function Sparkline({
  values,
  label,
  className,
}: {
  values: number[];
  label: string;
  className?: string;
}) {
  if (values.length < 2) return null;
  const w = 100;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      // 2px of padding top and bottom so the stroke is never clipped by the
      // viewBox at an extreme.
      const y = h - 2 - ((v - min) / span) * (h - 4);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn("h-[28px] w-full", className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--ink)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Modal · a focused single-item editor, off the flow of whatever list it opened from
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A centred overlay panel: same accessible-dialog mechanics as the mobile
 * nav sheet in `ProtectedLayout.tsx` (Escape closes it, focus moves onto the
 * panel on open and back to whatever opened it on close, a click on the
 * backdrop closes it too), generalized into a reusable primitive instead of
 * being one-off to the nav.
 *
 * Deliberately not a new dependency (no Radix Dialog): this app has exactly
 * one existing accessible-overlay pattern already; this is that pattern with
 * the nav's specific chrome swept off it. `triggerRef` is the element focus
 * should return to on close (typically the button that opened this modal);
 * without it, a keyboard user who closes the modal is dropped back at the
 * top of the document instead of where they were.
 */
export function Modal({
  open,
  onClose,
  title,
  triggerRef,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  triggerRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  className?: string;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        triggerRef?.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  // Portalled to `document.body` rather than rendered where the trigger
  // lives in the tree: `position: fixed` only escapes the DOM for LAYOUT,
  // not for paint/stacking order, which is still resolved by tree position.
  // A `position: sticky` ancestor elsewhere on the page (e.g. `PinnedColumn`)
  // has z-index:auto too, so without a portal it can end up painted (and
  // hit-tested) ABOVE this backdrop the moment it's later in the DOM than
  // wherever this modal happens to be nested — which silently broke both the
  // dimming and the click-blocking on any page with a sticky side column.
  // Rendering at `document.body`'s root sidesteps the whole ancestor chain,
  // so no future positioning change anywhere on the page can repeat this.
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-50 bg-ink opacity-[.34]"
        onClick={() => {
          onClose();
          triggerRef?.current?.focus();
        }}
      />
      <div className="fixed inset-0 z-[51] flex items-start justify-center overflow-y-auto p-18 pt-[10vh] sm:items-center sm:pt-18">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === "string" ? title : undefined}
          tabIndex={-1}
          className={cn(
            "reveal-in w-full max-w-[440px] rounded-panel border-panel border-ink bg-bg p-22",
            className
          )}
        >
          <div className="mb-18 flex items-center justify-between gap-14">
            <SectionLabel>{title}</SectionLabel>
            <button
              type="button"
              onClick={() => {
                onClose();
                triggerRef?.current?.focus();
              }}
              className="grid h-32 w-32 flex-none place-items-center rounded-pill border-panel border-ink bg-transparent text-ink transition-colors duration-hover ease-out hover:bg-ink-wash"
            >
              <Icon name="close" size={15} title="Close" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </>,
    document.body
  );
}

/** A right-aligned mono figure with its label above: the panel summary strip. */
export function Readout({
  label,
  value,
  sub,
  className,
}: {
  label: React.ReactNode;
  value: number | string;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <span className="block font-num text-micro uppercase tracking-micro text-dim">{label}</span>
      <span className="money mt-4 block text-h3">
        {typeof value === "number" ? formatInr(value) : value}
      </span>
      {sub ? (
        <span className="mt-2 block font-num text-micro uppercase tracking-micro text-dim">
          {sub}
        </span>
      ) : null}
    </div>
  );
}
