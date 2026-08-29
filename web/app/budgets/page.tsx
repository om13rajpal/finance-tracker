"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

type CategoryType = "expense" | "income";
type Bucket = "fixed_costs" | "investments" | "savings" | "guilt_free";

interface CategoryNode {
  _id: string;
  name: string;
  type: CategoryType;
  bucket: Bucket;
  budgetLimit: number;
  children: CategoryNode[];
}

// Matches `BudgetVsSpendRow` from Task 18's `GET /dashboard` (api/src/modules/dashboard/dashboard.service.ts):
// one row per TOP-LEVEL expense category only. A sub-category's own transactions are
// rolled into its parent's `spent` total server-side and never get their own row here.
interface BudgetVsSpendRow {
  categoryId: string;
  name: string;
  budgetLimit: number;
  spent: number;
}

interface DashboardData {
  budgetVsSpend: BudgetVsSpendRow[];
}

const BUCKET_LABELS: Record<Bucket, string> = {
  fixed_costs: "Fixed Costs",
  investments: "Investments",
  savings: "Savings",
  guilt_free: "Guilt-Free",
};

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function flattenForSelect(
  nodes: CategoryNode[],
  depth = 0
): { node: CategoryNode; depth: number }[] {
  return nodes.flatMap((n) => [{ node: n, depth }, ...flattenForSelect(n.children, depth + 1)]);
}

export default function BudgetsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: categories,
    isLoading: isCategoriesLoading,
    isError: isCategoriesError,
  } = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<CategoryNode[]>("/categories"),
  });

  const { data: dashboard } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<DashboardData>("/dashboard"),
  });

  const spendByCategory = new Map(
    (dashboard?.budgetVsSpend ?? []).map((row) => [row.categoryId, row])
  );

  const [form, setForm] = useState({
    name: "",
    type: "expense" as CategoryType,
    bucket: "guilt_free" as Bucket,
    parentCategoryId: "",
    budgetLimit: "",
  });

  const createMutation = useMutation({
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
    onError: () => showToast("Failed to add category", "error"),
  });

  const updateBudgetMutation = useMutation({
    mutationFn: ({ id, budgetLimit }: { id: string; budgetLimit: number }) =>
      apiFetch(`/categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ budgetLimit }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: () => showToast("Failed to update budget", "error"),
  });

  function handleCreate() {
    if (!form.name.trim()) {
      showToast("Enter a category name");
      return;
    }
    createMutation.mutate({
      name: form.name.trim(),
      type: form.type,
      bucket: form.bucket,
      parentCategoryId: form.parentCategoryId || undefined,
      budgetLimit: form.budgetLimit ? Number(form.budgetLimit) : 0,
    });
  }

  function renderNode(node: CategoryNode, depth: number) {
    const row = spendByCategory.get(node._id);
    const pct = row && row.budgetLimit > 0 ? Math.min(100, (row.spent / row.budgetLimit) * 100) : 0;

    return (
      <div key={node._id}>
        <div
          style={{ marginLeft: depth * 20 }}
          className="flex flex-col gap-1 border-b py-3 last:border-b-0"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">{node.name}</span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {BUCKET_LABELS[node.bucket]}
              </span>
              <span className="text-xs text-gray-400">{node.type}</span>
            </div>
            <label htmlFor={`budget-${node._id}`} className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Budget</span>
              <Input
                id={`budget-${node._id}`}
                aria-label={`Monthly budget for ${node.name}`}
                type="number"
                defaultValue={node.budgetLimit}
                className="w-28"
                onBlur={(e) => {
                  const value = Number(e.target.value);
                  if (Number.isNaN(value)) return;
                  if (value !== node.budgetLimit) {
                    updateBudgetMutation.mutate({ id: node._id, budgetLimit: value });
                  }
                }}
              />
            </label>
          </div>
          {row ? (
            <div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Spent {formatInr(row.spent)}</span>
                <span>Budget {formatInr(row.budgetLimit)}</span>
              </div>
              <div className="h-2 w-full rounded bg-gray-200">
                <div
                  className={pct >= 100 ? "h-2 rounded bg-red-600" : "h-2 rounded bg-black"}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          ) : depth > 0 ? (
            <p className="text-xs text-gray-400">
              Spend rolls up into the parent category&apos;s total.
            </p>
          ) : null}
        </div>
        {node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  return (
    <ProtectedLayout>
      <h1 className="mb-6 text-2xl font-semibold">Budgets</h1>

      <Card className="mb-6">
        <p className="mb-3 font-medium">Add Category</p>
        <div className="flex flex-col gap-3">
          <label htmlFor="cat-name" className="text-sm">
            Name
            <Input
              id="cat-name"
              className="mt-1 w-full"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label htmlFor="cat-type" className="text-sm">
            Type
            <select
              id="cat-type"
              className="mt-1 w-full rounded border px-3 py-2"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as CategoryType })}
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </label>
          <label htmlFor="cat-bucket" className="text-sm">
            Bucket
            <select
              id="cat-bucket"
              className="mt-1 w-full rounded border px-3 py-2"
              value={form.bucket}
              onChange={(e) => setForm({ ...form, bucket: e.target.value as Bucket })}
            >
              <option value="fixed_costs">Fixed Costs</option>
              <option value="investments">Investments</option>
              <option value="savings">Savings</option>
              <option value="guilt_free">Guilt-Free</option>
            </select>
          </label>
          <label htmlFor="cat-parent" className="text-sm">
            Parent Category (optional, makes this a sub-category)
            <select
              id="cat-parent"
              className="mt-1 w-full rounded border px-3 py-2"
              value={form.parentCategoryId}
              onChange={(e) => setForm({ ...form, parentCategoryId: e.target.value })}
            >
              <option value="">None (top-level)</option>
              {flattenForSelect(categories ?? []).map(({ node, depth }) => (
                <option key={node._id} value={node._id}>
                  {"  ".repeat(depth)}
                  {depth > 0 ? "– " : ""}
                  {node.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="cat-budget" className="text-sm">
            Monthly Budget
            <Input
              id="cat-budget"
              className="mt-1 w-full"
              type="number"
              value={form.budgetLimit}
              onChange={(e) => setForm({ ...form, budgetLimit: e.target.value })}
            />
          </label>
          <Button onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Adding..." : "Add Category"}
          </Button>
        </div>
      </Card>

      <Card>
        <p className="mb-3 font-medium">Categories</p>
        {isCategoriesLoading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : isCategoriesError || !categories ? (
          <p className="text-sm text-red-600">
            Could not load categories. Please try again shortly.
          </p>
        ) : categories.length === 0 ? (
          <p className="text-sm text-gray-500">No categories yet. Add one above to get started.</p>
        ) : (
          categories.map((c) => renderNode(c, 0))
        )}
      </Card>
    </ProtectedLayout>
  );
}
