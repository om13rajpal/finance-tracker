"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api-client";
import type { Account, AccountType, BalanceSnapshot } from "@/lib/api-types";
import { formatDate, formatInr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Icon, type IconName } from "@/components/app/icons";
import { Field, FieldGrid, FormActions, MoneyInput, Select } from "@/components/app/form";
import {
  Amount,
  EmptyState,
  Helper,
  Notice,
  PageHeader,
  Panel,
  PanelFooter,
  PanelHeader,
  Readout,
  RowName,
  SectionLabel,
  Skeleton,
  Sparkline,
} from "@/components/app/primitives";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import { useToast } from "@/components/ui/Toast";

/**
 * Sorted · Accounts
 *
 * Where net worth comes from. The dashboard prints one figure; this screen is
 * the arithmetic behind it, grouped the way the API's own `AccountType` enum
 * groups it.
 *
 * ACCOUNT TYPE IS NOT A BUCKET. The four bucket fills mean "this is where money
 * GOES"; an account is where money SITS. So account rows carry ink-stroke
 * glyphs in the chip's circular form with no fill, the same vocabulary the
 * nav rail uses for routes, for the same reason. Reusing a bucket colour here
 * would be the colour system telling a lie.
 *
 * A CREDIT CARD IS A LIABILITY. `computeNetWorth` subtracts `Math.abs(balance)`
 * for `type === "credit_card"` regardless of the sign it is stored with, so
 * that is exactly how it is shown: as a negative, with the word "owed".
 */

const TYPE_META: Record<AccountType, { label: string; icon: IconName; note: string }> = {
  bank: { label: "Bank", icon: "accounts", note: "Counts towards net worth in full." },
  credit_card: {
    label: "Credit card",
    icon: "card",
    note: "Subtracted from net worth. A balance here is money you owe.",
  },
  ppf: { label: "PPF", icon: "vault", note: "Locked in, but yours. Counts in full." },
  cash: { label: "Cash", icon: "cash", note: "Whatever is in the wallet." },
};

const TYPE_ORDER: AccountType[] = ["bank", "credit_card", "ppf", "cash"];

export default function AccountsPage() {
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiFetch<Account[]>("/accounts"),
  });

  // Memoised for identity: see the note in budgets/page.tsx. A fresh `[]`
  // each render silently defeats the grouping memo below.
  const list = useMemo(() => accounts.data ?? [], [accounts.data]);
  const grouped = useMemo(() => {
    const map = new Map<AccountType, Account[]>();
    for (const a of list) {
      const bucket = map.get(a.type) ?? [];
      bucket.push(a);
      map.set(a.type, bucket);
    }
    return map;
  }, [list]);

  const assets = list
    .filter((a) => a.type !== "credit_card")
    .reduce((sum, a) => sum + a.currentBalance, 0);
  const owed = list
    .filter((a) => a.type === "credit_card")
    .reduce((sum, a) => sum + Math.abs(a.currentBalance), 0);

  return (
    <ProtectedLayout>
      <PageHeader
        title="Accounts"
        meta={list.length > 0 ? `${list.length} open` : undefined}
      />

      <div className="grid items-start gap-22 xl:grid-cols-[7fr_5fr]">
        <div className="flex min-w-0 flex-col gap-22">
          {!accounts.isLoading && !accounts.isError && list.length > 0 ? (
            <Panel>
              <PanelHeader title="§ What it adds up to" />
              <div className="grid gap-22 sm:grid-cols-3">
                <Readout label="In accounts" value={assets} />
                <Readout label="Owed on cards" value={owed > 0 ? `−${formatInr(owed)}` : formatInr(0)} />
                <Readout label="Net" value={assets - owed} />
              </div>
              <PanelFooter>Holdings are counted separately, on Investments</PanelFooter>
            </Panel>
          ) : null}

          {accounts.isLoading ? (
            <Panel>
              <PanelHeader title="§ Accounts" />
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="grid grid-cols-row items-center gap-14 border-b border-rule py-14 last:border-b-0"
                >
                  <Skeleton className="h-chip w-chip rounded-pill opacity-40" />
                  <Skeleton className="h-[15px] w-[160px] rounded-sm" />
                  <Skeleton className="h-[15px] w-[100px] rounded-sm" />
                </div>
              ))}
            </Panel>
          ) : accounts.isError ? (
            <Notice
              title="Could not load your accounts."
              body="Please try again shortly. Nothing has been lost."
            />
          ) : list.length === 0 ? (
            <Panel>
              <EmptyState
                title="No accounts yet."
                body="Add the first one on the right: a bank account, a card, your PPF, or the cash in your wallet. Net worth starts counting from there."
              />
            </Panel>
          ) : (
            /* ONE panel, with the type groups as headings inside it.
               Four separate panels for five accounts put three 1.5px frames
               and three footnotes around a total of five rows: the chrome
               outweighed the ledger. This reads as one list that happens to be
               grouped, which is what it is. */
            <Panel className="reveal-in" data-stagger>
              <PanelHeader title="§ Accounts" />
              {(() => {
                let staggerIndex = -1;
                return TYPE_ORDER.filter((type) => (grouped.get(type) ?? []).length > 0).map(
                  (type, groupIndex) => {
                    const meta = TYPE_META[type];
                    const rows = grouped.get(type) ?? [];
                    const subtotal = rows.reduce(
                      (sum, a) =>
                        sum + (type === "credit_card" ? -Math.abs(a.currentBalance) : a.currentBalance),
                      0
                    );
                    return (
                      <section key={type} className={cn(groupIndex > 0 && "mt-22")}>
                        <div className="flex items-baseline justify-between gap-14 border-b border-ink pb-8">
                          <SectionLabel>§ {meta.label}</SectionLabel>
                          <span className="money text-body-s">{formatInr(subtotal)}</span>
                        </div>
                        {rows.map((account) => {
                          staggerIndex++;
                          return (
                            <AccountRow key={account._id} account={account} icon={meta.icon} staggerIndex={staggerIndex} />
                          );
                        })}
                      {/* Only the card group gets a note. "Counts towards net
                          worth in full" under Bank, PPF and Cash is three lines
                          saying the obvious thing three times; the one that is
                          NOT obvious is that a card subtracts. */}
                      {type === "credit_card" ? (
                        <p className="m-0 pt-8 font-num text-micro uppercase tracking-micro text-dim">
                          {meta.note}
                        </p>
                      ) : null}
                    </section>
                  );
                  }
                );
              })()}
            </Panel>
          )}
        </div>

        <div className="xl:sticky xl:top-32">
          <AddAccountPanel />
        </div>
      </div>
    </ProtectedLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// One account
// ═══════════════════════════════════════════════════════════════════════════

function AccountRow({
  account,
  icon,
  staggerIndex,
}: {
  account: Account;
  icon: IconName;
  staggerIndex?: number;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const isCard = account.type === "credit_card";
  const displayed = isCard ? -Math.abs(account.currentBalance) : account.currentBalance;

  const history = useQuery({
    queryKey: ["balance-history", account._id],
    queryFn: () => apiFetch<BalanceSnapshot[]>(`/accounts/${account._id}/balance-history`),
    enabled: open,
  });

  const updateBalance = useMutation({
    mutationFn: (balance: number) =>
      apiFetch<Account>(`/accounts/${account._id}/balance`, {
        method: "POST",
        body: JSON.stringify({ balance }),
      }),
    onSuccess: () => {
      // One POST both updates `currentBalance` AND appends a BalanceSnapshot,
      // so both caches have to be invalidated from this single mutation, plus
      // the dashboard, whose net worth just moved.
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["balance-history", account._id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setDraft("");
      showToast("Balance updated", "success");
    },
    onError: () => showToast("Could not update that balance", "error"),
  });

  const remove = useMutation({
    mutationFn: () => apiFetch<void>(`/accounts/${account._id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      showToast("Account deleted", "success");
    },
    onError: () => showToast("Could not delete that account", "error"),
  });

  // Oldest → newest, which is the order a line has to be drawn in. The API
  // sorts ascending already; sorting again costs nothing and means this does
  // not silently invert if that ever changes.
  const series = (history.data ?? [])
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div
      className={cn("border-b border-rule last:border-b-0", staggerIndex !== undefined && "row-stagger")}
      style={staggerIndex !== undefined ? { ["--i" as string]: staggerIndex } : undefined}
    >
      <div className="grid grid-cols-row items-center gap-14 py-14">
        <span className="grid h-chip w-chip place-items-center rounded-pill border-panel border-ink text-ink">
          <Icon name={icon} size={17} />
        </span>
        <RowName name={account.nickname} sub={account.institution} />
        <span className="flex items-center gap-14">
          <span className="text-right">
            <Amount className="block text-body">{formatInr(displayed)}</Amount>
            {isCard ? (
              <span className="block font-num text-micro uppercase tracking-micro text-dim">
                Owed
              </span>
            ) : null}
          </span>
          {/* The accessible name carries the account.
              Five rows each offering a button called only "Update" gives a
              screen-reader user a list of five identical controls with no way
              to tell which account they belong to. The visible label stays
              short; the announced one does not. */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`${open ? "Close" : "Update"} ${account.nickname}`}
            className="rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-ink"
          >
            {open ? "Close" : "Update"}
          </button>
        </span>
      </div>

      {open ? (
        <div className="reveal-in mb-14 flex flex-col gap-18 rounded-panel border-panel border-ink p-18">
          <form
            noValidate
            className="flex flex-wrap items-end gap-12"
            onSubmit={(e) => {
              e.preventDefault();
              const value = Number(draft);
              if (draft.trim() === "" || Number.isNaN(value)) {
                showToast("Enter a valid balance");
                return;
              }
              updateBalance.mutate(value);
            }}
          >
            <div className="min-w-[200px] flex-1">
              <label htmlFor={`balance-${account._id}`} className="sr-only">
                Update balance for {account.nickname}
              </label>
              <MoneyInput
                id={`balance-${account._id}`}
                placeholder={isCard ? "Amount owed today" : "Balance today"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <Button type="submit" size="sm" busy={updateBalance.isPending}>
              Update
            </Button>
          </form>

          <Helper>
            {isCard
              ? "Enter what you owe as a positive number: it is subtracted from net worth either way."
              : "Each update is kept, so the line below is your real balance history."}
          </Helper>

          <div>
            <SectionLabel>§ Balance history</SectionLabel>
            {history.isLoading ? (
              <Skeleton className="mt-12 h-[28px] w-full rounded-sm opacity-40" />
            ) : history.isError ? (
              <Helper className="mt-8">Could not load the history for this account.</Helper>
            ) : series.length === 0 ? (
              <Helper className="mt-8">
                Nothing recorded yet. The next update you make starts the line.
              </Helper>
            ) : (
              <>
                {series.length > 1 ? (
                  <Sparkline
                    className="mt-12"
                    values={series.map((s) => s.balance)}
                    label={`Balance from ${formatInr(series[0].balance)} on ${formatDate(
                      series[0].date
                    )} to ${formatInr(series[series.length - 1].balance)} on ${formatDate(
                      series[series.length - 1].date
                    )}`}
                  />
                ) : null}
                <ul className="m-0 mt-12 flex list-none flex-col p-0">
                  {series
                    .slice()
                    .reverse()
                    .slice(0, 6)
                    .map((snapshot) => (
                      <li
                        key={snapshot._id}
                        className="flex items-baseline justify-between gap-14 border-t border-rule py-8"
                      >
                        <span className="font-num text-micro uppercase tracking-micro text-dim">
                          {formatDate(snapshot.date)}
                        </span>
                        <Amount>{formatInr(snapshot.balance)}</Amount>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  `Delete "${account.nickname}"? Its transactions stay, but this cannot be undone.`
                )
              ) {
                remove.mutate();
              }
            }}
            disabled={remove.isPending}
            className="self-start rounded-xs bg-transparent p-0 font-sans text-caption text-alert underline underline-offset-[3px] disabled:opacity-[.55]"
          >
            Delete this account
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Add
// ═══════════════════════════════════════════════════════════════════════════

function AddAccountPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [form, setForm] = useState({
    type: "bank" as AccountType,
    institution: "",
    nickname: "",
    currentBalance: "",
  });

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<Account>("/accounts", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setForm({ type: "bank", institution: "", nickname: "", currentBalance: "" });
      showToast("Account added", "success");
    },
    onError: () => showToast("Could not create that account", "error"),
  });

  return (
    <Panel>
      <PanelHeader title="§ Add an account" />
      <form
        noValidate
        className="flex flex-col gap-14"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.institution.trim()) {
            showToast("Enter the institution");
            return;
          }
          if (!form.nickname.trim()) {
            showToast("Give it a nickname");
            return;
          }
          const balance = Number(form.currentBalance);
          if (form.currentBalance.trim() === "" || Number.isNaN(balance)) {
            showToast("Enter a valid starting balance");
            return;
          }
          create.mutate({
            type: form.type,
            institution: form.institution.trim(),
            nickname: form.nickname.trim(),
            currentBalance: balance,
          });
        }}
      >
        <Field
          id="acct-type"
          label="Type"
          helper={TYPE_META[form.type].note}
        >
          <Select
            id="acct-type"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}
          >
            {TYPE_ORDER.map((type) => (
              <option key={type} value={type}>
                {TYPE_META[type].label}
              </option>
            ))}
          </Select>
        </Field>

        <FieldGrid>
          <Field id="acct-institution" label="Institution">
            <Input
              id="acct-institution"
              placeholder="HDFC Bank"
              value={form.institution}
              onChange={(e) => setForm({ ...form, institution: e.target.value })}
            />
          </Field>
          <Field id="acct-nickname" label="Nickname">
            <Input
              id="acct-nickname"
              placeholder="Salary account"
              value={form.nickname}
              onChange={(e) => setForm({ ...form, nickname: e.target.value })}
            />
          </Field>
        </FieldGrid>

        <Field
          id="acct-balance"
          label="Starting Balance"
          helper={
            form.type === "credit_card"
              ? "What you owe on it right now, as a positive number."
              : "What is in it right now."
          }
        >
          <MoneyInput
            id="acct-balance"
            placeholder="0"
            value={form.currentBalance}
            onChange={(e) => setForm({ ...form, currentBalance: e.target.value })}
          />
        </Field>

        <FormActions>
          <Button type="submit" busy={create.isPending}>
            Add Account
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}
