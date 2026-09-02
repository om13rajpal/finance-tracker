"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api-client";
import type {
  Account,
  BudgetVsSpendRow,
  CategoryNode,
  DashboardData,
  Holding,
  PendingTransaction,
  RecurringItem,
} from "@/lib/api-types";
import { BUCKET_META, indexCategories, resolveChip, type Bucket } from "@/lib/buckets";
import {
  apiMonthLabel,
  currentMonthRange,
  formatInr,
  formatLongDate,
  formatSignedInr,
  formatDayMonth,
  relativeDays,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Chip, ChipSkeleton } from "@/components/app/chip";
import { CountUpInr } from "@/components/app/count-up";
import { Icon, Tether } from "@/components/app/icons";
import { Button } from "@/components/shadcn/button";
import {
  Amount,
  Bar,
  BarSkeleton,
  EmptyState,
  FigurePrimary,
  Helper,
  Notice,
  PageHeader,
  Panel,
  PanelFooter,
  PanelGrid,
  PanelHeader,
  Row,
  RowName,
  SectionLabel,
  Skeleton,
  Stat,
  StatRow,
} from "@/components/app/primitives";

/**
 * Sorted · Overview
 *
 * THE THESIS OF THIS SCREEN IS ITS HIERARCHY, and the hierarchy is inverted
 * from what a finance app normally does.
 *
 * Guilt-Free Money sits at 108px. Net Worth sits at 52px beside it, a 2.08×
 * ratio, so the eye lands on the smaller number first, every morning. That is
 * deliberate: Guilt-Free Money is the number that decides whether you order in
 * tonight, and Net Worth is the number you admire. Only one of the two is
 * actionable, and it is not the big impressive one.
 *
 * BOTH ARE INK. Chips colour categories; ink colours totals. Not one figure on
 * this screen is tinted, not one panel is filled, and the only non-chip colour
 * anywhere is the words "Over by ₹2,820" in --alert. One accent block in the
 * numeric core is the ceiling.
 */

const RECENT_DAYS = 30;

/**
 * `August 2026 · day 31 of 31`, computed on the SERVER's month.
 *
 * The API's "this month" is a UTC month. In IST that is a different month for
 * five and a half hours at every month end, so this line (which sits directly
 * under a local "today") is derived from the same UTC window the figures below
 * it are, and names the month explicitly.
 */
function monthMeta(now = new Date()): string {
  const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return `${apiMonthLabel(now)} · day ${now.getUTCDate()} of ${days}`;
}

/** Which bucket a top-level budget row belongs to, straight from the tree. */
function bucketFill(bucket: Bucket | null): string {
  return bucket ? BUCKET_META[bucket].fill : "bg-dim";
}

export default function DashboardPage() {
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<DashboardData>("/dashboard"),
  });

  const upcoming = useQuery({
    queryKey: ["recurring-upcoming", RECENT_DAYS],
    queryFn: () => apiFetch<RecurringItem[]>(`/recurring/upcoming?days=${RECENT_DAYS}`),
  });

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<CategoryNode[]>("/categories"),
  });

  // The parser's own queue. This is what the tether points at, so the dashboard
  // says so out loud rather than leaving the mark unexplained.
  const pending = useQuery({
    queryKey: ["pending-transactions"],
    queryFn: () => apiFetch<PendingTransaction[]>("/pending-transactions"),
  });

  // Net worth's composition. `GET /dashboard` returns one number; these two
  // lists are what it is made of, and they are cached under the same keys the
  // Accounts and Investments screens use, so this costs nothing on a second
  // visit.
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiFetch<Account[]>("/accounts"),
  });
  const holdings = useQuery({
    queryKey: ["holdings"],
    queryFn: () => apiFetch<Holding[]>("/holdings"),
  });

  const composition = (() => {
    const isLoading = accounts.isLoading || holdings.isLoading;
    if (isLoading || accounts.isError || holdings.isError) {
      return { isLoading, rows: [] as { label: string; value: string }[] };
    }
    const list = accounts.data ?? [];
    const cash = list
      .filter((a) => a.type !== "credit_card")
      .reduce((sum, a) => sum + a.currentBalance, 0);
    // Net worth counts a card as `Math.abs(currentBalance)` OWED, regardless of
    // the sign the balance happens to be stored with, mirror that exactly
    // rather than re-deciding it here.
    const owed = list
      .filter((a) => a.type === "credit_card")
      .reduce((sum, a) => sum + Math.abs(a.currentBalance), 0);
    // A holding with no price ever fetched falls back to its cost basis, which
    // is what computeFullNetWorth does, otherwise this breakdown would not add
    // up to the figure above it.
    const invested = (holdings.data ?? []).reduce(
      (sum, h) => sum + (h.currentValue ?? h.avgCost * h.totalUnits),
      0
    );
    const rows = [
      { label: "In accounts", value: formatInr(cash) },
      { label: "In holdings", value: formatInr(invested) },
    ];
    if (owed > 0) rows.push({ label: "Owed on cards", value: `−${formatInr(owed)}` });
    return { isLoading: false, rows };
  })();

  const index = indexCategories(categories.data);

  // Category count, for an honest footnote: how much of the tree is actually
  // budgeted. Top-level expense categories only, because that is the exact set
  // the API returns rows for.
  const topLevelExpense = (categories.data ?? []).filter((c) => c.type === "expense");
  const withLimit = topLevelExpense.filter((c) => c.budgetLimit > 0).length;

  const pendingCount = pending.data?.length ?? 0;

  return (
    <ProtectedLayout>
      <PageHeader
        title={formatLongDate(new Date())}
        meta={monthMeta()}
        actions={
          // Only once the queue is genuinely known. While it is loading or has
          // failed, "nothing waiting" is a claim the app cannot make.
          pending.isSuccess ? (
            <Link
              href="/transactions"
              className="flex items-center gap-8 rounded-xs font-num text-micro uppercase tracking-micro text-dim no-underline transition-colors duration-hover ease-out hover:text-ink"
            >
              <Tether />
              {pendingCount > 0
                ? `Inbox parser · ${pendingCount} to review`
                : "Inbox parser · nothing waiting"}
            </Link>
          ) : null
        }
      />

      {/* ── the parser's queue ───────────────────────────────────────────
          The one moment on this screen where the product's most unusual
          capability becomes visible: transactions it filed from a bank email
          by itself. It is an actionable gap, not an error, so it is a panel
          with a way forward, never a red banner. */}
      {pendingCount > 0 ? (
        <Panel className="mb-22 flex-row flex-wrap items-center justify-between gap-18">
          <div className="flex min-w-0 items-center gap-14">
            <Tether label="Filed automatically from a bank email" />
            <div className="min-w-0">
              <SectionLabel>§ From your inbox</SectionLabel>
              <p className="m-0 mt-4 text-body-s">
                {pendingCount === 1
                  ? "One transaction was read out of a bank email and is waiting for you."
                  : `${pendingCount} transactions were read out of bank emails and are waiting for you.`}
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="ghost" className="stamp">
            <Link href="/transactions">Review them</Link>
          </Button>
        </Panel>
      ) : null}

      {dashboard.isError ? (
        <Notice
          title="Could not load dashboard data."
          body="Please try again shortly. Nothing has been lost: this screen only reads."
          className="mb-22"
        />
      ) : null}

      {/* ── row 1 · the hierarchy ─────────────────────────────────────── */}
      <PanelGrid cols="wide-left" className="items-stretch">
        <Panel aria-labelledby="gf-h">
          <PanelHeader id="gf-h" title="§ Guilt-free money" meta={apiMonthLabel()} className="mb-0" />
          {/* THE UNKNOWN FIGURE IS A DASH, NEVER A ZERO.
              `?? 0` on a failed request prints "₹0 guilt-free money", a number
              the app made up, in the exact place a person decides whether they
              can afford dinner. Unknown and nothing left are opposite facts and
              they must never render as the same string. */}
          {dashboard.isLoading ? (
            <>
              <Skeleton className="mt-14 h-[78px] w-full max-w-[340px] rounded-sm" />
              <StatRow>
                <Skeleton className="h-[19px] w-[110px] rounded-sm" />
                <Skeleton className="h-[19px] w-[110px] rounded-sm" />
              </StatRow>
            </>
          ) : dashboard.data ? (
            <>
              {/* NEVER animated. This is the decision number: a count-up would
                  show a sequence of amounts you cannot actually spend. */}
              <FigurePrimary value={formatInr(dashboard.data.guiltFreeMoney.remaining)} />
              <StatRow>
                <Stat label="Planned" value={formatInr(dashboard.data.guiltFreeMoney.planned)} />
                <Stat label="Spent" value={formatInr(dashboard.data.guiltFreeMoney.spent)} />
              </StatRow>
            </>
          ) : (
            <>
              <FigurePrimary value="–" className="text-dim-2" />
              <StatRow>
                <Stat label="Planned" value="–" />
                <Stat label="Spent" value="–" />
              </StatRow>
            </>
          )}
        </Panel>

        <Panel aria-labelledby="nw-h">
          <SectionLabel id="nw-h">§ Net worth</SectionLabel>
          <div className="mt-10">
            {dashboard.isLoading ? (
              <Skeleton className="h-[38px] w-[230px] rounded-sm" />
            ) : dashboard.data ? (
              /* The sole carve-out to motion rule 12: 600ms, once per session,
                 off entirely under reduced motion. See count-up.tsx. */
              <p
                id="net-worth-figure"
                className="money m-0 text-h2 leading-[1.05] sm:text-[40px] lg:text-figure-2"
              >
                <CountUpInr value={dashboard.data.netWorth} />
              </p>
            ) : (
              <p
                id="net-worth-figure"
                className="money m-0 text-h2 leading-[1.05] text-dim-2 sm:text-[40px] lg:text-figure-2"
              >
                –
              </p>
            )}
          </div>
          {/* WHAT IT IS MADE OF.
              The API returns net worth as one number, so this panel used to be
              a figure and a sentence with a hundred and fifty pixels of nothing
              between them. The composition is derivable from two lists the app
              already loads elsewhere, and "which of these three moved?" is the
              only follow-up question this figure ever prompts. Each line is
              ink; not one of the three is tinted. */}
          <div className="mt-auto pt-22">
            {composition.isLoading ? (
              <div className="flex flex-col gap-12">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-[15px] w-full rounded-sm opacity-40" />
                ))}
              </div>
            ) : composition.rows.length > 0 ? (
              <dl className="m-0">
                {composition.rows.map((line) => (
                  <div
                    key={line.label}
                    className="flex items-baseline justify-between gap-14 border-t border-rule py-10 last:pb-0"
                  >
                    <dt className="font-num text-micro uppercase tracking-micro text-dim">
                      {line.label}
                    </dt>
                    <dd className="money m-0 text-body-s">{line.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
          <PanelFooter>Accounts plus holdings, at today&rsquo;s prices</PanelFooter>
        </Panel>
      </PanelGrid>

      {/* ── row 2 · the working modules ───────────────────────────────── */}
      <PanelGrid cols="wide-left" className="mt-22 items-start">
        <Panel aria-labelledby="bd-h">
          <PanelHeader id="bd-h" title="§ Budget vs spend" meta={currentMonthRange()} />

          {dashboard.isLoading ? (
            <div>
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="grid grid-cols-row items-center gap-x-14 gap-y-8 border-b border-rule py-12 last:border-b-0"
                >
                  <ChipSkeleton />
                  <Skeleton className="h-[15px] w-[140px] rounded-sm" />
                  <Skeleton className="h-[15px] w-[110px] rounded-sm" />
                  <BarSkeleton className="col-start-2 col-end-4" />
                </div>
              ))}
            </div>
          ) : !dashboard.data ? (
            // NOT the empty state. "No budgets set yet" on a failed request
            // tells someone their budgets are gone; the truth is only that the
            // app could not ask.
            <Helper className="py-14">
              Unavailable while the dashboard cannot be reached. Your budgets are untouched.
            </Helper>
          ) : dashboard.data.budgetVsSpend.length === 0 ? (
            <EmptyState
              title="No budgets set yet."
              body="Give a category a monthly limit and it starts showing up here, with a bar you can read at a glance."
              action={
                <Button asChild size="sm">
                  <Link href="/budgets">Set a budget</Link>
                </Button>
              }
            />
          ) : (
            <div data-stagger>
              {dashboard.data.budgetVsSpend.map((row, i) => (
                <BudgetRow
                  key={row.categoryId}
                  row={row}
                  index={i}
                  bucket={index.get(row.categoryId)?.bucket ?? null}
                />
              ))}
            </div>
          )}

          {!dashboard.isLoading && topLevelExpense.length > 0 ? (
            <PanelFooter>
              {withLimit} of {topLevelExpense.length}{" "}
              {topLevelExpense.length === 1 ? "category has" : "categories have"} a limit
            </PanelFooter>
          ) : null}
        </Panel>

        <Panel aria-labelledby="up-h">
          <PanelHeader id="up-h" title="§ Upcoming" meta={`Next ${RECENT_DAYS} days`} />

          {upcoming.isLoading ? (
            <div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="grid grid-cols-row items-center gap-x-14 border-b border-rule py-10 last:border-b-0"
                >
                  <ChipSkeleton />
                  <Skeleton className="h-[15px] w-[150px] rounded-sm" />
                  <Skeleton className="h-[15px] w-[80px] rounded-sm" />
                </div>
              ))}
            </div>
          ) : upcoming.isError ? (
            <Notice
              title="Could not load what&rsquo;s coming up."
              body="The rest of this screen is unaffected."
            />
          ) : (upcoming.data?.length ?? 0) === 0 ? (
            <EmptyState
              title="Nothing due in the next 30 days."
              body="Rent, SIPs and subscriptions show up here once you add them as recurring items."
              action={
                <Button asChild size="sm" variant="ghost">
                  <Link href="/recurring">Add a recurring item</Link>
                </Button>
              }
            />
          ) : (
            <div data-stagger>
              {(upcoming.data ?? []).map((item, i) => {
                const spec = resolveChip(item.categoryId, index, {
                  direction: item.type === "income" ? "income" : "expense",
                });
                const signed = item.type === "income" ? Math.abs(item.amount) : -Math.abs(item.amount);
                return (
                  <Row key={item._id} className="row-stagger py-10" style={{ ["--i" as string]: i }}>
                    <Chip spec={spec} labelled />
                    <RowName
                      name={item.name}
                      sub={`${formatDayMonth(item.nextDueDate)} · ${relativeDays(item.nextDueDate)}`}
                    />
                    <Amount>{formatSignedInr(signed)}</Amount>
                  </Row>
                );
              })}
            </div>
          )}

          {!upcoming.isLoading && (upcoming.data?.length ?? 0) > 0 ? (
            <PanelFooter>
              <Icon name="recurring" size={13} />
              Active recurring items only
            </PanelFooter>
          ) : null}
        </Panel>
      </PanelGrid>

      {categories.isError ? (
        <Helper className="mt-22">
          Categories could not be loaded, so budget rows are showing without their bucket colour. The
          amounts above are unaffected.
        </Helper>
      ) : null}
    </ProtectedLayout>
  );
}

/**
 * One budget row.
 *
 * OVER BUDGET is the one row on this screen you feel something about, and the
 * one where the bar stops being the whole story: the fill is clamped at 100%
 * so it physically cannot say how far past the line you went. Three signals
 * carry it instead: the fill runs to 100%, it hits a 7px ink wall inside the
 * clipped track, and the overage is named in words. The total itself stays ink.
 */
function BudgetRow({
  row,
  bucket,
  index,
}: {
  row: BudgetVsSpendRow;
  bucket: Bucket | null;
  index: number;
}) {
  const hasLimit = row.budgetLimit > 0;
  const pct = hasLimit ? Math.min(100, (row.spent / row.budgetLimit) * 100) : 0;
  const over = hasLimit && row.spent > row.budgetLimit;
  const overBy = over ? row.spent - row.budgetLimit : 0;

  return (
    <Row className="row-stagger" style={{ ["--i" as string]: index }}>
      <Chip
        spec={bucket ? { kind: "bucket", bucket } : { kind: "uncategorised" }}
        labelled
      />
      <RowName name={row.name} />
      <span className="flex items-baseline gap-14 whitespace-nowrap">
        {over ? (
          <span className="font-num text-micro uppercase tracking-micro text-alert">
            Over by {formatInr(overBy)}
          </span>
        ) : null}
        <Amount>
          {formatInr(row.spent)}{" "}
          <span className={cn(hasLimit ? "text-dim-2" : "text-dim")}>
            {hasLimit ? `/ ${formatInr(row.budgetLimit)}` : "· no limit"}
          </span>
        </Amount>
      </span>
      {hasLimit ? (
        <Bar
          className="col-start-2 col-end-4"
          percent={pct}
          fill={bucketFill(bucket)}
          over={over}
          label={`${row.name}: ${formatInr(row.spent)} spent of a ${formatInr(
            row.budgetLimit
          )} limit${over ? `, over by ${formatInr(overBy)}` : ""}`}
        />
      ) : null}
    </Row>
  );
}
