"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api-client";
import type {
  Account,
  CategoryNode,
  Frequency,
  RecurringItem,
  RecurringStatus,
  RecurringSuggestion,
  RecurringType,
} from "@/lib/api-types";
import { flattenCategories, indexCategories, resolveChip, type CategoryIndex } from "@/lib/buckets";
import {
  formatDayMonthShort,
  formatInr,
  formatSignedInr,
  relativeDays,
  todayInputValue,
} from "@/lib/format";
import { resolveLogoUrl } from "@/lib/subscription-logos";
import { cn } from "@/lib/utils";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Chip, ChipSkeleton } from "@/components/app/chip";
import {
  Checkbox,
  Field,
  FieldGrid,
  FormActions,
  MoneyInput,
  DateInput,
  Segmented,
  Select,
} from "@/components/app/form";
import {
  Amount,
  EmptyState,
  Notice,
  PageHeader,
  Panel,
  PanelFooter,
  PanelHeader,
  PinnedColumn,
  Readout,
  RowName,
  Skeleton,
} from "@/components/app/primitives";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import { useToast } from "@/components/ui/Toast";

/**
 * Sorted · Recurring
 *
 * What happens to the money whether or not you look. Rent, SIPs, salary,
 * subscriptions: the items that produce the dashboard's Upcoming rail and,
 * more importantly, the `planned` half of Guilt-Free Money.
 *
 * WHY THE COMMITMENT FIGURE IS "NEXT 30 DAYS" AND NOT "PER MONTH". Frequencies
 * here are monthly, weekly, yearly or custom. Normalising a yearly item into
 * "per month" invents a number nobody is ever charged, and a custom frequency
 * cannot be normalised at all. `GET /recurring/upcoming?days=30` is a real
 * window the server already computes, so that is what is shown.
 *
 * STATUS IS A SHAPE, NOT A COLOUR. Active, paused and cancelled are told apart
 * by which actions a row offers and by an ink label, not by a green/amber/grey
 * badge set, which would put three more colours into a product whose entire
 * colour system is four buckets.
 */

const FREQUENCY_LABELS: Record<Frequency, string> = {
  monthly: "Monthly",
  weekly: "Weekly",
  yearly: "Yearly",
  custom: "Custom",
};

const STATUS_ORDER: RecurringStatus[] = ["active", "paused", "cancelled"];
const STATUS_LABELS: Record<RecurringStatus, string> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};

export default function RecurringPage() {
  const items = useQuery({
    queryKey: ["recurring"],
    queryFn: () => apiFetch<RecurringItem[]>("/recurring"),
  });
  const upcoming = useQuery({
    queryKey: ["recurring-upcoming", 30],
    queryFn: () => apiFetch<RecurringItem[]>("/recurring/upcoming?days=30"),
  });
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiFetch<Account[]>("/accounts"),
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<CategoryNode[]>("/categories"),
  });
  const suggestions = useQuery({
    queryKey: ["recurring-suggestions"],
    queryFn: () => apiFetch<RecurringSuggestion[]>("/recurring/suggestions"),
  });

  const index = useMemo(() => indexCategories(categories.data), [categories.data]);
  const accountName = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts.data ?? []) map.set(a._id, a.nickname);
    return map;
  }, [accounts.data]);

  const list = useMemo(() => items.data ?? [], [items.data]);
  const grouped = useMemo(() => {
    const map = new Map<RecurringStatus, RecurringItem[]>();
    for (const item of list) {
      const bucket = map.get(item.status) ?? [];
      bucket.push(item);
      map.set(item.status, bucket);
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => new Date(a.nextDueDate).getTime() - new Date(b.nextDueDate).getTime());
    }
    return map;
  }, [list]);

  const due = upcoming.data ?? [];
  const dueOut = due
    .filter((i) => i.type === "expense")
    .reduce((sum, i) => sum + Math.abs(i.amount), 0);
  const dueIn = due.filter((i) => i.type === "income").reduce((sum, i) => sum + Math.abs(i.amount), 0);

  return (
    <ProtectedLayout>
      <PageHeader
        title="Recurring"
        meta={list.length > 0 ? `${grouped.get("active")?.length ?? 0} active` : undefined}
      />

      <div className="grid items-start gap-22 xl:grid-cols-[7fr_5fr]">
        <div className="flex min-w-0 flex-col gap-22">
          {suggestions.data && suggestions.data.length > 0 ? (
            <RecurringSuggestionsPanel
              suggestions={suggestions.data}
              accountName={accountName}
              categories={flattenCategories(categories.data)}
              index={index}
            />
          ) : null}

          {!items.isLoading && !items.isError && list.length > 0 ? (
            <Panel>
              <PanelHeader
                title="§ The next 30 days"
                meta={upcoming.isSuccess ? `${due.length} due` : undefined}
              />
              {/* A dash, not a zero. `?? []` would report "nothing going out"
                  when the real answer is that the window could not be read,
                  and those are opposite facts. */}
              <div className="grid gap-22 sm:grid-cols-3">
                <Readout
                  label="Going out"
                  value={!upcoming.isSuccess ? "–" : dueOut > 0 ? `−${formatInr(dueOut)}` : formatInr(0)}
                />
                <Readout
                  label="Coming in"
                  value={!upcoming.isSuccess ? "–" : dueIn > 0 ? `+${formatInr(dueIn)}` : formatInr(0)}
                />
                <Readout label="Net" value={upcoming.isSuccess ? dueIn - dueOut : "–"} />
              </div>
              <PanelFooter>
                Active items only. Paused and cancelled ones are not counted.
              </PanelFooter>
            </Panel>
          ) : null}

          {items.isLoading ? (
            <Panel>
              <PanelHeader title="§ Active" />
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="grid grid-cols-row items-center gap-14 border-b border-rule py-14 last:border-b-0"
                >
                  <ChipSkeleton />
                  <Skeleton className="h-[15px] w-[170px] rounded-sm" />
                  <Skeleton className="h-[15px] w-[90px] rounded-sm" />
                </div>
              ))}
            </Panel>
          ) : items.isError ? (
            <Notice
              title="Could not load your recurring items."
              body="Please try again shortly. Nothing has been lost."
            />
          ) : list.length === 0 ? (
            <Panel>
              <EmptyState
                title="Nothing recurring yet."
                body="Rent, SIPs, salary, subscriptions: anything that happens on a schedule. Adding them is what makes Guilt-Free Money mean something, because it is what the plan is subtracted from."
              />
            </Panel>
          ) : (
            STATUS_ORDER.filter((status) => (grouped.get(status) ?? []).length > 0).map((status) => (
              <Panel key={status} className="reveal-in" data-stagger>
                <PanelHeader
                  title={`§ ${STATUS_LABELS[status]}`}
                  meta={`${grouped.get(status)!.length}`}
                />
                {grouped.get(status)!.map((item, i) => (
                  <RecurringRow
                    key={item._id}
                    item={item}
                    index={index}
                    accountName={accountName}
                    staggerIndex={i}
                  />
                ))}
                {status === "cancelled" ? (
                  <PanelFooter>Kept for the record. They never fire again.</PanelFooter>
                ) : null}
              </Panel>
            ))
          )}
        </div>

        <PinnedColumn>
          <AddRecurringPanel
            accounts={accounts.data ?? []}
            categories={flattenCategories(categories.data)}
          />
        </PinnedColumn>
      </div>
    </ProtectedLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// One item
// ═══════════════════════════════════════════════════════════════════════════

function RecurringRow({
  item,
  index,
  accountName,
  staggerIndex,
}: {
  item: RecurringItem;
  index: CategoryIndex;
  accountName: Map<string, string>;
  staggerIndex?: number;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const setStatus = useMutation({
    mutationFn: (status: RecurringStatus) =>
      apiFetch<RecurringItem>(`/recurring/${item._id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      queryClient.invalidateQueries({ queryKey: ["recurring-upcoming"] });
      // A recurring item feeds `planned` in Guilt-Free Money directly, so
      // pausing one changes the dashboard's headline figure.
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      showToast(
        status === "paused" ? "Paused" : status === "active" ? "Resumed" : "Cancelled",
        "success"
      );
    },
    onError: () => showToast("Could not update that item", "error"),
  });

  const spec = resolveChip(item.categoryId, index, {
    direction: item.type === "income" ? "income" : "expense",
  });
  const logoUrl = resolveLogoUrl(item.name);
  const signed = item.type === "income" ? Math.abs(item.amount) : -Math.abs(item.amount);
  const inactive = item.status !== "active";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-14 border-b border-rule py-12 last:border-b-0",
        staggerIndex !== undefined && "row-stagger",
        // Cancelled rows are dimmed as a WHOLE, so nothing inside them has to be
        // recoloured, and the figures stay tabular and legible rather than
        // being greyed into illegibility one element at a time. Transitioned,
        // not a hard cut: pausing/cancelling happens while looking right at
        // this row.
        "transition-opacity duration-hover ease-out motion-reduce:transition-none",
        item.status === "cancelled" && "opacity-[.6]"
      )}
      style={staggerIndex !== undefined ? { ["--i" as string]: staggerIndex } : undefined}
    >
      <div className="grid min-w-[240px] flex-1 grid-cols-row items-center gap-14">
        <Chip spec={spec} labelled logoUrl={logoUrl} />
        <RowName
          name={item.name}
          sub={[
            FREQUENCY_LABELS[item.frequency],
            inactive
              ? null
              : `${formatDayMonthShort(item.nextDueDate)} · ${relativeDays(item.nextDueDate)}`,
            accountName.get(item.accountId),
            item.autoCreate ? "auto-files" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        <Amount>{formatSignedInr(signed)}</Amount>
      </div>

      <div className="flex flex-none items-center gap-14">
        {item.status === "active" ? (
          <button
            type="button"
            onClick={() => setStatus.mutate("paused")}
            disabled={setStatus.isPending}
            className="rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-ink disabled:opacity-[.55]"
          >
            Pause
          </button>
        ) : null}
        {item.status === "paused" ? (
          <Button size="sm" variant="ghost" busy={setStatus.isPending} onClick={() => setStatus.mutate("active")}>
            Resume
          </Button>
        ) : null}
        {item.status !== "cancelled" ? (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Cancel "${item.name}"? This cannot be undone.`)) {
                setStatus.mutate("cancelled");
              }
            }}
            disabled={setStatus.isPending}
            /* --alert is reserved for a real failure and for a named budget
               overage. Ten rows each carrying a red "Cancel" would have put
               more of that colour on this screen than exists in the rest of the
               product combined, for an action that is guarded by a confirm
               dialog anyway. It goes red on hover, at the moment it is about to
               be used. */
            className="rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-alert disabled:opacity-[.55]"
          >
            Cancel
          </button>
        ) : (
          <span className="font-num text-micro uppercase tracking-micro text-dim">Cancelled</span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Suggested: detected from real transaction history, never auto-created
// ═══════════════════════════════════════════════════════════════════════════

/**
 * This app never auto-detected a recurring pattern before: every item on
 * this whole page used to require someone to notice the pattern themselves
 * and fill in the form on the right by hand. `GET /recurring/suggestions`
 * scans confirmed transaction history for (account, merchant) pairs that
 * repeat at a regular interval and aren't already tracked, and this panel
 * is the "want to track this?" nudge for what it finds; accepting one is
 * just today's `POST /recurring`, pre-filled; nothing here is auto-created
 * on its own.
 */
function RecurringSuggestionsPanel({
  suggestions,
  accountName,
  categories,
  index,
}: {
  suggestions: RecurringSuggestion[];
  accountName: Map<string, string>;
  categories: { node: CategoryNode; depth: number }[];
  index: CategoryIndex;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [chosenCategory, setChosenCategory] = useState<Record<string, string>>({});

  const accept = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<RecurringItem>("/recurring", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      queryClient.invalidateQueries({ queryKey: ["recurring-upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["recurring-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      showToast("Added to recurring", "success");
    },
    onError: () => showToast("Could not add that item", "error"),
  });

  const visible = suggestions.filter((s) => !dismissed.has(s.key));
  if (visible.length === 0) return null;

  return (
    <Panel className="reveal-in">
      <PanelHeader title="§ Suggested" meta={`${visible.length}`} />
      {visible.map((s) => {
        const categoryId = s.categoryId ?? chosenCategory[s.key] ?? "";
        const spec = resolveChip(categoryId || null, index, {
          direction: s.type === "income" ? "income" : "expense",
        });
        const logoUrl = resolveLogoUrl(s.merchant);
        const signed = s.type === "income" ? Math.abs(s.amount) : -Math.abs(s.amount);

        return (
          <div
            key={s.key}
            className="flex flex-wrap items-center gap-14 border-b border-rule py-12 last:border-b-0"
          >
            <div className="grid min-w-[240px] flex-1 grid-cols-row items-center gap-14">
              <Chip spec={spec} labelled logoUrl={logoUrl} />
              <RowName
                name={s.merchant}
                sub={[
                  FREQUENCY_LABELS[s.frequency],
                  `seen ${s.occurrenceCount}×`,
                  accountName.get(s.accountId),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <Amount>{formatSignedInr(signed)}</Amount>
            </div>

            <div className="flex flex-none items-center gap-8">
              {!s.categoryId ? (
                <Select
                  id={`suggest-cat-${s.key}`}
                  aria-label={`Category for ${s.merchant}`}
                  value={chosenCategory[s.key] ?? ""}
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
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={!categoryId}
                busy={accept.isPending && accept.variables ? (accept.variables as { name: string }).name === s.merchant : false}
                onClick={() =>
                  accept.mutate({
                    name: s.merchant,
                    type: s.type,
                    amount: s.amount,
                    frequency: s.frequency,
                    nextDueDate: s.nextDueDate,
                    accountId: s.accountId,
                    categoryId,
                    autoCreate: false,
                  })
                }
              >
                Add
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
      <PanelFooter>
        Detected from your transaction history, nothing is tracked until you add it.
      </PanelFooter>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Add
// ═══════════════════════════════════════════════════════════════════════════

function AddRecurringPanel({
  accounts,
  categories,
}: {
  accounts: Account[];
  categories: { node: CategoryNode; depth: number }[];
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const empty = {
    name: "",
    type: "expense" as RecurringType,
    amount: "",
    frequency: "monthly" as Frequency,
    nextDueDate: todayInputValue(),
    accountId: "",
    categoryId: "",
    autoCreate: false,
  };
  const [form, setForm] = useState(empty);

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<RecurringItem>("/recurring", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      queryClient.invalidateQueries({ queryKey: ["recurring-upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setForm(empty);
      showToast("Recurring item added", "success");
    },
    onError: () => showToast("Could not add that item", "error"),
  });

  return (
    <Panel>
      <PanelHeader title="§ Add a recurring item" />
      <form
        noValidate
        className="flex flex-col gap-14"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim()) {
            showToast("Give it a name");
            return;
          }
          const amount = Number(form.amount);
          if (form.amount.trim() === "" || Number.isNaN(amount) || amount <= 0) {
            showToast("Enter an amount above zero");
            return;
          }
          if (!form.nextDueDate) {
            showToast("Choose when it is next due");
            return;
          }
          if (!form.accountId) {
            showToast("Choose an account");
            return;
          }
          if (!form.categoryId) {
            showToast("Choose a category");
            return;
          }
          create.mutate({
            name: form.name.trim(),
            type: form.type,
            amount,
            frequency: form.frequency,
            nextDueDate: form.nextDueDate,
            accountId: form.accountId,
            categoryId: form.categoryId,
            autoCreate: form.autoCreate,
          });
        }}
      >
        <Field id="rec-name" label="Name">
          <Input
            id="rec-name"
            placeholder="Home rent"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>

        <div className="flex flex-col gap-8">
          <span className="font-sans text-body-s font-medium text-ink">Direction</span>
          <Segmented
            name="rec-type"
            ariaLabel="Direction"
            value={form.type}
            onChange={(type) => setForm({ ...form, type })}
            options={[
              { value: "expense", label: "Money out" },
              { value: "income", label: "Money in" },
            ]}
          />
        </div>

        <FieldGrid>
          <Field id="rec-amount" label="Amount" hint="Positive">
            <MoneyInput
              id="rec-amount"
              placeholder="28000"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </Field>
          <Field id="rec-frequency" label="Frequency">
            <Select
              id="rec-frequency"
              value={form.frequency}
              onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}
            >
              {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABELS[f]}
                </option>
              ))}
            </Select>
          </Field>
        </FieldGrid>

        <Field id="rec-next-due" label="Next due">
          <DateInput
            id="rec-next-due"
            value={form.nextDueDate}
            onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })}
          />
        </Field>

        <Field id="rec-account" label="Account">
          <Select
            id="rec-account"
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
          >
            <option value="">Select an account</option>
            {accounts.map((a) => (
              <option key={a._id} value={a._id}>
                {a.institution} · {a.nickname}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="rec-category"
          label="Category"
          helper="Its bucket is what decides whether this counts against your guilt-free money."
        >
          <Select
            id="rec-category"
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
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
          id="rec-autocreate"
          label="File the transaction automatically"
          helper="When it falls due, the transaction is created for you and the next date moves on by one cycle."
          checked={form.autoCreate}
          onChange={(e) => setForm({ ...form, autoCreate: e.target.checked })}
        />

        <FormActions>
          <Button type="submit" busy={create.isPending}>
            Add
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}
