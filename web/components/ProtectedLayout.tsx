"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { BUCKETS, BUCKET_META } from "@/lib/buckets";
import { Icon, type IconName } from "@/components/app/icons";
import { Notice, Skeleton } from "@/components/app/primitives";

/**
 * Sorted · the application shell
 *
 * THE RAIL. Nine routes, nine ink-stroke glyphs drawn in the chip's circular
 * form with NO fill — because a route is not a category, and the fills belong
 * to the taxonomy. Underneath them the four bucket chips sit as a permanent
 * legend: the colour language stated once, as furniture.
 *
 * It gets NO entrance animation, in either place. This is a screen its owner
 * opens every single morning; furniture that re-introduces itself daily is an
 * irritation, not a delight.
 *
 * MOBILE. The sidebar becomes a left Sheet, not a bottom tab bar — nine routes
 * do not survive five slots, and a "More" overflow is where the tax screen goes
 * to die.
 */

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Overview", icon: "overview" },
  { href: "/transactions", label: "Transactions", icon: "transactions" },
  { href: "/accounts", label: "Accounts", icon: "accounts" },
  { href: "/budgets", label: "Budgets", icon: "budgets" },
  { href: "/recurring", label: "Recurring", icon: "recurring" },
  { href: "/investments", label: "Investments", icon: "investments" },
  { href: "/goals", label: "Goals", icon: "goals" },
  { href: "/tax", label: "Tax", icon: "tax" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

function NavRow({
  href,
  label,
  icon,
  current,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: IconName;
  current: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "grid grid-cols-[30px_1fr] items-center gap-12 rounded-pill py-6 pl-6 pr-12",
        "text-body-s no-underline",
        "transition-colors duration-hover ease-out",
        current ? "bg-ink-wash font-semibold text-ink" : "text-dim-2 hover:bg-ink-wash hover:text-ink"
      )}
    >
      <span
        className={cn(
          "grid h-chip w-chip place-items-center rounded-pill border-panel",
          current ? "border-ink text-ink" : "border-transparent text-inherit"
        )}
      >
        <Icon name={icon} size={17} />
      </span>
      {label}
    </Link>
  );
}

function Rail({
  pathname,
  email,
  onNavigate,
  onSignOut,
  signingOut,
}: {
  pathname: string;
  email: string;
  onNavigate?: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  return (
    <>
      <p className="m-0 mb-26 pl-10 font-disp text-h3 leading-none tracking-disp">Sorted</p>

      <nav aria-label="Primary" className="min-h-0 overflow-y-auto">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {NAV.map((item) => (
            <li key={item.href}>
              <NavRow
                {...item}
                current={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      </nav>

      {/* The taxonomy, stated once and permanently. Not a filter, not a
          control — a legend. Four buckets is the whole colour system. */}
      <div className="mt-auto border-t border-rule pt-22">
        <span className="block font-num text-label uppercase text-dim">§ Sorted into</span>
        <ul className="m-0 mt-12 flex list-none flex-col gap-8 p-0">
          {BUCKETS.map((bucket) => {
            const meta = BUCKET_META[bucket];
            return (
              <li
                key={bucket}
                className="grid grid-cols-[22px_1fr] items-center gap-12 text-caption text-dim-2"
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid h-22 w-22 place-items-center rounded-pill border-panel border-ink text-ink",
                    meta.fill
                  )}
                >
                  <Icon name={meta.icon} size={12.5} />
                </span>
                {meta.label}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-18 border-t border-rule pt-12">
        <p className="m-0 truncate font-num text-micro uppercase tracking-micro text-dim">{email}</p>
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          className={cn(
            "mt-8 inline-flex items-center gap-8 rounded-xs bg-transparent p-0",
            "font-sans text-caption text-dim-2 underline underline-offset-[3px]",
            "transition-colors duration-hover ease-out hover:text-ink",
            "disabled:cursor-default disabled:opacity-[.55]"
          )}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </>
  );
}

export function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const queryClient = useQueryClient();

  const { data, error, isError, isLoading } = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => apiFetch<{ email: string }>("/auth/me"),
    retry: false,
  });

  const isUnauthenticated = isError && error instanceof ApiError && error.status === 401;

  useEffect(() => {
    if (isUnauthenticated) router.push("/login");
  }, [isUnauthenticated, router]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const sheetRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Close the sheet on route change — otherwise tapping a link leaves the
  // drawer sitting over the page you just navigated to.
  useEffect(() => {
    setSheetOpen(false);
  }, [pathname]);

  // Escape closes it, and focus returns to the button that opened it. Without
  // the return trip a keyboard user is dropped at the top of the document.
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSheetOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    sheetRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  const signOut = useMutation({
    mutationFn: () => apiFetch<void>("/auth/logout", { method: "POST" }),
    // Whatever the server said, the local session is over. Clearing the cache
    // matters: without it the next visitor to this browser gets one frame of
    // the previous person's net worth out of a warm query cache.
    onSettled: () => {
      queryClient.clear();
      router.replace("/login");
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen bg-bg">
        <aside className="hidden w-rail flex-none flex-col gap-14 border-r-panel border-ink p-18 lg:flex">
          <Skeleton className="h-22 w-[92px] rounded-sm" />
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-chip w-full rounded-pill opacity-40" />
          ))}
        </aside>
        <main className="flex-1 p-32">
          <Skeleton className="h-[38px] w-[220px] rounded-sm" />
        </main>
      </div>
    );
  }

  if (isError) {
    // A 401 is already redirecting; anything else (the API is down) is not a
    // reason to boot a signed-in person out to the login screen.
    if (isUnauthenticated) return null;
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg p-22">
        <Notice
          title="Something went wrong loading this page."
          body="The app could not reach the server. Please try again shortly — nothing has been lost."
        />
      </main>
    );
  }

  if (!data) return null;

  return (
    <div className="flex h-screen flex-col bg-bg text-ink lg:flex-row">
      {/* ── mobile top bar ─────────────────────────────────────────────── */}
      <header className="flex flex-none items-center justify-between gap-12 border-b-panel border-ink px-18 py-14 lg:hidden">
        <p className="m-0 font-disp text-h3 leading-none tracking-disp">Sorted</p>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-expanded={sheetOpen}
          aria-controls="app-nav-sheet"
          className="grid h-44 w-44 place-items-center rounded-pill border-panel border-ink bg-transparent text-ink transition-colors duration-hover ease-out hover:bg-ink-wash"
        >
          <Icon name="menu" size={20} title="Open navigation" />
        </button>
      </header>

      {/* ── desktop rail ───────────────────────────────────────────────── */}
      <aside className="hidden w-rail flex-none flex-col overflow-y-auto border-r-panel border-ink px-18 pb-18 pt-26 lg:flex">
        <Rail
          pathname={pathname}
          email={data.email}
          onSignOut={() => signOut.mutate()}
          signingOut={signOut.isPending}
        />
      </aside>

      {/* ── mobile sheet ───────────────────────────────────────────────── */}
      <div
        aria-hidden={!sheetOpen}
        className={cn(
          "fixed inset-0 z-40 bg-ink transition-opacity duration-drawer ease-drawer lg:hidden",
          sheetOpen ? "opacity-[.34]" : "pointer-events-none opacity-0"
        )}
        onClick={closeSheet}
      />
      <div
        id="app-nav-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal={sheetOpen || undefined}
        aria-label="Navigation"
        tabIndex={-1}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[288px] flex-col overflow-y-auto",
          "border-r-panel border-ink bg-bg px-14 pb-18 pt-18",
          "transition-transform duration-drawer ease-drawer lg:hidden",
          "motion-reduce:transition-none",
          sheetOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="mb-18 flex items-center justify-end">
          <button
            type="button"
            onClick={() => {
              closeSheet();
              menuButtonRef.current?.focus();
            }}
            className="grid h-44 w-44 place-items-center rounded-pill border-panel border-ink bg-transparent text-ink"
          >
            <Icon name="close" size={16} title="Close navigation" />
          </button>
        </div>
        <Rail
          pathname={pathname}
          email={data.email}
          onNavigate={closeSheet}
          onSignOut={() => signOut.mutate()}
          signingOut={signOut.isPending}
        />
      </div>

      {/* ── the only thing that scrolls ────────────────────────────────── */}
      <main className="min-w-0 flex-1 overflow-y-auto px-18 pb-44 pt-22 lg:px-44 lg:pt-32">
        {children}
      </main>
    </div>
  );
}
