"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

type AccountType = "bank" | "credit_card" | "ppf" | "cash";

interface Account {
  _id: string;
  type: AccountType;
  institution: string;
  nickname: string;
  currentBalance: number;
  isLiability: boolean;
}

interface BalanceSnapshot {
  _id: string;
  balance: number;
  date: string;
}

// Fixed display order + labels for account groups, independent of whatever
// order the API happens to return accounts in.
const TYPE_GROUPS: { type: AccountType; label: string }[] = [
  { type: "bank", label: "Bank" },
  { type: "credit_card", label: "Credit Card" },
  { type: "ppf", label: "PPF" },
  { type: "cash", label: "Cash" },
];

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function AccountsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: accounts,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiFetch<Account[]>("/accounts"),
  });

  const [form, setForm] = useState({
    type: "bank" as AccountType,
    institution: "",
    nickname: "",
    currentBalance: "",
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<Account>("/accounts", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setForm({ type: "bank", institution: "", nickname: "", currentBalance: "" });
      showToast("Account created", "success");
    },
    onError: () => showToast("Failed to create account", "error"),
  });

  function submitCreateAccount() {
    if (!form.institution.trim()) {
      showToast("Enter an institution name");
      return;
    }
    if (!form.nickname.trim()) {
      showToast("Enter a nickname");
      return;
    }
    const startingBalance = Number(form.currentBalance);
    if (form.currentBalance.trim() === "" || Number.isNaN(startingBalance)) {
      showToast("Enter a valid starting balance");
      return;
    }
    createMutation.mutate({
      type: form.type,
      institution: form.institution,
      nickname: form.nickname,
      currentBalance: startingBalance,
    });
  }

  // Per-account draft input for the "update balance" field, keyed by
  // account id, so editing one account's balance never clobbers another's.
  const [balanceDrafts, setBalanceDrafts] = useState<Record<string, string>>({});
  const [historyAccountId, setHistoryAccountId] = useState<string | null>(null);

  const { data: history, isLoading: isHistoryLoading } = useQuery({
    queryKey: ["balance-history", historyAccountId],
    queryFn: () => apiFetch<BalanceSnapshot[]>(`/accounts/${historyAccountId}/balance-history`),
    enabled: !!historyAccountId,
  });

  const updateBalanceMutation = useMutation({
    mutationFn: ({ id, balance }: { id: string; balance: number }) =>
      apiFetch<Account>(`/accounts/${id}/balance`, {
        method: "POST",
        body: JSON.stringify({ balance }),
      }),
    onSuccess: (_data, variables) => {
      // A single POST /accounts/:id/balance call both updates the account's
      // currentBalance AND appends a BalanceSnapshot on the backend (Task 9),
      // so both caches need to be invalidated from this one mutation.
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["balance-history", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setBalanceDrafts((prev) => ({ ...prev, [variables.id]: "" }));
      showToast("Balance updated", "success");
    },
    onError: () => showToast("Failed to update balance", "error"),
  });

  function submitBalanceUpdate(accountId: string) {
    const raw = balanceDrafts[accountId] ?? "";
    const balance = Number(raw);
    if (raw.trim() === "" || Number.isNaN(balance)) {
      showToast("Enter a valid balance");
      return;
    }
    updateBalanceMutation.mutate({ id: accountId, balance });
  }

  const accountsByType = new Map<AccountType, Account[]>();
  for (const account of accounts ?? []) {
    const bucket = accountsByType.get(account.type) ?? [];
    bucket.push(account);
    accountsByType.set(account.type, bucket);
  }

  return (
    <ProtectedLayout>
      <h1 className="mb-6 text-2xl font-semibold">Accounts</h1>

      <Card className="mb-6">
        <p className="mb-3 font-medium">Add Account</p>
        <div className="flex flex-col gap-3">
          <label htmlFor="acct-type" className="text-sm">
            Type
            <select
              id="acct-type"
              className="mt-1 w-full rounded border px-3 py-2"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}
            >
              <option value="bank">Bank</option>
              <option value="credit_card">Credit Card</option>
              <option value="ppf">PPF</option>
              <option value="cash">Cash</option>
            </select>
          </label>
          <label htmlFor="acct-institution" className="text-sm">
            Institution
            <Input
              id="acct-institution"
              className="mt-1 w-full"
              value={form.institution}
              onChange={(e) => setForm({ ...form, institution: e.target.value })}
            />
          </label>
          <label htmlFor="acct-nickname" className="text-sm">
            Nickname
            <Input
              id="acct-nickname"
              className="mt-1 w-full"
              value={form.nickname}
              onChange={(e) => setForm({ ...form, nickname: e.target.value })}
            />
          </label>
          <label htmlFor="acct-balance" className="text-sm">
            Starting Balance
            <Input
              id="acct-balance"
              className="mt-1 w-full"
              type="number"
              value={form.currentBalance}
              onChange={(e) => setForm({ ...form, currentBalance: e.target.value })}
            />
          </label>
          <Button onClick={submitCreateAccount} disabled={createMutation.isPending}>
            Add Account
          </Button>
        </div>
      </Card>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : isError ? (
        <p className="text-sm text-red-600">Could not load accounts. Please try again shortly.</p>
      ) : (accounts ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">No accounts yet.</p>
      ) : (
        <div className="flex flex-col gap-8">
          {TYPE_GROUPS.filter((group) => (accountsByType.get(group.type) ?? []).length > 0).map(
            (group) => (
              <div key={group.type}>
                <h2 className="mb-3 text-lg font-medium">{group.label}</h2>
                <div className="flex flex-col gap-4">
                  {(accountsByType.get(group.type) ?? []).map((a) => {
                    const isHistoryOpen = historyAccountId === a._id;
                    const balanceDraft = balanceDrafts[a._id] ?? "";
                    return (
                      <Card key={a._id}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{a.nickname}</p>
                            <p className="text-sm text-gray-500">{a.institution}</p>
                          </div>
                          <div className="text-right">
                            <p
                              className={
                                a.isLiability
                                  ? "font-semibold text-red-600"
                                  : "font-semibold text-green-700"
                              }
                            >
                              {formatInr(a.currentBalance)}
                            </p>
                            {a.isLiability && <p className="text-xs text-red-600">Liability</p>}
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <label htmlFor={`balance-${a._id}`} className="sr-only">
                            Update balance for {a.nickname}
                          </label>
                          <Input
                            id={`balance-${a._id}`}
                            className="flex-1"
                            type="number"
                            placeholder="New balance"
                            value={balanceDraft}
                            onChange={(e) =>
                              setBalanceDrafts((prev) => ({ ...prev, [a._id]: e.target.value }))
                            }
                          />
                          <Button
                            onClick={() => submitBalanceUpdate(a._id)}
                            disabled={updateBalanceMutation.isPending}
                          >
                            Update
                          </Button>
                          <Button
                            className="bg-gray-400"
                            onClick={() => setHistoryAccountId(isHistoryOpen ? null : a._id)}
                          >
                            {isHistoryOpen ? "Hide History" : "View History"}
                          </Button>
                        </div>
                        {isHistoryOpen && (
                          <div className="mt-3">
                            {isHistoryLoading ? (
                              <p className="text-sm text-gray-500">Loading history...</p>
                            ) : (history ?? []).length === 0 ? (
                              <p className="text-sm text-gray-500">No balance history yet.</p>
                            ) : (
                              <table className="w-full text-sm">
                                <thead>
                                  <tr>
                                    <th className="text-left font-medium text-gray-500">Date</th>
                                    <th className="text-left font-medium text-gray-500">Balance</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(history ?? [])
                                    .slice()
                                    .sort(
                                      (x, y) =>
                                        new Date(y.date).getTime() - new Date(x.date).getTime()
                                    )
                                    .map((h) => (
                                      <tr key={h._id}>
                                        <td>{new Date(h.date).toLocaleDateString()}</td>
                                        <td>{formatInr(h.balance)}</td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </ProtectedLayout>
  );
}
