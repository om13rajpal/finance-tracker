"use client";

import { useState } from "react";
import {
  InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch, ApiError, API_BASE } from "@/lib/api-client";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

interface Transaction {
  _id: string;
  accountId: string;
  categoryId: string | null;
  amount: number;
  date: string;
  note?: string;
  merchant?: string;
}

interface PendingTransaction {
  _id: string;
  accountId: string | null;
  categoryId: string | null;
  amount: number;
  date: string;
  note?: string;
  merchant?: string;
  source: string;
}

interface Account {
  _id: string;
  nickname: string;
}

interface CategoryNode {
  _id: string;
  name: string;
  children: CategoryNode[];
}

interface TransactionsPage {
  items: Transaction[];
  nextCursor: string | null;
}

interface ImportBatchResult {
  rowResults: { row: number; status: "success" | "failed"; reason?: string }[];
}

function flattenCategories(nodes: CategoryNode[]): CategoryNode[] {
  return nodes.flatMap((n) => [n, ...flattenCategories(n.children)]);
}

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function TransactionsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiFetch<Account[]>("/accounts"),
  });
  const { data: categoryTree } = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<CategoryNode[]>("/categories"),
  });
  const categories = flattenCategories(categoryTree ?? []);

  const { data: pending } = useQuery({
    queryKey: ["pending-transactions"],
    queryFn: () => apiFetch<PendingTransaction[]>("/pending-transactions"),
  });

  const {
    data: transactionsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isTransactionsLoading,
  } = useInfiniteQuery({
    queryKey: ["transactions"],
    queryFn: ({ pageParam }) =>
      apiFetch<TransactionsPage>(
        pageParam ? `/transactions?cursor=${encodeURIComponent(pageParam)}` : "/transactions"
      ),
    initialPageParam: undefined as string | undefined,
    // The API returns `nextCursor: null` on the last page. TanStack Query's
    // `hasNextPage` is `getNextPageParam(...) !== undefined`, so a returned
    // `null` would be treated as "there IS a next page (with param null)"
    // and `fetchNextPage` would re-request the first page forever. Coercing
    // `null` to `undefined` here is what makes `hasNextPage` correctly go
    // false once the API signals there's nothing left.
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const transactions = transactionsData?.pages.flatMap((p) => p.items) ?? [];

  const [form, setForm] = useState({
    accountId: "",
    categoryId: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    note: "",
    merchant: "",
  });

  const [csvAccountId, setCsvAccountId] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<Transaction>("/transactions", { method: "POST", body: JSON.stringify(payload) }),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ["transactions"] });
      const previous = queryClient.getQueryData<InfiniteData<TransactionsPage>>(["transactions"]);

      const optimisticTx: Transaction = {
        _id: `temp-${Date.now()}`,
        accountId: payload.accountId as string,
        categoryId: (payload.categoryId as string) || null,
        amount: payload.amount as number,
        date: payload.date as string,
        note: payload.note as string,
        merchant: payload.merchant as string,
      };

      queryClient.setQueryData<InfiniteData<TransactionsPage>>(["transactions"], (old) => {
        if (!old) {
          return { pages: [{ items: [optimisticTx], nextCursor: null }], pageParams: [undefined] };
        }
        const [firstPage, ...restPages] = old.pages;
        return {
          ...old,
          pages: [{ ...firstPage, items: [optimisticTx, ...firstPage.items] }, ...restPages],
        };
      });

      return { previous };
    },
    onError: (err, _payload, context) => {
      queryClient.setQueryData(["transactions"], context?.previous);
      // POST /transactions returns 409 when Task 11's cross-source duplicate
      // detection (findLikelyDuplicate) matches an existing transaction on the
      // same account/amount/date. That's a distinct, expected outcome from a
      // genuine failure (e.g. the API being unreachable) and deserves its own
      // message so the user isn't left thinking something broke.
      if (err instanceof ApiError && err.status === 409) {
        showToast(
          "This looks like a duplicate of an existing transaction, so it wasn't added.",
          "error"
        );
        return;
      }
      showToast("Failed to add transaction", "error");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  function submitManualEntry() {
    if (!form.accountId) {
      showToast("Select an account before adding a transaction");
      return;
    }
    const amount = Number(form.amount);
    if (form.amount.trim() === "" || Number.isNaN(amount)) {
      showToast("Enter a valid amount");
      return;
    }
    createMutation.mutate({
      accountId: form.accountId,
      categoryId: form.categoryId || undefined,
      amount,
      date: form.date,
      note: form.note,
      merchant: form.merchant,
    });
    setForm((f) => ({ ...f, amount: "", note: "", merchant: "" }));
  }

  const [pendingAccountChoice, setPendingAccountChoice] = useState<Record<string, string>>({});

  const confirmMutation = useMutation({
    mutationFn: ({ id, accountId }: { id: string; accountId?: string }) =>
      apiFetch(`/pending-transactions/${id}/confirm`, {
        method: "POST",
        body: JSON.stringify(accountId ? { accountId } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      showToast("Transaction confirmed", "success");
    },
    onError: () => showToast("Failed to confirm transaction", "error"),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/pending-transactions/${id}/reject`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-transactions"] });
      showToast("Transaction rejected", "success");
    },
    onError: () => showToast("Failed to reject transaction", "error"),
  });

  // Inline per-row category editing in the confirmed-transactions list below.
  // `editingCategoryTxId` tracks which row currently has its picker open;
  // `categoryEditChoice`/`createRuleChoice` hold the in-progress selections
  // keyed by transaction id, mirroring the pending-review section's
  // `pendingAccountChoice` pattern above.
  const [editingCategoryTxId, setEditingCategoryTxId] = useState<string | null>(null);
  const [categoryEditChoice, setCategoryEditChoice] = useState<Record<string, string>>({});
  const [createRuleChoice, setCreateRuleChoice] = useState<Record<string, boolean>>({});

  const updateCategoryMutation = useMutation({
    mutationFn: ({
      id,
      categoryId,
      createRule,
      matchValue,
    }: {
      id: string;
      categoryId: string;
      createRule: boolean;
      matchValue?: string;
    }) =>
      apiFetch(`/transactions/${id}`, {
        method: "PATCH",
        // PATCH /transactions/:id (transactions.routes.ts) only creates a
        // categorization rule when `createRule` and `matchValue` are both
        // present alongside `categoryId` — so when the "always categorize
        // like this" checkbox is unchecked, omit those fields entirely
        // rather than sending them as false/empty.
        body: JSON.stringify(
          createRule && matchValue ? { categoryId, createRule: true, matchValue } : { categoryId }
        ),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      showToast("Category updated", "success");
      setEditingCategoryTxId(null);
    },
    onError: () => showToast("Failed to update category", "error"),
  });

  function submitCategoryEdit(t: Transaction) {
    const categoryId = categoryEditChoice[t._id];
    if (!categoryId) {
      showToast("Select a category");
      return;
    }
    const wantsRule = createRuleChoice[t._id] ?? false;
    updateCategoryMutation.mutate({
      id: t._id,
      categoryId,
      createRule: wantsRule,
      matchValue: wantsRule ? t.merchant : undefined,
    });
  }

  const [importResult, setImportResult] = useState<ImportBatchResult | null>(null);

  async function handleCsvUpload(file: File) {
    if (!csvAccountId) {
      showToast("Select an account before importing a statement");
      return;
    }
    setIsImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("accountId", csvAccountId);
      // Uses `fetch` directly rather than `apiFetch`: apiFetch always sets
      // `Content-Type: application/json`, which would break this multipart
      // upload (the browser needs to set its own multipart boundary).
      const res = await fetch(`${API_BASE}/transactions/import`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Import failed: ${res.status}`);
      }
      const batch: ImportBatchResult = await res.json();
      setImportResult(batch);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      showToast((e as Error).message || "Failed to import CSV", "error");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <ProtectedLayout>
      <h1 className="mb-6 text-2xl font-semibold">Transactions</h1>

      <Card className="mb-6">
        <p className="mb-3 font-medium">Add Transaction</p>
        <div className="flex flex-col gap-3">
          <label htmlFor="tx-account" className="text-sm">
            Account
            <select
              id="tx-account"
              className="mt-1 w-full rounded border px-3 py-2"
              value={form.accountId}
              onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            >
              <option value="">Select account</option>
              {(accounts ?? []).map((a) => (
                <option key={a._id} value={a._id}>
                  {a.nickname}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="tx-category" className="text-sm">
            Category
            <select
              id="tx-category"
              className="mt-1 w-full rounded border px-3 py-2"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            >
              <option value="">Auto-categorize</option>
              {categories.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="tx-amount" className="text-sm">
            Amount (negative for expense)
            <Input
              id="tx-amount"
              className="mt-1 w-full"
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </label>
          <label htmlFor="tx-date" className="text-sm">
            Date
            <Input
              id="tx-date"
              className="mt-1 w-full"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
          <label htmlFor="tx-merchant" className="text-sm">
            Merchant
            <Input
              id="tx-merchant"
              className="mt-1 w-full"
              value={form.merchant}
              onChange={(e) => setForm({ ...form, merchant: e.target.value })}
            />
          </label>
          <label htmlFor="tx-note" className="text-sm">
            Note
            <Input
              id="tx-note"
              className="mt-1 w-full"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          <Button onClick={submitManualEntry} disabled={createMutation.isPending}>
            Add
          </Button>
        </div>
      </Card>

      <Card className="mb-6">
        <p className="mb-3 font-medium">Import CSV Statement</p>
        <label htmlFor="csv-account" className="text-sm">
          Import Account
          <select
            id="csv-account"
            className="mt-1 mb-3 w-full rounded border px-3 py-2"
            value={csvAccountId}
            onChange={(e) => setCsvAccountId(e.target.value)}
          >
            <option value="">Select account</option>
            {(accounts ?? []).map((a) => (
              <option key={a._id} value={a._id}>
                {a.nickname}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="csv-file" className="text-sm">
          Statement file (CSV)
          <input
            id="csv-file"
            className="mt-1 block"
            type="file"
            accept=".csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setCsvFileName(file.name);
                handleCsvUpload(file);
              }
              e.target.value = "";
            }}
          />
        </label>
        {isImporting && <p className="mt-2 text-sm text-gray-500">Importing {csvFileName}...</p>}
        {importResult && (
          <p className="mt-2 text-sm text-gray-600">
            {importResult.rowResults.filter((r) => r.status === "success").length} imported,{" "}
            {importResult.rowResults.filter((r) => r.status === "failed").length} failed
          </p>
        )}
      </Card>

      {(pending ?? []).length > 0 && (
        <Card className="mb-6">
          <p className="mb-3 font-medium">Pending Review</p>
          <ul className="flex flex-col gap-2">
            {(pending ?? []).map((p) => {
              // Task 22's Gmail-parsed pending transactions may have no
              // accountId yet — the API's confirm route 400s without one, so
              // the reviewer must pick an account here before confirming.
              const needsAccount = !p.accountId;
              const chosenAccountId = pendingAccountChoice[p._id] ?? "";
              return (
                <li
                  key={p._id}
                  className="flex flex-col gap-2 border-b pb-2 text-sm last:border-b-0"
                >
                  <div className="flex items-center justify-between">
                    <span>
                      {p.merchant || p.note || "—"} — {formatInr(Math.abs(p.amount))} on{" "}
                      {new Date(p.date).toLocaleDateString()}
                    </span>
                    <span className="flex gap-2">
                      <Button
                        onClick={() =>
                          confirmMutation.mutate({
                            id: p._id,
                            accountId: needsAccount ? chosenAccountId : undefined,
                          })
                        }
                        disabled={(needsAccount && !chosenAccountId) || confirmMutation.isPending}
                      >
                        Confirm
                      </Button>
                      <Button className="bg-gray-400" onClick={() => rejectMutation.mutate(p._id)}>
                        Reject
                      </Button>
                    </span>
                  </div>
                  {needsAccount && (
                    <label htmlFor={`pending-account-${p._id}`} className="text-xs text-gray-500">
                      Account (required to confirm)
                      <select
                        id={`pending-account-${p._id}`}
                        className="mt-1 w-full rounded border px-2 py-1"
                        value={chosenAccountId}
                        onChange={(e) =>
                          setPendingAccountChoice((prev) => ({ ...prev, [p._id]: e.target.value }))
                        }
                      >
                        <option value="">Select account</option>
                        {(accounts ?? []).map((a) => (
                          <option key={a._id} value={a._id}>
                            {a.nickname}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card>
        <p className="mb-3 font-medium">History</p>
        {isTransactionsLoading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : transactions.length === 0 ? (
          <p className="text-sm text-gray-500">No transactions yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {transactions.map((t) => {
              const categoryName = categories.find((c) => c._id === t.categoryId)?.name;
              const isEditing = editingCategoryTxId === t._id;
              const chosenCategoryId = categoryEditChoice[t._id] ?? t.categoryId ?? "";
              const wantsRule = createRuleChoice[t._id] ?? false;
              return (
                <li
                  key={t._id}
                  className="flex flex-col gap-2 border-b pb-2 text-sm last:border-b-0"
                >
                  <div className="flex items-center justify-between">
                    <span>
                      {t.merchant || t.note || "—"} on {new Date(t.date).toLocaleDateString()} —{" "}
                      {categoryName ?? "Uncategorized"}
                    </span>
                    <span className="flex items-center gap-2">
                      {formatInr(t.amount)}
                      <Button
                        className="bg-gray-200 text-black"
                        onClick={() => {
                          setEditingCategoryTxId(isEditing ? null : t._id);
                          if (!isEditing) {
                            setCategoryEditChoice((prev) => ({
                              ...prev,
                              [t._id]: prev[t._id] ?? t.categoryId ?? "",
                            }));
                          }
                        }}
                      >
                        {isEditing ? "Cancel" : "Edit category"}
                      </Button>
                    </span>
                  </div>
                  {isEditing && (
                    <div className="flex flex-col gap-2 text-xs text-gray-500">
                      <label htmlFor={`tx-category-edit-${t._id}`}>
                        Category
                        <select
                          id={`tx-category-edit-${t._id}`}
                          className="mt-1 w-full rounded border px-2 py-1"
                          value={chosenCategoryId}
                          onChange={(e) =>
                            setCategoryEditChoice((prev) => ({ ...prev, [t._id]: e.target.value }))
                          }
                        >
                          <option value="">Select category</option>
                          {categories.map((c) => (
                            <option key={c._id} value={c._id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label
                        htmlFor={`tx-create-rule-${t._id}`}
                        className="flex items-center gap-2"
                      >
                        <input
                          id={`tx-create-rule-${t._id}`}
                          type="checkbox"
                          checked={wantsRule}
                          disabled={!t.merchant}
                          onChange={(e) =>
                            setCreateRuleChoice((prev) => ({ ...prev, [t._id]: e.target.checked }))
                          }
                        />
                        Always categorize {t.merchant || "this merchant"} like this
                      </label>
                      <Button
                        onClick={() => submitCategoryEdit(t)}
                        disabled={updateCategoryMutation.isPending || !chosenCategoryId}
                      >
                        Save
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {hasNextPage && (
          <Button
            className="mt-4 bg-gray-200 text-black"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "Loading..." : "Load more"}
          </Button>
        )}
      </Card>
    </ProtectedLayout>
  );
}
