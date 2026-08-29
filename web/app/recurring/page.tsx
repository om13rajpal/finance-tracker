"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

type RecurringType = "expense" | "income";
type Frequency = "monthly" | "weekly" | "yearly" | "custom";
type RecurringStatus = "active" | "paused" | "cancelled";

interface RecurringItem {
  _id: string;
  name: string;
  type: RecurringType;
  amount: number;
  frequency: Frequency;
  nextDueDate: string;
  accountId: string;
  categoryId: string;
  autoCreate: boolean;
  status: RecurringStatus;
}

interface Account {
  _id: string;
  institution: string;
  nickname: string;
}

type CategoryType = "expense" | "income";
type Bucket = "fixed_costs" | "investments" | "savings" | "guilt_free";

interface CategoryNode {
  _id: string;
  name: string;
  type: CategoryType;
  bucket: Bucket;
  children: CategoryNode[];
}

function flattenForSelect(nodes: CategoryNode[], depth = 0): { node: CategoryNode; depth: number }[] {
  return nodes.flatMap((n) => [{ node: n, depth }, ...flattenForSelect(n.children, depth + 1)]);
}

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

const FREQUENCY_LABELS: Record<Frequency, string> = {
  monthly: "Monthly",
  weekly: "Weekly",
  yearly: "Yearly",
  custom: "Custom",
};

const STATUS_LABELS: Record<RecurringStatus, string> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};

function statusBadgeClassName(status: RecurringStatus): string {
  if (status === "active") return "bg-green-100 text-green-800";
  if (status === "paused") return "bg-yellow-100 text-yellow-800";
  return "bg-gray-200 text-gray-600";
}

export default function RecurringPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: items,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["recurring"],
    queryFn: () => apiFetch<RecurringItem[]>("/recurring"),
  });

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiFetch<Account[]>("/accounts"),
  });

  const { data: categoryTree } = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<CategoryNode[]>("/categories"),
  });
  const flatCategories = flattenForSelect(categoryTree ?? []);

  const [form, setForm] = useState({
    name: "",
    type: "expense" as RecurringType,
    amount: "",
    frequency: "monthly" as Frequency,
    nextDueDate: new Date().toISOString().slice(0, 10),
    accountId: "",
    categoryId: "",
    autoCreate: false,
  });

  // Invalidating ["dashboard"] here (in addition to ["recurring"]) matters because
  // RecurringTransaction feeds computeGuiltFreeMoney's "planned" figure directly
  // (api/src/modules/dashboard/guilt-free.service.ts) - without it, the client-side
  // cached dashboard query would keep showing a stale "planned" value even after the
  // server-side Redis cache was cleared by the corresponding backend fix.
  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<RecurringItem>("/recurring", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setForm({
        name: "",
        type: "expense",
        amount: "",
        frequency: "monthly",
        nextDueDate: new Date().toISOString().slice(0, 10),
        accountId: "",
        categoryId: "",
        autoCreate: false,
      });
      showToast("Recurring item created", "success");
    },
    onError: () => showToast("Failed to create recurring item", "error"),
  });

  function submitCreate() {
    if (!form.name.trim()) {
      showToast("Enter a name");
      return;
    }
    const amount = Number(form.amount);
    if (form.amount.trim() === "" || Number.isNaN(amount) || amount <= 0) {
      showToast("Enter a valid amount");
      return;
    }
    if (!form.nextDueDate) {
      showToast("Choose a next due date");
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
    createMutation.mutate({
      name: form.name,
      type: form.type,
      amount,
      frequency: form.frequency,
      nextDueDate: form.nextDueDate,
      accountId: form.accountId,
      categoryId: form.categoryId,
      autoCreate: form.autoCreate,
    });
  }

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: RecurringStatus }) =>
      apiFetch<RecurringItem>(`/recurring/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      const label =
        variables.status === "paused"
          ? "Recurring item paused"
          : variables.status === "active"
            ? "Recurring item resumed"
            : "Recurring item cancelled";
      showToast(label, "success");
    },
    onError: () => showToast("Failed to update recurring item", "error"),
  });

  function submitCancel(item: RecurringItem) {
    if (!window.confirm(`Cancel "${item.name}"? This cannot be undone.`)) return;
    statusMutation.mutate({ id: item._id, status: "cancelled" });
  }

  return (
    <ProtectedLayout>
      <h1 className="mb-6 text-2xl font-semibold">Recurring</h1>

      <Card className="mb-6">
        <p className="mb-3 font-medium">Add Recurring Item</p>
        <div className="flex flex-col gap-3">
          <label htmlFor="rec-name" className="text-sm">
            Name
            <Input
              id="rec-name"
              className="mt-1 w-full"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label htmlFor="rec-type" className="text-sm">
            Type
            <select
              id="rec-type"
              className="mt-1 w-full rounded border px-3 py-2"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as RecurringType })}
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </label>
          <label htmlFor="rec-amount" className="text-sm">
            Amount
            <Input
              id="rec-amount"
              className="mt-1 w-full"
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </label>
          <label htmlFor="rec-frequency" className="text-sm">
            Frequency
            <select
              id="rec-frequency"
              className="mt-1 w-full rounded border px-3 py-2"
              value={form.frequency}
              onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}
            >
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label htmlFor="rec-next-due" className="text-sm">
            Next Due Date
            <Input
              id="rec-next-due"
              className="mt-1 w-full"
              type="date"
              value={form.nextDueDate}
              onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })}
            />
          </label>
          <label htmlFor="rec-account" className="text-sm">
            Account
            <select
              id="rec-account"
              className="mt-1 w-full rounded border px-3 py-2"
              value={form.accountId}
              onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            >
              <option value="">Select an account</option>
              {(accounts ?? []).map((a) => (
                <option key={a._id} value={a._id}>
                  {a.institution} · {a.nickname}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="rec-category" className="text-sm">
            Category
            <select
              id="rec-category"
              className="mt-1 w-full rounded border px-3 py-2"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              <option value="">Select a category</option>
              {flatCategories.map(({ node, depth }) => (
                <option key={node._id} value={node._id}>
                  {"  ".repeat(depth)}
                  {node.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="rec-autocreate" className="flex items-center gap-2 text-sm">
            <input
              id="rec-autocreate"
              type="checkbox"
              checked={form.autoCreate}
              onChange={(e) => setForm({ ...form, autoCreate: e.target.checked })}
            />
            Auto-create transaction when due
          </label>
          <Button onClick={submitCreate} disabled={createMutation.isPending}>
            Add
          </Button>
        </div>
      </Card>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : isError ? (
        <p className="text-sm text-red-600">Could not load recurring items. Please try again shortly.</p>
      ) : (items ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">No recurring items yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {(items ?? []).map((item) => (
            <Card key={item._id}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm text-gray-500">
                    {formatInr(item.amount)} · {FREQUENCY_LABELS[item.frequency]} · next{" "}
                    {new Date(item.nextDueDate).toLocaleDateString()} ·{" "}
                    {item.autoCreate ? "Auto-create on" : "Auto-create off"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-2 py-1 text-xs font-medium ${statusBadgeClassName(item.status)}`}
                  >
                    {STATUS_LABELS[item.status]}
                  </span>
                  {item.status === "active" && (
                    <Button
                      className="bg-gray-500"
                      onClick={() => statusMutation.mutate({ id: item._id, status: "paused" })}
                      disabled={statusMutation.isPending}
                    >
                      Pause
                    </Button>
                  )}
                  {item.status === "paused" && (
                    <Button
                      onClick={() => statusMutation.mutate({ id: item._id, status: "active" })}
                      disabled={statusMutation.isPending}
                    >
                      Resume
                    </Button>
                  )}
                  {item.status !== "cancelled" && (
                    <Button
                      className="bg-red-600"
                      onClick={() => submitCancel(item)}
                      disabled={statusMutation.isPending}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </ProtectedLayout>
  );
}
