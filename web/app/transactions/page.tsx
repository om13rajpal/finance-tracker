"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,

} from "@tanstack/react-query";

import { API_BASE, ApiError, apiFetch } from "@/lib/api-client";
import type {
  Account,
  BulkConfirmBatchResult,
  BulkConfirmEnqueuedResult,
  CategorizationSuggestion,
  CategoryNode,
  ImportBatchResult,
  ImportPdfEnqueuedResult,
  PendingTransaction,
  Transaction,
  TransactionsPage as TransactionsPageData,
} from "@/lib/api-types";
import {
  categoryRowName,
  flattenCategories,
  indexCategories,
  resolveChip,
  type CategoryIndex,
} from "@/lib/buckets";
import { formatDate, formatSignedInr, todayInputValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Chip, ChipSkeleton } from "@/components/app/chip";
import { Icon, Tether } from "@/components/app/icons";
import {
  Checkbox,
  Field,
  FieldGrid,
  FormActions,
  MoneyInput,
  DateInput,
  Select,
} from "@/components/app/form";
import {
  Amount,
  EmptyState,
  Helper,
  Modal,
  Notice,
  PageHeader,
  Panel,
  PanelFooter,
  PanelHeader,
  PinnedColumn,
  RowName,
  SectionLabel,
  Skeleton,
} from "@/components/app/primitives";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import { useToast } from "@/components/ui/Toast";

/**
 * Sorted · Transactions
 *
 * The list vocabulary at scale, and the true home of THE TETHER: a row the
 * Gmail parser filed by itself carries the dotted lead-in in its own 22px
 * gutter. An untethered row leaves that gutter EMPTY rather than shifting left,
 * so the chip column never wavers as the eye runs down a hundred rows.
 *
 * CHIPS NEVER GUESS, and this is the screen where that rule earns its keep.
 * `Transaction.categoryId` is nullable and an uncategorised transaction is the
 * parser's NORMAL output, not a failure, so those rows get a dashed hollow
 * chip and their category slot becomes a "Categorise" action. An actionable
 * gap, never --alert.
 */

const PAGE_SIZE = 25;

interface Filters {
  accountId: string;
  categoryId: string;
  dateFrom: string;
  dateTo: string;
  q: string;
}

const NO_FILTERS: Filters = { accountId: "", categoryId: "", dateFrom: "", dateTo: "", q: "" };

function buildQuery(filters: Filters, cursor?: string): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  // dateTo is compared with `$lte` against a Date, so a bare `2026-08-31`
  // parses as midnight UTC and silently excludes everything that happened that
  // day. Push it to the end of the day the person actually meant.
  if (filters.dateTo) params.set("dateTo", `${filters.dateTo}T23:59:59.999Z`);
  if (filters.q) params.set("q", filters.q);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export default function TransactionsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiFetch<Account[]>("/accounts"),
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<CategoryNode[]>("/categories"),
  });
  const pending = useQuery({
    queryKey: ["pending-transactions"],
    queryFn: () => apiFetch<PendingTransaction[]>("/pending-transactions"),
  });
  const categorizationSuggestions = useQuery({
    queryKey: ["categorization-suggestions"],
    queryFn: () => apiFetch<CategorizationSuggestion[]>("/categorization-rules/suggestions"),
  });

  const index = useMemo(() => indexCategories(categories.data), [categories.data]);
  const flatCategories = useMemo(() => flattenCategories(categories.data), [categories.data]);
  const accountName = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts.data ?? []) map.set(a._id, a.nickname);
    return map;
  }, [accounts.data]);

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const filtersActive = activeFilterCount > 0;

  const history = useInfiniteQuery({
    queryKey: ["transactions", filters],
    queryFn: ({ pageParam }) =>
      apiFetch<TransactionsPageData>(`/transactions?${buildQuery(filters, pageParam)}`),
    initialPageParam: undefined as string | undefined,
    // The API returns `nextCursor: null` on the last page. TanStack treats
    // `undefined` as "no more pages" but a returned `null` as a real page param,
    // which re-requests page one forever. Coercing here is what makes
    // `hasNextPage` correctly go false.
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const rows = history.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <ProtectedLayout>
      <PageHeader
        title="Transactions"
        meta={
          rows.length > 0
            ? `${rows.length} loaded${history.hasNextPage ? " · more available" : ""}`
            : undefined
        }
      />

      <div className="grid items-start gap-22 xl:grid-cols-[7fr_5fr]">
        <div className="flex min-w-0 flex-col gap-22">
          {(categorizationSuggestions.data?.length ?? 0) > 0 ? (
            <CategorizationSuggestionsPanel
              suggestions={categorizationSuggestions.data ?? []}
              categories={flatCategories}
              index={index}
            />
          ) : null}

          {(pending.data?.length ?? 0) > 0 ? (
            <PendingPanel
              items={pending.data ?? []}
              accounts={accounts.data ?? []}
              index={index}
            />
          ) : null}

          <Panel>
            {/* The filter bar is COLLAPSED by default. Open, it is four fields
                and 180px of chrome standing between the person and the list
                they came here to read, and on the overwhelming majority of
                visits every one of those fields is empty. It announces itself
                when it is doing something. */}
            <div className="mb-14 flex items-baseline justify-between gap-14">
              <SectionLabel>§ History</SectionLabel>
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                aria-expanded={filtersOpen}
                aria-controls="tx-filters"
                className="flex items-center gap-8 rounded-xs bg-transparent p-0 font-num text-label uppercase text-dim transition-colors duration-hover ease-out hover:text-ink"
              >
                <Icon name="filter" size={13} />
                {filtersActive ? `Filtered · ${activeFilterCount}` : "Filter"}
              </button>
            </div>

            {filtersOpen || filtersActive ? (
              <FilterBar
                id="tx-filters"
                filters={filters}
                onChange={setFilters}
                accounts={accounts.data ?? []}
                categories={flatCategories}
              />
            ) : null}

            {history.isLoading ? (
              <div className="mt-14">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-row-tether items-center border-b border-rule py-10 last:border-b-0"
                  >
                    <span />
                    <ChipSkeleton />
                    <Skeleton className="h-[15px] w-[180px] rounded-sm" />
                    <Skeleton className="h-[15px] w-[90px] rounded-sm" />
                  </div>
                ))}
              </div>
            ) : history.isError ? (
              <Notice
                title="Could not load transactions."
                body="Please try again shortly. Nothing has been lost."
                className="mt-14"
              />
            ) : rows.length === 0 ? (
              <EmptyState
                title={filtersActive ? "Nothing matches those filters." : "No transactions yet."}
                body={
                  filtersActive
                    ? "Widen the date range, or clear the filters to see everything again."
                    : "Add one on the right, import a statement, or connect Gmail and let the parser file them for you."
                }
                action={
                  filtersActive ? (
                    <Button size="sm" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="reveal-in mt-14" data-stagger>
                {rows.map((t, i) => (
                  <TransactionRow
                    key={t._id}
                    transaction={t}
                    index={index}
                    accountName={accountName}
                    categories={flatCategories}
                    staggerIndex={i}
                  />
                ))}
              </div>
            )}

            {history.hasNextPage ? (
              <div className="mt-18 flex justify-center">
                <Button
                  size="sm"
                  variant="ghost"
                  busy={history.isFetchingNextPage}
                  onClick={() => history.fetchNextPage()}
                >
                  {history.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : rows.length > 0 ? (
              <PanelFooter>
                <Tether />
                Filed automatically from a bank email
              </PanelFooter>
            ) : null}
          </Panel>
        </div>

        <PinnedColumn className="flex min-w-0 flex-col gap-22">
          <AddTransactionPanel
            accounts={accounts.data ?? []}
            categories={flatCategories}
            onDone={() => {
              queryClient.invalidateQueries({ queryKey: ["transactions"] });
              queryClient.invalidateQueries({ queryKey: ["dashboard"] });
            }}
            showToast={showToast}
          />
          <ImportPanel accounts={accounts.data ?? []} showToast={showToast} />
        </PinnedColumn>
      </div>
    </ProtectedLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Filters
// ═══════════════════════════════════════════════════════════════════════════

function FilterBar({
  id,
  filters,
  onChange,
  accounts,
  categories,
}: {
  id: string;
  filters: Filters;
  onChange: (f: Filters) => void;
  accounts: Account[];
  categories: { node: CategoryNode; depth: number }[];
}) {
  const active = Object.values(filters).some(Boolean);

  // Debounced locally so typing doesn't fire a request (and reset pagination)
  // on every keystroke. Mirrors `filters.q` back in when it changes from
  // outside this input (e.g. "Clear filters").
  const [searchInput, setSearchInput] = useState(filters.q);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    setSearchInput(filters.q);
  }, [filters.q]);

  useEffect(() => {
    if (searchInput === filtersRef.current.q) return;
    const timer = setTimeout(() => {
      onChange({ ...filtersRef.current, q: searchInput });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, onChange]);

  return (
    <div id={id} className="mb-4 flex flex-col gap-12 border-b border-rule pb-18">
      <Field id="filter-q" label="Search">
        <Input
          id="filter-q"
          placeholder="Merchant or note"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </Field>
      <div className="grid gap-12 sm:grid-cols-2">
        <Field id="filter-account" label="Account">
          <Select
            id="filter-account"
            value={filters.accountId}
            onChange={(e) => onChange({ ...filters, accountId: e.target.value })}
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a._id} value={a._id}>
                {a.institution} · {a.nickname}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="filter-category" label="Category">
          <Select
            id="filter-category"
            value={filters.categoryId}
            onChange={(e) => onChange({ ...filters, categoryId: e.target.value })}
          >
            <option value="">All categories</option>
            {categories.map(({ node, depth }) => (
              <option key={node._id} value={node._id}>
                {"– ".repeat(depth)}
                {node.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="filter-from" label="From">
          <DateInput
            id="filter-from"
            value={filters.dateFrom}
            max={filters.dateTo || undefined}
            onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
          />
        </Field>
        <Field id="filter-to" label="To">
          <DateInput
            id="filter-to"
            value={filters.dateTo}
            min={filters.dateFrom || undefined}
            onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
          />
        </Field>
      </div>
      {active ? (
        <button
          type="button"
          onClick={() => onChange(NO_FILTERS)}
          className="self-start rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-ink"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// One row
// ═══════════════════════════════════════════════════════════════════════════

function TransactionRow({
  transaction,
  index,
  accountName,
  categories,
  staggerIndex,
}: {
  transaction: Transaction;
  index: CategoryIndex;
  accountName: Map<string, string>;
  categories: { node: CategoryNode; depth: number }[];
  /** Row-entrance stagger delay, in list position. Omitted where a row
   * renders outside a `data-stagger` list (there is none today, but the prop
   * stays optional rather than required so a future standalone usage doesn't
   * have to invent a fake index). */
  staggerIndex?: number;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState(transaction.categoryId ?? "");
  const [makeRule, setMakeRule] = useState(false);
  // Prefilled with the transaction's own merchant text, but EDITABLE: a rule
  // built from a parser-produced merchant string verbatim (an order id, a
  // reference number, anything instance-specific baked into the text) only
  // ever matches that one transaction again, since matching is a plain
  // substring check with no fuzziness. Narrowing this to just the merchant
  // name (e.g. "Swiggy" out of "Swiggy Order #48291 Ref/ABC123") is what
  // makes the rule actually apply to the NEXT one, which is the whole point.
  const [matchValue, setMatchValue] = useState(transaction.merchant ?? "");
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState<"monthly" | "weekly" | "yearly" | "custom">("monthly");
  const [recurringNextDueDate, setRecurringNextDueDate] = useState(todayInputValue());
  const categorizeButtonRef = useRef<HTMLButtonElement>(null);

  const entry = transaction.categoryId ? index.get(transaction.categoryId) : undefined;
  // NO DIRECTION FALLBACK HERE, deliberately.
  //
  // A `Transaction` with a null categoryId is UNCATEGORISED, and that is the
  // state the dashed hollow chip exists for: an actionable gap the parser
  // produces every day. Falling back to a direction arrow made those rows look
  // exactly like a resolved row and quietly removed the only signal that
  // something needs filing. Direction is already carried by the sign on the
  // amount, three columns to the right.
  //
  // The fallback is right for a RecurringItem, which always has a category and
  // also has its own `type` field to fall back to; it is wrong here.
  const spec = resolveChip(transaction.categoryId, index);
  const filedByParser = transaction.source === "email_parsed";

  const trimmedMatchValue = matchValue.trim();

  const update = useMutation({
    mutationFn: () =>
      apiFetch(`/transactions/${transaction._id}`, {
        method: "PATCH",
        // `createRule`/`matchValue` and `createRecurring`/`recurringFrequency`/
        // `recurringNextDueDate` are only honoured together with a categoryId;
        // sending them as false/empty otherwise would be noise the server has
        // to ignore. `matchValue` is whatever the person edited it down to
        // above, never the raw, un-narrowed `transaction.merchant`.
        body: JSON.stringify({
          categoryId: choice,
          ...(makeRule && trimmedMatchValue ? { createRule: true, matchValue: trimmedMatchValue } : {}),
          ...(makeRecurring && recurringNextDueDate
            ? { createRecurring: true, recurringFrequency, recurringNextDueDate }
            : {}),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (makeRule) queryClient.invalidateQueries({ queryKey: ["categorization-rules"] });
      if (makeRecurring) {
        queryClient.invalidateQueries({ queryKey: ["recurring"] });
        queryClient.invalidateQueries({ queryKey: ["recurring-upcoming"] });
        queryClient.invalidateQueries({ queryKey: ["recurring-suggestions"] });
      }
      setEditing(false);
      showToast(makeRecurring ? "Category updated, marked as recurring" : "Category updated", "success");
    },
    onError: () => showToast("Could not update the category", "error"),
  });

  const remove = useMutation({
    mutationFn: () => apiFetch<void>(`/transactions/${transaction._id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      showToast("Transaction deleted", "success");
    },
    onError: () => showToast("Could not delete that transaction", "error"),
  });

  const title = transaction.merchant || transaction.note || "Untitled";
  const categoryName = entry ? categoryRowName(entry, index) : null;

  // `note` carries the original raw bank narration whenever `merchant` was
  // cleaned up from it (see `cleanMerchantLabel`'s doc comment), never
  // discarded, just not what's shown by default. When the two differ,
  // there's something worth surfacing on demand: a native `title` tooltip
  // for hover, and a tap-to-toast fallback for touch, where hover doesn't
  // exist. Both point at the exact same raw text; neither replaces the
  // clean name as this row's primary label.
  const rawNarration =
    transaction.note && transaction.merchant && transaction.note !== transaction.merchant ? transaction.note : null;
  const nameNode = rawNarration ? (
    <button
      type="button"
      title={rawNarration}
      onClick={() => showToast(rawNarration)}
      className="block w-full truncate bg-transparent p-0 text-left text-body-s text-inherit underline decoration-dim decoration-dotted underline-offset-4"
    >
      {title}
    </button>
  ) : (
    title
  );

  return (
    <div
      className={cn("border-b border-rule last:border-b-0", staggerIndex !== undefined && "row-stagger")}
      style={staggerIndex !== undefined ? { ["--i" as string]: staggerIndex } : undefined}
    >
      <div className="grid grid-cols-row-tether items-center py-10">
        {/* The 22px provenance gutter. Empty on a row you typed yourself. */}
        <span className="flex justify-start">
          {filedByParser ? <Tether label="Filed automatically from a bank email" /> : null}
        </span>
        <Chip spec={spec} labelled />
        <RowName
          name={nameNode}
          sub={
            <>
              {formatDate(transaction.date)}
              {accountName.get(transaction.accountId)
                ? ` · ${accountName.get(transaction.accountId)}`
                : ""}
              {" · "}
              {/* THE CATEGORY SLOT IS THE ACTION.
                  Not a trailing "Change" link after the amount: that put a
                  variable-width control in the amount column and every figure
                  in the ledger stopped ending at the same x, which is the one
                  thing a right-aligned money column is for. The category is
                  what you are changing, so the category is what you click. */}
              <button
                ref={categorizeButtonRef}
                type="button"
                onClick={() => {
                  setChoice(transaction.categoryId ?? "");
                  setMatchValue(transaction.merchant ?? "");
                  setMakeRule(false);
                  setMakeRecurring(false);
                  setRecurringFrequency("monthly");
                  setRecurringNextDueDate(todayInputValue());
                  setEditing(true);
                }}
                aria-haspopup="dialog"
                className={cn(
                  "rounded-xs bg-transparent p-0 font-num text-micro uppercase tracking-micro",
                  "underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-ink",
                  categoryName ? "text-dim" : "text-ink"
                )}
              >
                {categoryName ?? "Categorise"}
              </button>
            </>
          }
        />
        <Amount>{formatSignedInr(transaction.amount)}</Amount>
      </div>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        triggerRef={categorizeButtonRef}
        title={`§ Categorise ${title}`}
      >
        <div className="flex flex-col gap-12">
          <Field id={`tx-cat-${transaction._id}`} label="Category">
            <Select
              id={`tx-cat-${transaction._id}`}
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
            >
              <option value="">Select a category</option>
              {categories.map(({ node, depth }) => (
                <option key={node._id} value={node._id}>
                  {"– ".repeat(depth)}
                  {node.name}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox
            id={`tx-rule-${transaction._id}`}
            label="Always file here"
            helper={
              transaction.merchant
                ? "Creates a rule, so the next matching transaction is categorised before you see it."
                : "Only available on a row that has a merchant to match on."
            }
            checked={makeRule}
            disabled={!transaction.merchant}
            onChange={(e) => setMakeRule(e.target.checked)}
          />
          {makeRule ? (
            <Field
              id={`tx-rule-match-${transaction._id}`}
              label="Match transactions whose merchant contains"
              helper={
                // Reflecting the exact case-insensitive substring rule the
                // server applies (`categorization.engine.ts`), not vague
                // reassurance: this text is what decides whether the
                // rule turns out broad enough to actually catch anything.
                "Case-insensitive, anywhere in the merchant text. Narrower than the full line above catches more future transactions: a whole parsed line rarely repeats verbatim, just the merchant name usually does."
              }
              className="ml-[34px]"
            >
              <Input
                id={`tx-rule-match-${transaction._id}`}
                value={matchValue}
                onChange={(e) => setMatchValue(e.target.value)}
              />
            </Field>
          ) : null}
          <Checkbox
            id={`tx-recurring-${transaction._id}`}
            label="Also mark as recurring"
            helper={
              choice
                ? "Tracks this as a repeating commitment, filed into the category above."
                : "Choose a category above first: a recurring item needs one."
            }
            checked={makeRecurring}
            disabled={!choice}
            onChange={(e) => setMakeRecurring(e.target.checked)}
          />
          {makeRecurring ? (
            <FieldGrid className="ml-[34px]">
              <Field id={`tx-recurring-frequency-${transaction._id}`} label="Repeats">
                <Select
                  id={`tx-recurring-frequency-${transaction._id}`}
                  value={recurringFrequency}
                  onChange={(e) => setRecurringFrequency(e.target.value as typeof recurringFrequency)}
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="yearly">Yearly</option>
                  <option value="custom">Custom</option>
                </Select>
              </Field>
              <Field id={`tx-recurring-due-${transaction._id}`} label="Next due">
                <DateInput
                  id={`tx-recurring-due-${transaction._id}`}
                  value={recurringNextDueDate}
                  onChange={(e) => setRecurringNextDueDate(e.target.value)}
                />
              </Field>
            </FieldGrid>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-12">
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Delete "${title}"? This cannot be undone.`)) remove.mutate();
              }}
              disabled={remove.isPending}
              className="rounded-xs bg-transparent p-0 font-sans text-caption text-alert underline underline-offset-[3px] disabled:opacity-[.55]"
            >
              Delete this transaction
            </button>
            <Button
              size="sm"
              busy={update.isPending}
              disabled={!choice || (makeRule && !trimmedMatchValue) || (makeRecurring && !recurringNextDueDate)}
              onClick={() => update.mutate()}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Suggested rules: a merchant that keeps showing up uncategorized
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Categorization here has always been 100% reactive: a rule only ever
 * applies going forward, to whatever gets confirmed or imported AFTER it's
 * created (see `categorization.engine.ts`). Nothing used to notice when the
 * SAME merchant kept landing uncategorized over and over, which is exactly
 * the pattern a rule exists to solve. `GET /categorization-rules/suggestions`
 * finds those merchants; accepting one here creates the rule AND applies it
 * to exactly the items that prompted the suggestion (`applyToPendingIds` /
 * `applyToTransactionIds`), a deliberate, visible, one-time action, not a
 * silent retroactive sweep over everything else that merchant ever touched.
 */
function CategorizationSuggestionsPanel({
  suggestions,
  categories,
  index,
}: {
  suggestions: CategorizationSuggestion[];
  categories: { node: CategoryNode; depth: number }[];
  index: CategoryIndex;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [chosenCategory, setChosenCategory] = useState<Record<string, string>>({});

  const accept = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch("/categorization-rules", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (_data, payload) => {
      queryClient.invalidateQueries({ queryKey: ["categorization-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["categorization-rules"] });
      queryClient.invalidateQueries({ queryKey: ["pending-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      const count =
        ((payload as { applyToPendingIds?: string[] }).applyToPendingIds?.length ?? 0) +
        ((payload as { applyToTransactionIds?: string[] }).applyToTransactionIds?.length ?? 0);
      showToast(`Categorized ${count} and saved the rule for next time`, "success");
    },
    onError: () => showToast("Could not save that rule", "error"),
  });

  const visible = suggestions.filter((s) => !dismissed.has(s.key));
  if (visible.length === 0) return null;

  return (
    <Panel>
      <PanelHeader title="§ Keeps showing up uncategorised" meta={`${visible.length}`} />
      {visible.map((s) => {
        const categoryId = chosenCategory[s.key] ?? "";
        const spec = resolveChip(categoryId || null, index);
        return (
          <div
            key={s.key}
            className="flex flex-wrap items-center gap-14 border-b border-rule py-12 last:border-b-0"
          >
            <div className="grid min-w-[240px] flex-1 grid-cols-row items-center gap-14">
              <Chip spec={spec} labelled />
              <RowName name={s.merchant} sub={`${s.count} transactions, uncategorised`} />
            </div>
            <div className="flex flex-none items-center gap-8">
              <Select
                id={`cat-suggest-${s.key}`}
                aria-label={`Category for ${s.merchant}`}
                value={categoryId}
                onChange={(e) => setChosenCategory({ ...chosenCategory, [s.key]: e.target.value })}
                className="w-[160px]"
              >
                <option value="">Category…</option>
                {categories.map(({ node, depth }) => (
                  <option key={node._id} value={node._id}>
                    {"– ".repeat(depth)}
                    {node.name}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="ghost"
                disabled={!categoryId}
                busy={accept.isPending}
                onClick={() =>
                  accept.mutate({
                    matchField: "merchant",
                    matchType: "contains",
                    matchValue: s.merchant,
                    categoryId,
                    applyToPendingIds: s.pendingIds,
                    applyToTransactionIds: s.transactionIds,
                  })
                }
              >
                Categorize all {s.count}
              </Button>
              <button
                type="button"
                onClick={() => setDismissed(new Set([...dismissed, s.key]))}
                className="rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-ink"
              >
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
      <PanelFooter>Also saves a rule, so future ones from the same merchant are filed already categorised.</PanelFooter>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// The parser's queue
// ═══════════════════════════════════════════════════════════════════════════

function PendingPanel({
  items,
  accounts,
  index,
}: {
  items: PendingTransaction[];
  accounts: Account[];
  index: CategoryIndex;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [accountChoice, setAccountChoice] = useState<Record<string, string>>({});
  // Selection lives outside `items` on purpose: a bulk action's own success
  // handler clears it explicitly (see below), and a row that disappears from
  // `items` on its own (e.g. someone else's tab confirmed it, or the list
  // just refetched) should silently drop out of a stale selection rather
  // than keep counting toward "N selected" for a row that no longer exists.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedItems = items.filter((item) => selected.has(item._id));
  const allSelected = items.length > 0 && selectedItems.length === items.length;
  // Rendered count, independent of `selected`: a queue that's grown past a
  // couple hundred rows (a real, hit-in-production shape, not a hypothetical)
  // used to render every single one at once, turning this panel into most of
  // the scroll on the page. "Select all" and every bulk action still operate
  // on the full `items` array regardless of how many rows are actually
  // painted, so collapsing the view never limits what a bulk action reaches.
  const PAGE_SIZE = 25;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visibleItems = items.slice(0, visibleCount);
  // What the LAST bulk-file left unresolved, and why: surfaced as a banner
  // that stays put until dismissed or acted on, not a toast that's gone in a
  // few seconds. Skipped rows already stay selected (see `bulkConfirm` below)
  // so they're visibly picked out, but a checked checkbox alone doesn't say
  // WHY one row didn't file while five others next to it did. Without this,
  // that reads as "some just never get filed" instead of "these specific
  // ones need one more thing from you."
  const [bulkSkipNotice, setBulkSkipNotice] = useState<{ needsAccount: number; duplicates: number } | null>(
    null
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["pending-transactions"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item._id)));
  }

  const confirm = useMutation({
    mutationFn: ({ id, accountId, force }: { id: string; accountId?: string; force?: boolean }) =>
      apiFetch(`/pending-transactions/${id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ ...(accountId ? { accountId } : {}), ...(force ? { force: true } : {}) }),
      }),
    onSuccess: () => {
      invalidate();
      // Confirming one individually is exactly how someone resolves a row a
      // bulk-file skipped: once they've done that for at least one, the
      // banner's already-somewhat-stale count shouldn't keep sitting there.
      setBulkSkipNotice(null);
      showToast("Filed", "success");
    },
    onError: (err) => {
      // 409 is the cross-source duplicate guard, not a failure: the parser has
      // very likely re-read an email for something already imported by CSV.
      if (err instanceof ApiError && err.status === 409) {
        showToast("That looks like a duplicate of one you already have, so it was not added.");
        return;
      }
      showToast("Could not file that one", "error");
    },
  });

  const reject = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/pending-transactions/${id}/reject`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      showToast("Discarded", "success");
    },
    onError: () => showToast("Could not discard that one", "error"),
  });

  const bulkReject = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<{ deletedCount: number }>("/pending-transactions/bulk-reject", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: (result) => {
      invalidate();
      setSelected(new Set());
      setBulkSkipNotice(null);
      showToast(`Discarded ${result.deletedCount}`, "success");
    },
    onError: () => showToast("Could not discard those", "error"),
  });

  // Filing a large batch (a full statement's worth of pending rows, seen in
  // production at 117 items) is several sequential DB round trips PER item,
  // and used to run entirely inline in this one request: at scale that
  // reliably exceeded the production request-timeout path and came back as a
  // raw 502 with no feedback at all, even though the work kept running
  // server-side and mostly succeeded. The route now just enqueues a batch
  // and returns its id immediately; `bulkConfirmBatchQuery` below polls it
  // until it's actually done, the same pattern `ImportPanel`'s PDF-statement
  // upload already uses.
  const [bulkConfirmBatchId, setBulkConfirmBatchId] = useState<string | null>(null);

  const bulkConfirm = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<BulkConfirmEnqueuedResult>("/pending-transactions/bulk-confirm", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: (result) => setBulkConfirmBatchId(result.batchId),
    onError: () => showToast("Could not file those", "error"),
  });

  const bulkConfirmBatchQuery = useQuery({
    queryKey: ["bulk-confirm-batch", bulkConfirmBatchId],
    queryFn: () => apiFetch<BulkConfirmBatchResult>(`/pending-transactions/bulk-confirm/${bulkConfirmBatchId}`),
    enabled: bulkConfirmBatchId !== null,
    refetchInterval: (query) => (query.state.data?.status === "processing" ? 1000 : false),
  });

  const bulkConfirmBatch = bulkConfirmBatchQuery.data;
  const bulkConfirmProcessing = bulkConfirmBatchId !== null && (!bulkConfirmBatch || bulkConfirmBatch.status === "processing");

  // Runs once, the moment a batch actually finishes: everything the old
  // synchronous mutation's own onSuccess used to do inline, now driven off
  // the poll instead of the enqueue response.
  const notifiedBulkConfirmBatchId = useRef<string | null>(null);
  useEffect(() => {
    if (!bulkConfirmBatch || bulkConfirmBatch.status === "processing") return;
    if (notifiedBulkConfirmBatchId.current === bulkConfirmBatch._id) return;
    notifiedBulkConfirmBatchId.current = bulkConfirmBatch._id;

    if (bulkConfirmBatch.status === "failed") {
      showToast(bulkConfirmBatch.error || "Could not file those", "error");
      return;
    }

    invalidate();
    const skipped = bulkConfirmBatch.results.filter((r) => r.status === "skipped");
    const confirmedCount = bulkConfirmBatch.results.length - skipped.length;

    // Only the rows that actually got filed leave the selection: anything
    // skipped (needs an account, looked like a duplicate) stays selected
    // so it's still visibly picked out once the list re-renders with just
    // that leftover handful, ready for the person to resolve individually.
    setSelected(new Set(skipped.map((s) => s.id)));

    if (skipped.length === 0) {
      setBulkSkipNotice(null);
      showToast(`Filed ${confirmedCount}`, "success");
      return;
    }
    // A toast alone said this and then vanished. The banner below stays
    // until the person dismisses it or fixes what it's pointing at, which
    // is what actually answers "why didn't this one file."
    setBulkSkipNotice({
      needsAccount: skipped.filter((s) => s.reason === "account_required").length,
      duplicates: skipped.filter((s) => s.reason === "possible_duplicate").length,
    });
    showToast(
      confirmedCount > 0
        ? `Filed ${confirmedCount}, ${skipped.length} still need${skipped.length === 1 ? "s" : ""} attention`
        : `${skipped.length} still need${skipped.length === 1 ? "s" : ""} attention before they can be filed`
    );
    // `invalidate`/`showToast` are recreated every render; the ref guard above
    // is what actually makes this run once per finished batch, not this
    // dependency array, same pattern as `ImportPanel`'s analogous effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkConfirmBatch]);

  const bulkBusy = bulkReject.isPending || bulkConfirm.isPending || bulkConfirmProcessing;

  return (
    <Panel>
      <PanelHeader
        title="§ From your inbox"
        meta={
          visibleCount < items.length
            ? `${visibleItems.length} of ${items.length} waiting`
            : `${items.length} waiting`
        }
      />
      <Helper className="-mt-8 mb-14 max-w-[56ch]">
        Read out of your bank email and held here until you say so. Nothing below has touched your
        balances yet.
      </Helper>

      {items.length > 1 ? (
        <div className="mb-14 flex flex-wrap items-center justify-between gap-12 border-b border-rule pb-14">
          <Checkbox
            id="pending-select-all"
            label={selected.size > 0 ? `${selected.size} selected` : "Select all"}
            checked={allSelected}
            onChange={toggleAll}
          />
          {selected.size > 0 ? (
            <div className="flex flex-none items-center gap-14">
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Discard ${selected.size} pending transaction${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) {
                    bulkReject.mutate([...selected]);
                  }
                }}
                disabled={bulkBusy}
                className="rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-ink disabled:opacity-[.55]"
              >
                Discard {selected.size}
              </button>
              <Button size="sm" busy={bulkConfirm.isPending || bulkConfirmProcessing} onClick={() => bulkConfirm.mutate([...selected])}>
                File {selected.size}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {bulkSkipNotice ? (
        <Notice
          tone="quiet"
          title={`${bulkSkipNotice.needsAccount + bulkSkipNotice.duplicates} couldn't be filed yet, still selected below`}
          body={
            [
              bulkSkipNotice.needsAccount > 0
                ? `${bulkSkipNotice.needsAccount} ${bulkSkipNotice.needsAccount === 1 ? "needs" : "need"} an account picked first: you'll see the field on that row.`
                : null,
              bulkSkipNotice.duplicates > 0
                ? `${bulkSkipNotice.duplicates} ${bulkSkipNotice.duplicates === 1 ? "looks" : "look"} like something you already have, so ${bulkSkipNotice.duplicates === 1 ? "it wasn't" : "they weren't"} added again.`
                : null,
            ]
              .filter(Boolean)
              .join(" ")
          }
          action={
            <button
              type="button"
              onClick={() => setBulkSkipNotice(null)}
              className="rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] hover:text-ink"
            >
              Dismiss
            </button>
          }
          className="mb-14 max-w-none"
        />
      ) : null}

      <div data-stagger>
      {visibleItems.map((item, i) => {
        const needsAccount = !item.accountId;
        const chosen = accountChoice[item._id] ?? "";
        // Same rule as the history rows: a pending transaction with no
        // category is uncategorised, not "an expense".
        const spec = resolveChip(item.categoryId, index);
        return (
          <div
            key={item._id}
            className="row-stagger border-b border-rule py-14 last:border-b-0 last:pb-0"
            style={{ ["--i" as string]: i }}
          >
            {/* Actions sit on the ROW, level with the amount. Put on their own
                line they doubled the height of every card in a queue whose
                whole job is to be cleared quickly. The account picker is the
                one thing that earns a second line, and only on the rows that
                actually need one. */}
            <div className="flex flex-wrap items-center gap-14">
              {items.length > 1 ? (
                <Checkbox
                  id={`pending-select-${item._id}`}
                  label={<span className="sr-only">Select {item.merchant || item.note || "this row"}</span>}
                  checked={selected.has(item._id)}
                  onChange={() => toggleOne(item._id)}
                  className="flex-none"
                />
              ) : null}
              <div className="grid min-w-[260px] flex-1 grid-cols-row-tether items-center">
                <Tether label="Filed automatically from a bank email" />
                <Chip spec={spec} labelled />
                <RowName
                  name={item.merchant || item.note || "Untitled"}
                  sub={[
                    formatDate(item.date),
                    item.note && item.merchant ? item.note : null,
                    item.possibleDuplicate ? "possible duplicate" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
                <Amount>{formatSignedInr(item.amount)}</Amount>
              </div>
              <div className="flex flex-none items-center gap-14">
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Discard "${item.merchant || item.note || "this transaction"}"? This cannot be undone.`)) {
                      reject.mutate(item._id);
                    }
                  }}
                  disabled={reject.isPending}
                  className="rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-ink disabled:opacity-[.55]"
                >
                  Discard
                </button>
                <Button
                  size="sm"
                  busy={confirm.isPending}
                  disabled={needsAccount && !chosen}
                  onClick={() => {
                    // A flagged row can still be filed: it might genuinely be
                    // a second real charge, not a re-import. But it must be a
                    // deliberate choice, not a silent one, since the same
                    // check that flagged it is what the confirm route itself
                    // would otherwise 409 on.
                    if (
                      item.possibleDuplicate &&
                      !window.confirm(
                        "This looks like a duplicate of a transaction you've already confirmed. File it anyway?"
                      )
                    ) {
                      return;
                    }
                    confirm.mutate({
                      id: item._id,
                      accountId: needsAccount ? chosen : undefined,
                      force: item.possibleDuplicate,
                    });
                  }}
                >
                  File it
                </Button>
              </div>
            </div>

            {needsAccount ? (
              <div className="mt-12 pl-[52px]">
                <Field
                  id={`pending-account-${item._id}`}
                  label="Account"
                  helper="The email did not say which account this came from, so it needs one before it can be filed."
                  className="max-w-[380px]"
                >
                  <Select
                    id={`pending-account-${item._id}`}
                    value={chosen}
                    onChange={(e) =>
                      setAccountChoice((prev) => ({ ...prev, [item._id]: e.target.value }))
                    }
                  >
                    <option value="">Select an account</option>
                    {accounts.map((a) => (
                      <option key={a._id} value={a._id}>
                        {a.institution} · {a.nickname}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : null}
          </div>
        );
      })}
      </div>

      {visibleCount < items.length ? (
        <div className="mt-18 flex justify-center">
          <Button size="sm" variant="ghost" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
            Show more ({items.length - visibleCount} left)
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Add
// ═══════════════════════════════════════════════════════════════════════════

function AddTransactionPanel({
  accounts,
  categories,
  onDone,
  showToast,
}: {
  accounts: Account[];
  categories: { node: CategoryNode; depth: number }[];
  onDone: () => void;
  showToast: (message: string, variant?: "error" | "success") => void;
}) {
  const empty = {
    accountId: "",
    categoryId: "",
    amount: "",
    date: todayInputValue(),
    merchant: "",
    note: "",
  };
  const [form, setForm] = useState(empty);
  /**
   * The server's duplicate guard answers 409 with `{note:"possible_duplicate"}`
   * and will accept the same body again with `force: true`. Holding that body
   * here is what turns a dead end into a question ("add it anyway?") instead
   * of a toast the person can only read and re-type around.
   */
  const [duplicate, setDuplicate] = useState<Record<string, unknown> | null>(null);
  const duplicateRef = useRef<HTMLDivElement>(null);

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<Transaction>("/transactions", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      setForm((f) => ({ ...empty, accountId: f.accountId, date: f.date }));
      setDuplicate(null);
      onDone();
      showToast("Transaction added", "success");
    },
    onError: (err, payload) => {
      if (err instanceof ApiError && err.status === 409) {
        setDuplicate(payload);
        // Move focus to the question, because it is the only thing on screen
        // that changed and it is asking something.
        window.setTimeout(() => duplicateRef.current?.focus(), 0);
        return;
      }
      showToast("Could not add that transaction", "error");
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.accountId) {
      showToast("Choose an account first");
      return;
    }
    const amount = Number(form.amount);
    if (form.amount.trim() === "" || Number.isNaN(amount)) {
      showToast("Enter a valid amount");
      return;
    }
    create.mutate({
      accountId: form.accountId,
      ...(form.categoryId ? { categoryId: form.categoryId } : {}),
      amount,
      date: form.date,
      ...(form.merchant ? { merchant: form.merchant } : {}),
      ...(form.note ? { note: form.note } : {}),
    });
  }

  return (
    <Panel>
      <PanelHeader title="§ Add a transaction" />
      <form noValidate onSubmit={submit} className="flex flex-col gap-14">
        <Field id="tx-account" label="Account">
          <Select
            id="tx-account"
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
          >
            <option value="">Select account</option>
            {accounts.map((a) => (
              <option key={a._id} value={a._id}>
                {a.institution} · {a.nickname}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="tx-category"
          label="Category"
          helper="Leave it on auto and your rules will decide, or leave it uncategorised and file it later."
        >
          <Select
            id="tx-category"
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
          >
            <option value="">Auto-categorise</option>
            {categories.map(({ node, depth }) => (
              <option key={node._id} value={node._id}>
                {"– ".repeat(depth)}
                {node.name}
              </option>
            ))}
          </Select>
        </Field>

        <FieldGrid>
          <Field id="tx-amount" label="Amount" hint="− for spend">
            <MoneyInput
              id="tx-amount"
              placeholder="-500"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </Field>
          <Field id="tx-date" label="Date">
            <DateInput
              id="tx-date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </Field>
        </FieldGrid>

        <FieldGrid>
          <Field id="tx-merchant" label="Merchant">
            <Input
              id="tx-merchant"
              placeholder="Swiggy Instamart"
              value={form.merchant}
              onChange={(e) => setForm({ ...form, merchant: e.target.value })}
            />
          </Field>
          <Field id="tx-note" label="Note">
            <Input
              id="tx-note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
        </FieldGrid>

        {duplicate ? (
          <Notice
            ref={duplicateRef}
            tone="quiet"
            title="This looks like one you already have."
            body="Same account, same amount, within two days. Nothing was added."
            action={
              <div className="flex flex-wrap items-center gap-12">
                <Button
                  size="sm"
                  busy={create.isPending}
                  onClick={() => create.mutate({ ...duplicate, force: true })}
                >
                  Add it anyway
                </Button>
                <button
                  type="button"
                  onClick={() => setDuplicate(null)}
                  className="rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] hover:text-ink"
                >
                  Never mind
                </button>
              </div>
            }
          />
        ) : null}

        <FormActions>
          <Button type="submit" busy={create.isPending}>
            Add transaction
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CSV import
// ═══════════════════════════════════════════════════════════════════════════

function ImportPanel({
  accounts,
  showToast,
}: {
  accounts: Account[];
  showToast: (message: string, variant?: "error" | "success") => void;
}) {
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportBatchResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // `pdfBusy` covers only the upload request itself (fast: it just enqueues
  // a job and returns `202`). Once that resolves, `pdfBatchId` drives a
  // separate poll of `GET /transactions/import-pdf/:batchId` for however
  // long the background worker actually takes to unlock/parse/insert:
  // see `pdfBatchQuery` below. Statement processing moved off this request
  // entirely (into the `statement-process` BullMQ worker) so a large
  // statement can't hold this request, or this app's single event loop,
  // open for seconds at a time.
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfBatchId, setPdfBatchId] = useState<string | null>(null);
  const pdfFileRef = useRef<HTMLInputElement>(null);
  // "" means "no bank-specific parser": the server falls back to a generic,
  // lower-accuracy reader. Naming the bank here is what lets the accurate
  // per-bank parser (SBI, HDFC) actually get used; there's no way to detect
  // it from the file alone before it's even unlocked.
  const [bankFormat, setBankFormat] = useState("");

  async function upload(file: File) {
    if (!accountId) {
      showToast("Choose the account this statement belongs to first");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("accountId", accountId);
      // Deliberately `fetch`, not `apiFetch`: apiFetch always sets a JSON
      // content type, and a multipart upload needs the browser to set its own
      // boundary.
      const res = await fetch(`${API_BASE}/transactions/import`, {
        method: "POST",
        credentials: "include",
        body,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Import failed: ${res.status}`);
      }
      setResult(await res.json());
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      showToast((e as Error).message || "Could not import that file", "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPdf(file: File) {
    if (!accountId) {
      showToast("Choose the account this statement belongs to first");
      return;
    }
    setPdfBusy(true);
    setPdfBatchId(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("accountId", accountId);
      if (bankFormat) body.append("parserKey", bankFormat);
      // Deliberately `fetch`, not `apiFetch`: apiFetch always sets a JSON
      // content type, and a multipart upload needs the browser to set its own
      // boundary.
      const res = await fetch(`${API_BASE}/transactions/import-pdf`, {
        method: "POST",
        credentials: "include",
        body,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Import failed: ${res.status}`);
      }
      // 202: the file is enqueued, not processed yet. `pdfBatchQuery` below
      // takes over from here, polling until the worker finishes.
      const enqueued: ImportPdfEnqueuedResult = await res.json();
      setPdfBatchId(enqueued.batchId);
    } catch (e) {
      showToast((e as Error).message || "Could not import that file", "error");
    } finally {
      setPdfBusy(false);
    }
  }

  // Polls the batch until it leaves "processing": a 1.5s interval is
  // frequent enough to feel responsive for a personal-scale statement (a few
  // seconds at most) without hammering the API. Stops itself (returns
  // `false`) once the batch reaches either terminal state.
  const pdfBatchQuery = useQuery({
    queryKey: ["import-pdf-batch", pdfBatchId],
    queryFn: () => apiFetch<ImportBatchResult>(`/transactions/import-pdf/${pdfBatchId}`),
    enabled: pdfBatchId !== null,
    refetchInterval: (query) => (query.state.data?.status === "processing" ? 1500 : false),
  });

  const pdfBatch = pdfBatchQuery.data;
  const pdfProcessing = pdfBatchId !== null && (!pdfBatch || pdfBatch.status === "processing");

  // Once the batch completes with rows waiting for review, the review queue
  // (fetched separately by `pending`/`["pending-transactions"]` above) needs
  // refetching. Nothing here touches balances/dashboard, since PDF rows are
  // always pending, never confirmed. Runs once per batch, the moment it
  // finishes, not on every poll tick.
  const notifiedBatchId = useRef<string | null>(null);
  useEffect(() => {
    if (!pdfBatch || pdfBatch.status !== "completed" || notifiedBatchId.current === pdfBatch._id) return;
    notifiedBatchId.current = pdfBatch._id;
    const waiting = pdfBatch.rowResults.filter((r) => r.status === "success").length;
    if (waiting > 0) queryClient.invalidateQueries({ queryKey: ["pending-transactions"] });
  }, [pdfBatch, queryClient]);

  const failures = result?.rowResults.filter((r) => r.status === "failed") ?? [];
  const imported = result ? result.rowResults.length - failures.length : 0;

  return (
    <Panel>
      <PanelHeader title="§ Import a statement" />
      <div className="flex flex-col gap-14">
        <Field
          id="csv-account"
          label="Import into"
          helper="Every row in the file is filed against this one account."
        >
          <Select
            id="csv-account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">Select account</option>
            {accounts.map((a) => (
              <option key={a._id} value={a._id}>
                {a.institution} · {a.nickname}
              </option>
            ))}
          </Select>
        </Field>

        {/* The column list below is HELPER TEXT, not a <label>.
            As a label it became the file input's accessible name, so the
            control announced itself as "Date, Debit, Credit Amount,
            Description", and any lookup for a field called "Amount" matched
            a file picker. The input carries its own name instead. */}
        <input
          ref={fileRef}
          id="csv-file"
          type="file"
          accept=".csv"
          aria-label="Statement file"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            // Reset, so choosing the same file twice still fires a change.
            e.target.value = "";
          }}
        />
        <input
          ref={pdfFileRef}
          id="pdf-file"
          type="file"
          accept=".pdf"
          aria-label="Statement PDF"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadPdf(file);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap items-center gap-12">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            busy={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="upload" size={15} />
            {busy ? "Reading…" : "Choose a CSV"}
          </Button>
          <span className="font-sans text-caption text-dim-2">
            Date, Debit, Credit Amount, Description
          </span>
        </div>
        <Field
          id="pdf-bank-format"
          label="Statement format"
          hint="Optional"
          helper="Naming the bank reads the statement more accurately. Leave it on Detect if you're not sure or it isn't listed."
        >
          <Select
            id="pdf-bank-format"
            value={bankFormat}
            onChange={(e) => setBankFormat(e.target.value)}
          >
            <option value="">Detect automatically</option>
            <option value="sbi_statement">State Bank of India (SBI)</option>
            <option value="hdfc_statement">HDFC Bank</option>
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-12">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            busy={pdfBusy}
            onClick={() => pdfFileRef.current?.click()}
          >
            <Icon name="upload" size={15} />
            {pdfBusy ? "Reading…" : "Choose a PDF"}
          </Button>
          <span className="font-sans text-caption text-dim-2">
            A bank e-statement. Password-protected is fine: saved passwords are tried automatically.
          </span>
        </div>

        {result ? (
          <div className="rounded-panel border-panel border-ink p-18">
            <SectionLabel>§ Import result</SectionLabel>
            <p className="m-0 mt-8 text-body-s">
              {imported} imported, {failures.length} skipped.
            </p>
            {failures.length > 0 ? (
              <ul className="m-0 mt-12 flex list-none flex-col gap-8 p-0">
                {failures.slice(0, 6).map((f) => (
                  <li key={f.row} className="font-num text-micro uppercase tracking-micro text-dim">
                    Row {f.row} · {f.reason ?? "rejected"}
                  </li>
                ))}
                {failures.length > 6 ? (
                  <li className="font-num text-micro uppercase tracking-micro text-dim">
                    and {failures.length - 6} more
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}

        {/* PDF rows never land as confirmed: they always need a look, so
            success points at the review queue above instead of claiming
            "N imported" the way the CSV result does. */}
        {pdfProcessing ? (
          <div className="rounded-panel border-panel border-ink p-18">
            <SectionLabel>§ Import result</SectionLabel>
            <p className="m-0 mt-8 text-body-s">Processing your statement…</p>
          </div>
        ) : null}
        {pdfBatch?.status === "completed" ? (
          (() => {
            const waiting = pdfBatch.rowResults.filter((r) => r.status === "success").length;
            const duplicates = pdfBatch.rowResults.filter((r) => r.reason === "possible_duplicate").length;
            const otherFailed = pdfBatch.rowResults.filter(
              (r) => r.status === "failed" && r.reason !== "possible_duplicate"
            ).length;

            if (waiting === 0 && duplicates === 0 && otherFailed === 0) {
              return (
                <Notice
                  tone="quiet"
                  title="Couldn't find any transaction rows in that PDF."
                  body="The file unlocked fine, but nothing in it matched a recognisable statement layout. A scanned image with no text layer behaves this way too."
                />
              );
            }

            return (
              <div className="rounded-panel border-panel border-ink p-18">
                <SectionLabel>§ Import result</SectionLabel>
                <p className="m-0 mt-8 text-body-s">
                  {waiting > 0
                    ? `${waiting} new row${waiting === 1 ? "" : "s"} waiting for you in “From your inbox” above.`
                    : "No new rows: every parsed row matched a transaction you already have."}
                </p>
                {duplicates > 0 ? (
                  <p className="m-0 mt-8 text-body-s text-dim-2">
                    {duplicates} row{duplicates === 1 ? "" : "s"} matched a transaction already on this
                    account and {duplicates === 1 ? "was" : "were"} skipped, not filed twice.
                  </p>
                ) : null}
                {otherFailed > 0 ? (
                  <p className="m-0 mt-8 text-body-s text-dim-2">
                    {otherFailed} row{otherFailed === 1 ? "" : "s"} could not be read.
                  </p>
                ) : null}
                {/* Non-blocking heads-up: this statement's own date range
                    overlaps one already imported for this account, a normal
                    thing to happen (a re-download, or a fresh statement that
                    covers some of the same days), surfaced here instead of
                    only being discovered row-by-row once confirming starts
                    skipping things. */}
                {pdfBatch.overlapWarning ? (
                  <p className="m-0 mt-8 text-body-s text-dim-2">{pdfBatch.overlapWarning}</p>
                ) : null}
              </div>
            );
          })()
        ) : null}
        {pdfBatch?.status === "failed" ? (
          <Notice
            title="Could not process this statement."
            body={pdfBatch.error ?? "Something went wrong reading that PDF. Please try again."}
          />
        ) : null}
      </div>
    </Panel>
  );
}
