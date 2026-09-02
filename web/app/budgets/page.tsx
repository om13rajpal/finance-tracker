"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api-client";
import type { BudgetVsSpendRow, CategoryNode, DashboardData } from "@/lib/api-types";
import {
  BUCKETS,
  BUCKET_META,
  BUCKET_OPTIONS,
  flattenCategories,
  isBucket,
  type Bucket,
  type CategoryType,
} from "@/lib/buckets";
import { apiMonthLabel, currentMonthRange, formatInr } from "@/lib/format";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Chip, ChipSkeleton } from "@/components/app/chip";
import { Field, FormActions, MoneyInput, Segmented, Select } from "@/components/app/form";
import {
  Amount,
  Bar,
  IconButton,
  EmptyState,
  Notice,
  PageHeader,
  Panel,
  PanelFooter,
  PanelHeader,
  Skeleton,
} from "@/components/app/primitives";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import { useToast } from "@/components/ui/Toast";

/**
 * Sorted · Budgets
 *
 * Two jobs on one screen, in the order they matter.
 *
 * FIRST, THE SPLIT. Four rows, one per bucket, showing what this month is
 * budgeted to do with the money and what has actually gone. This is the screen
 * where the taxonomy stops being a colour scheme and becomes a plan.
 *
 * SECOND, THE TREE. Categories nest arbitrarily and are named by their owner,
 * which is exactly why the CHIP carries the bucket and the NAME carries in
 * text. Every leaf inherits its ancestor's bucket, so the chip is answerable at
 * any depth.
 *
 * A SUB-CATEGORY HAS NO BAR. `budgetVsSpend` returns one row per TOP-LEVEL
 * expense category; a child's spend is rolled into its parent server-side and
 * never gets its own row. Drawing a child a bar of its own would invent a
 * number the API does not have.
 */

export default function BudgetsPage() {
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<CategoryNode[]>("/categories"),
  });
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<DashboardData>("/dashboard"),
  });

  // Memoised: `categories.data ?? []` allocates a NEW empty array on every
  // render while the query is loading, which changes the identity of every
  // downstream useMemo dependency and defeats the memo entirely.
  const tree = useMemo(() => categories.data ?? [], [categories.data]);
  const spendByCategory = useMemo(() => {
    const map = new Map<string, BudgetVsSpendRow>();
    for (const row of dashboard.data?.budgetVsSpend ?? []) map.set(row.categoryId, row);
    return map;
  }, [dashboard.data]);

  /**
   * Per-bucket totals, from TOP-LEVEL expense categories only.
   *
   * That is not a shortcut: the top-level `budgetLimit` is the authoritative
   * one, because the API rolls every descendant's spend up into it. Adding a
   * child's limit on top would count the same rupees twice.
   */
  const byBucket = useMemo(() => {
    const totals = new Map<Bucket, { limit: number; spent: number }>();
    for (const bucket of BUCKETS) totals.set(bucket, { limit: 0, spent: 0 });
    for (const node of tree) {
      if (node.type !== "expense" || !isBucket(node.bucket)) continue;
      const entry = totals.get(node.bucket)!;
      entry.limit += node.budgetLimit ?? 0;
      entry.spent += spendByCategory.get(node._id)?.spent ?? 0;
    }
    return totals;
  }, [tree, spendByCategory]);

  const totalLimit = [...byBucket.values()].reduce((s, v) => s + v.limit, 0);
  const totalSpent = [...byBucket.values()].reduce((s, v) => s + v.spent, 0);

  return (
    <ProtectedLayout>
      <PageHeader title="Budgets" meta={`${apiMonthLabel()} · ${currentMonthRange()}`} />

      <div className="grid items-start gap-22 xl:grid-cols-[7fr_5fr]">
        <div className="flex min-w-0 flex-col gap-22">
          {/* ── the split ────────────────────────────────────────────── */}
          <Panel>
            <PanelHeader title="§ The split" meta={currentMonthRange()} />
            {categories.isLoading || dashboard.isLoading ? (
              <div>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-row items-center gap-x-14 gap-y-8 border-b border-rule py-12 last:border-b-0"
                  >
                    <ChipSkeleton />
                    <Skeleton className="h-[15px] w-[120px] rounded-sm" />
                    <Skeleton className="h-[15px] w-[110px] rounded-sm" />
                  </div>
                ))}
              </div>
            ) : categories.isError || dashboard.isError ? (
              // Not the empty state: "nothing is budgeted" on a failed request
              // would tell someone their plan had vanished.
              <Notice
                title="The split is unavailable right now."
                body="Your categories and their limits are untouched. The app just could not read them."
              />
            ) : totalLimit === 0 ? (
              <EmptyState
                title="Nothing is budgeted yet."
                body="Give a category a monthly limit and its bucket starts filling here. Four buckets, and every rupee ends up in one of them."
              />
            ) : (
              <>
                {BUCKETS.map((bucket) => {
                  const meta = BUCKET_META[bucket];
                  const { limit, spent } = byBucket.get(bucket)!;
                  const over = limit > 0 && spent > limit;
                  return (
                    <div
                      key={bucket}
                      className="grid grid-cols-row items-center gap-x-14 gap-y-8 border-b border-rule py-12 last:border-b-0"
                    >
                      <Chip spec={{ kind: "bucket", bucket }} labelled />
                      <span className="min-w-0 truncate text-body-s">{meta.label}</span>
                      <span className="flex items-baseline gap-14 whitespace-nowrap">
                        {over ? (
                          <span className="font-num text-micro uppercase tracking-micro text-alert">
                            Over by {formatInr(spent - limit)}
                          </span>
                        ) : null}
                        <Amount>
                          {formatInr(spent)}{" "}
                          <span className="text-dim-2">
                            {limit > 0 ? `/ ${formatInr(limit)}` : "· nothing planned"}
                          </span>
                        </Amount>
                      </span>
                      {limit > 0 ? (
                        <Bar
                          className="col-start-2 col-end-4"
                          percent={(spent / limit) * 100}
                          fill={meta.fill}
                          over={over}
                          live
                          label={`${meta.label}: ${formatInr(spent)} of ${formatInr(limit)} planned${
                            over ? `, over by ${formatInr(spent - limit)}` : ""
                          }`}
                        />
                      ) : null}
                    </div>
                  );
                })}
                <PanelFooter>
                  {formatInr(totalSpent)} of {formatInr(totalLimit)} planned this month
                </PanelFooter>
              </>
            )}
          </Panel>

          {/* ── the tree ─────────────────────────────────────────────── */}
          <Panel className="reveal-in" data-stagger>
            <PanelHeader
              title="§ Categories"
              meta={categories.isSuccess ? `${flattenCategories(tree).length} total` : undefined}
            />
            {categories.isLoading ? (
              <div>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-14 border-b border-rule py-14">
                    <ChipSkeleton />
                    <Skeleton className="h-[15px] w-[180px] rounded-sm" />
                  </div>
                ))}
              </div>
            ) : categories.isError ? (
              <Notice
                title="Could not load your categories."
                body="Please try again shortly. Nothing has been lost."
              />
            ) : tree.length === 0 ? (
              <EmptyState
                title="No categories yet."
                body="Add one on the right. Name it whatever you like: the bucket you put it in is what gives it a colour."
              />
            ) : (
              // A single running counter, threaded through CategoryRow's own
              // recursive calls for its children (see that prop's doc
              // comment): the tree nests arbitrarily, so a per-`.map()`
              // index alone can't produce one continuous stagger order
              // across parents and children.
              (() => {
                const counter = { current: 0 };
                return tree.map((node) => (
                  <CategoryRow
                    key={node._id}
                    node={node}
                    depth={0}
                    inheritedBucket={null}
                    row={spendByCategory.get(node._id)}
                    tree={tree}
                    staggerCounter={counter}
                  />
                ));
              })()
            )}
            {dashboard.isError && !categories.isError ? (
              <PanelFooter>
                Spend figures are unavailable right now, limits below are still editable
              </PanelFooter>
            ) : null}
          </Panel>
        </div>

        <div className="xl:sticky xl:top-32">
          <AddCategoryPanel tree={tree} />
        </div>
      </div>
    </ProtectedLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// One node of the tree
// ═══════════════════════════════════════════════════════════════════════════

/** `CategoryNode` carries `children`, never a `parentCategoryId` back-reference
 * (it's a tree, reconstructed server-side): finding a node's current parent
 * means walking down from the root looking for whichever node's `children`
 * contains it. `null` for a top-level node (or one no longer in the tree). */
function findParentId(tree: CategoryNode[], childId: string): string | null {
  for (const node of tree) {
    if (node.children.some((c) => c._id === childId)) return node._id;
    const found = findParentId(node.children, childId);
    if (found) return found;
  }
  return null;
}

function CategoryRow({
  node,
  depth,
  inheritedBucket,
  row,
  isFirstChild = false,
  tree,
  staggerCounter,
}: {
  node: CategoryNode;
  depth: number;
  inheritedBucket: Bucket | null;
  row?: BudgetVsSpendRow;
  isFirstChild?: boolean;
  tree: CategoryNode[];
  /** One counter shared across the whole tree (see the top-level `.map()`
   * that creates it): incremented once per row, in render order, so nested
   * children continue the SAME stagger sequence their ancestors are already
   * mid-way through, instead of each restarting from 0. */
  staggerCounter: { current: number };
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const bucket = isBucket(node.bucket) ? node.bucket : inheritedBucket;
  const myStaggerIndex = staggerCounter.current++;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: node.name,
    type: node.type,
    bucket: (isBucket(node.bucket) ? node.bucket : "guilt_free") as Bucket,
    parentCategoryId: findParentId(tree, node._id) ?? "",
    budgetLimit: String(node.budgetLimit ?? 0),
  });

  const update = useMutation({
    mutationFn: (budgetLimit: number) =>
      apiFetch(`/categories/${node._id}`, {
        method: "PATCH",
        body: JSON.stringify({ budgetLimit }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      showToast("Budget updated", "success");
    },
    onError: () => showToast("Could not update that budget", "error"),
  });

  const saveEdit = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch(`/categories/${node._id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setEditing(false);
      showToast("Category updated", "success");
    },
    onError: () => showToast("Could not update that category", "error"),
  });

  const remove = useMutation({
    mutationFn: () => apiFetch<void>(`/categories/${node._id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      showToast("Category deleted", "success");
    },
    onError: () => showToast("Could not delete that category", "error"),
  });

  const hasLimit = (node.budgetLimit ?? 0) > 0;
  const over = row ? row.budgetLimit > 0 && row.spent > row.budgetLimit : false;

  // Every category except this one and (to avoid a cycle) its own
  // descendants: a node can't become its own ancestor. The backend only
  // rejects the direct self-parent case; excluding descendants here too is
  // this form's own, stricter guard.
  const descendantIds = useMemo(() => {
    const ids = new Set<string>();
    const walk = (n: CategoryNode) => {
      for (const child of n.children) {
        ids.add(child._id);
        walk(child);
      }
    };
    walk(node);
    return ids;
  }, [node]);
  const parentOptions = useMemo(
    () => flattenCategories(tree).filter(({ node: n }) => n._id !== node._id && !descendantIds.has(n._id)),
    [tree, node._id, descendantIds]
  );

  if (editing) {
    return (
      <>
        <form
          noValidate
          className="reveal-in flex flex-col gap-14 border-b border-rule py-14 last:border-b-0"
          style={{ paddingLeft: depth * 22 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) {
              showToast("Give the category a name");
              return;
            }
            saveEdit.mutate({
              name: form.name.trim(),
              type: form.type,
              bucket: form.bucket,
              parentCategoryId: form.parentCategoryId || null,
              budgetLimit: form.budgetLimit ? Number(form.budgetLimit) : 0,
            });
          }}
        >
          <Field id={`edit-cat-name-${node._id}`} label="Name">
            <Input
              id={`edit-cat-name-${node._id}`}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <div className="flex flex-col gap-8">
            <span className="font-sans text-body-s font-medium text-ink">Type</span>
            <Segmented
              name={`edit-cat-type-${node._id}`}
              ariaLabel="Type"
              value={form.type}
              onChange={(type) => setForm({ ...form, type })}
              options={[
                { value: "expense", label: "Expense" },
                { value: "income", label: "Income" },
              ]}
            />
          </div>
          <Field id={`edit-cat-bucket-${node._id}`} label="Bucket" helper={BUCKET_META[form.bucket].hint}>
            <Select
              id={`edit-cat-bucket-${node._id}`}
              value={form.bucket}
              onChange={(e) => setForm({ ...form, bucket: e.target.value as Bucket })}
            >
              {BUCKET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id={`edit-cat-parent-${node._id}`}
            label="Parent category"
            helper="Optional. A sub-category's spend rolls up into its parent's total."
          >
            <Select
              id={`edit-cat-parent-${node._id}`}
              value={form.parentCategoryId}
              onChange={(e) => setForm({ ...form, parentCategoryId: e.target.value })}
            >
              <option value="">None (top level)</option>
              {parentOptions.map(({ node: n, depth: d }) => (
                <option key={n._id} value={n._id}>
                  {"– ".repeat(d)}
                  {n.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={`edit-cat-budget-${node._id}`} label="Monthly Budget" hint="Optional">
            <MoneyInput
              id={`edit-cat-budget-${node._id}`}
              value={form.budgetLimit}
              onChange={(e) => setForm({ ...form, budgetLimit: e.target.value })}
            />
          </Field>
          <FormActions>
            <Button type="submit" busy={saveEdit.isPending}>
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </FormActions>
        </form>
        {node.children.map((child, i) => (
          <CategoryRow
            key={child._id}
            node={child}
            depth={depth + 1}
            inheritedBucket={bucket}
            isFirstChild={i === 0}
            tree={tree}
            staggerCounter={staggerCounter}
          />
        ))}
      </>
    );
  }

  return (
    <>
      <div
        className="row-stagger grid grid-cols-row items-center gap-x-14 gap-y-8 border-b border-rule py-12 last:border-b-0"
        style={{ paddingLeft: depth * 22, ["--i" as string]: myStaggerIndex }}
      >
        {/* An INCOME category has a bucket in the API, but a bucket means
            "where spending goes"; for money arriving it is a field with no
            meaning. Colouring it would be the chip guessing. It gets the same
            hollow up-arrow every other income row in the product gets. */}
        <Chip
          spec={
            node.type === "income"
              ? { kind: "income" }
              : bucket
                ? { kind: "bucket", bucket }
                : { kind: "uncategorised" }
          }
          size={depth > 0 ? 22 : 30}
          labelled
          className={depth > 0 ? "ml-4" : undefined}
        />
        <span className="flex min-w-0 flex-wrap items-baseline gap-8">
          {/* `font-medium` is load-bearing for e2e/golden-path.spec.ts, which
              scopes its assertion to `span.font-medium` to avoid also matching
              the same name inside the Parent Category <option> list below. */}
          <span className="font-medium truncate text-body-s">{node.name}</span>
          {node.type === "income" ? (
            <span className="font-num text-micro uppercase tracking-micro text-dim">Income</span>
          ) : null}
        </span>
        <span className="flex items-center gap-12">
          <label htmlFor={`budget-${node._id}`} className="sr-only">
            {/* Deliberately NOT the words "Monthly Budget": the create form
                above uses that exact label, and Playwright's getByLabel is a
                case-insensitive SUBSTRING match, so one row would make that
                lookup ambiguous and fail on strict mode. */}
            Budget limit for {node.name}
          </label>
          <MoneyInput
            id={`budget-${node._id}`}
            defaultValue={node.budgetLimit ?? 0}
            className="w-[130px] px-14 py-8 text-body-s"
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (Number.isNaN(value) || value === node.budgetLimit) return;
              update.mutate(value);
            }}
          />
          <button
            type="button"
            onClick={() => {
              setForm({
                name: node.name,
                type: node.type,
                bucket: (isBucket(node.bucket) ? node.bucket : "guilt_free") as Bucket,
                parentCategoryId: findParentId(tree, node._id) ?? "",
                budgetLimit: String(node.budgetLimit ?? 0),
              });
              setEditing(true);
            }}
            className="flex-none rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-ink"
          >
            Edit
          </button>
          {/* An icon, not the word DELETE.
              Fourteen rows of uppercase mono "DELETE" set in --dim read as
              metadata about each category rather than as a destructive control,
              and they were the loudest repeated element on the screen. The
              confirm dialog is what actually guards the action; the button only
              has to be unmistakable and quiet. */}
          <IconButton
            icon="trash"
            label={`Delete ${node.name}`}
            disabled={remove.isPending}
            className="h-22 w-22 border-transparent text-dim hover:border-ink hover:text-alert"
            onClick={() => {
              if (
                window.confirm(
                  `Delete "${node.name}"?${
                    node.children.length > 0
                      ? " Its sub-categories are left without a parent."
                      : ""
                  } This cannot be undone.`
                )
              ) {
                remove.mutate();
              }
            }}
          />
        </span>

        {row && row.budgetLimit > 0 ? (
          <Bar
            className="col-start-2 col-end-4"
            percent={(row.spent / row.budgetLimit) * 100}
            fill={bucket ? BUCKET_META[bucket].fill : "bg-dim"}
            over={over}
            live
            label={`${node.name}: ${formatInr(row.spent)} spent of a ${formatInr(
              row.budgetLimit
            )} limit${over ? `, over by ${formatInr(row.spent - row.budgetLimit)}` : ""}`}
          />
        ) : depth > 0 && isFirstChild ? (
          /* Said ONCE per parent, on its first child. Repeated under every
             child it became four identical lines of noise explaining one rule. */
          <span className="col-start-2 col-end-4 font-num text-micro uppercase tracking-micro text-dim">
            Spend in these rolls up into the parent
          </span>
        ) : hasLimit && !row ? (
          <span className="col-start-2 col-end-4 font-num text-micro uppercase tracking-micro text-dim">
            Nothing spent here this month
          </span>
        ) : null}
      </div>

      {node.children.map((child, i) => (
        <CategoryRow
          key={child._id}
          node={child}
          depth={depth + 1}
          inheritedBucket={bucket}
          isFirstChild={i === 0}
          tree={tree}
          staggerCounter={staggerCounter}
        />
      ))}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Add
// ═══════════════════════════════════════════════════════════════════════════

function AddCategoryPanel({ tree }: { tree: CategoryNode[] }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [form, setForm] = useState({
    name: "",
    type: "expense" as CategoryType,
    bucket: "guilt_free" as Bucket,
    parentCategoryId: "",
    budgetLimit: "",
  });

  const flat = flattenCategories(tree);

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch("/categories", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setForm({
        name: "",
        type: "expense",
        bucket: "guilt_free",
        parentCategoryId: "",
        budgetLimit: "",
      });
      showToast("Category added", "success");
    },
    onError: () => showToast("Could not add that category", "error"),
  });

  return (
    <Panel>
      <PanelHeader title="§ Add a category" />
      <form
        noValidate
        className="flex flex-col gap-14"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim()) {
            showToast("Give the category a name");
            return;
          }
          create.mutate({
            name: form.name.trim(),
            type: form.type,
            bucket: form.bucket,
            ...(form.parentCategoryId ? { parentCategoryId: form.parentCategoryId } : {}),
            budgetLimit: form.budgetLimit ? Number(form.budgetLimit) : 0,
          });
        }}
      >
        <Field id="cat-name" label="Name">
          <Input
            id="cat-name"
            placeholder="Eating out"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>

        {/* A radiogroup, not a labelled field: there is no single control for a
            <label for> to point at, so the group carries its own accessible
            name and the visible text is a plain heading. Pointing a real
            <label> at one of the radios would announce the wrong thing. */}
        <div className="flex flex-col gap-8">
          <span className="font-sans text-body-s font-medium text-ink">Type</span>
          <Segmented
            name="cat-type"
            ariaLabel="Type"
            value={form.type}
            onChange={(type) => setForm({ ...form, type })}
            options={[
              { value: "expense", label: "Expense" },
              { value: "income", label: "Income" },
            ]}
          />
        </div>

        <Field
          id="cat-bucket"
          label="Bucket"
          helper={BUCKET_META[form.bucket].hint}
        >
          <Select
            id="cat-bucket"
            value={form.bucket}
            onChange={(e) => setForm({ ...form, bucket: e.target.value as Bucket })}
          >
            {BUCKET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="cat-parent"
          label="Parent category"
          helper="Optional. A sub-category's spend rolls up into its parent's total."
        >
          <Select
            id="cat-parent"
            value={form.parentCategoryId}
            onChange={(e) => setForm({ ...form, parentCategoryId: e.target.value })}
          >
            <option value="">None (top level)</option>
            {flat.map(({ node, depth }) => (
              <option key={node._id} value={node._id}>
                {"– ".repeat(depth)}
                {node.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="cat-budget" label="Monthly Budget" hint="Optional">
          <MoneyInput
            id="cat-budget"
            placeholder="0"
            value={form.budgetLimit}
            onChange={(e) => setForm({ ...form, budgetLimit: e.target.value })}
          />
        </Field>

        <FormActions>
          <Button type="submit" busy={create.isPending}>
            Add Category
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}
