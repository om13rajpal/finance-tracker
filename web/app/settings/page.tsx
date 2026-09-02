"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { API_BASE, apiFetch } from "@/lib/api-client";
import type {
  CategorizationRule,
  CategoryNode,
  EmailSource,
  GmailStatus,
  MatchField,
  MatchType,
  StatementPassword,
} from "@/lib/api-types";
import { flattenCategories, indexCategories, resolveChip } from "@/lib/buckets";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Chip } from "@/components/app/chip";
import { Icon, Tether } from "@/components/app/icons";
import { Field, FieldGrid, FormActions, Select } from "@/components/app/form";
import {
  EmptyState,
  Helper,
  Notice,
  PageHeader,
  Panel,
  PanelFooter,
  PanelHeader,
  RowName,
  SectionLabel,
  Skeleton,
} from "@/components/app/primitives";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import { useToast } from "@/components/ui/Toast";

/**
 * Sorted · Settings
 *
 * Two things worth their own screen, and one download.
 *
 * THE GMAIL CONNECTION IS THE POINT. It is what produces the tether: the
 * dotted mark on every row the parser filed by itself. So this panel is where
 * that mark is explained, drawn at the size it appears elsewhere, next to the
 * switch that turns it on.
 *
 * RULES ARE STATED AS A SENTENCE. "Merchant contains Swiggy → Eating out" reads
 * as the thing it does. And the row shows the CHIP of the category it files
 * into, because that is the outcome you are actually configuring.
 */

const MATCH_FIELD_LABELS: Record<MatchField, string> = { merchant: "Merchant", note: "Note" };
const MATCH_TYPE_LABELS: Record<MatchType, string> = { contains: "contains", exact: "is exactly" };

export default function SettingsPage() {
  return (
    <ProtectedLayout>
      <PageHeader title="Settings" />

      <div className="grid items-start gap-22 xl:grid-cols-[7fr_5fr]">
        <div className="flex min-w-0 flex-col gap-22">
          <RulesPanel />
        </div>
        <div className="flex min-w-0 flex-col gap-22">
          <GmailPanel />
          <TrustedSendersPanel />
          <StatementPasswordsPanel />
          <ExportPanel />
        </div>
      </div>
    </ProtectedLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Categorisation rules
// ═══════════════════════════════════════════════════════════════════════════

function RulesPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const rules = useQuery({
    queryKey: ["categorization-rules"],
    queryFn: () => apiFetch<CategorizationRule[]>("/categorization-rules"),
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<CategoryNode[]>("/categories"),
  });

  const index = useMemo(() => indexCategories(categories.data), [categories.data]);
  const flat = useMemo(() => flattenCategories(categories.data), [categories.data]);

  const [form, setForm] = useState({
    matchField: "merchant" as MatchField,
    matchType: "contains" as MatchType,
    matchValue: "",
    categoryId: "",
  });

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<CategorizationRule>("/categorization-rules", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorization-rules"] });
      setForm({ matchField: "merchant", matchType: "contains", matchValue: "", categoryId: "" });
      showToast("Rule added", "success");
    },
    onError: () => showToast("Could not add that rule", "error"),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/categorization-rules/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorization-rules"] });
      showToast("Rule deleted", "success");
    },
    onError: () => showToast("Could not delete that rule", "error"),
  });

  const rows = rules.data ?? [];

  return (
    <Panel>
      <PanelHeader
        title="§ Filing rules"
        meta={rows.length > 0 ? `${rows.length} · first match wins` : undefined}
      />
      <Helper className="-mt-8 mb-18 max-w-[60ch]">
        Applied to anything that arrives without a category: a manual entry left on auto, a
        statement row, an email the parser read. Rules run in priority order and the first one that
        matches wins.
      </Helper>

      {rules.isLoading ? (
        <div className="flex flex-col gap-12">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[22px] w-full rounded-sm opacity-40" />
          ))}
        </div>
      ) : rules.isError ? (
        <Notice
          title="Could not load your filing rules."
          body="Please try again shortly. Nothing has been lost."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No rules yet."
          body="The fastest way to make one is from a transaction: change its category and tick “always file this merchant here”."
        />
      ) : (
        <div>
          {rows.map((rule) => {
            const entry = index.get(rule.categoryId);
            const spec = resolveChip(rule.categoryId, index);
            return (
              <div
                key={rule._id}
                className="grid grid-cols-row items-center gap-14 border-b border-rule py-12 last:border-b-0"
              >
                <Chip spec={spec} labelled />
                <RowName
                  name={
                    <>
                      {MATCH_FIELD_LABELS[rule.matchField]}{" "}
                      <span className="text-dim-2">{MATCH_TYPE_LABELS[rule.matchType]}</span>{" "}
                      <span className="font-medium">{rule.matchValue}</span>
                    </>
                  }
                  sub={`Files into ${entry?.node.name ?? "a category that no longer exists"} · priority ${rule.priority}`}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete the rule for “${rule.matchValue}”?`)) {
                      remove.mutate(rule._id);
                    }
                  }}
                  disabled={remove.isPending}
                  className="rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-alert disabled:opacity-[.55]"
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}

      <form
        noValidate
        className="mt-18 flex flex-col gap-14 border-t border-rule pt-18"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.matchValue.trim()) {
            showToast("Enter the text to match on");
            return;
          }
          if (!form.categoryId) {
            showToast("Choose the category to file into");
            return;
          }
          create.mutate({
            matchField: form.matchField,
            matchType: form.matchType,
            matchValue: form.matchValue.trim(),
            categoryId: form.categoryId,
          });
        }}
      >
        <SectionLabel>§ Add a rule</SectionLabel>
        <FieldGrid>
          <Field id="rule-field" label="Look at">
            <Select
              id="rule-field"
              value={form.matchField}
              onChange={(e) => setForm({ ...form, matchField: e.target.value as MatchField })}
            >
              <option value="merchant">Merchant</option>
              <option value="note">Note</option>
            </Select>
          </Field>
          <Field id="rule-type" label="Match">
            <Select
              id="rule-type"
              value={form.matchType}
              onChange={(e) => setForm({ ...form, matchType: e.target.value as MatchType })}
            >
              <option value="contains">Contains</option>
              <option value="exact">Is exactly</option>
            </Select>
          </Field>
        </FieldGrid>
        <Field
          id="rule-match"
          label="Text"
          helper="Case does not matter: Swiggy and SWIGGY match the same rows."
        >
          <Input
            id="rule-match"
            placeholder="Swiggy"
            value={form.matchValue}
            onChange={(e) => setForm({ ...form, matchValue: e.target.value })}
          />
        </Field>
        <Field id="rule-category" label="File into">
          <Select
            id="rule-category"
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
          >
            <option value="">Select a category</option>
            {flat.map(({ node, depth }) => (
              <option key={node._id} value={node._id}>
                {"– ".repeat(depth)}
                {node.name}
              </option>
            ))}
          </Select>
        </Field>
        <FormActions className="mt-0 border-t-0 pt-0">
          <Button type="submit" busy={create.isPending}>
            Add Rule
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Gmail
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The OAuth callback redirects to /settings?gmail=connected, and acknowledging
 * that is the difference between "did that work?" and a confirmed round trip.
 *
 * IT LIVES IN ITS OWN COMPONENT BEHIND <Suspense> ON PURPOSE. `useSearchParams`
 * opts the whole route out of static prerendering, and Next 14 fails the BUILD
 * outright ("should be wrapped in a suspense boundary") rather than warning,
 * so calling it at the top of the page took the entire /settings route down.
 * Scoped here, only this one line de-opts.
 */
function ConnectedAcknowledgement() {
  const search = useSearchParams();
  if (search?.get("gmail") !== "connected") return null;
  return (
    <div className="mb-14 flex items-center gap-8 font-num text-label uppercase tracking-label text-ink">
      <Icon name="check" size={13} />
      Just connected
    </div>
  );
}

function GmailPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const status = useQuery({
    queryKey: ["gmail-status"],
    queryFn: () => apiFetch<GmailStatus>("/gmail/status"),
  });

  const disconnect = useMutation({
    mutationFn: () => apiFetch<void>("/gmail/disconnect", { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gmail-status"] });
      showToast("Gmail disconnected", "success");
    },
    onError: () => showToast("Could not disconnect Gmail", "error"),
  });

  const resync = useMutation({
    mutationFn: () => apiFetch<{ ok: true }>("/gmail/resync", { method: "POST" }),
    onSuccess: () => showToast("Gmail resynced: watching for new emails again", "success"),
    onError: () => showToast("Resync failed. Try disconnecting and reconnecting Gmail.", "error"),
  });

  const connected = status.data?.connected ?? false;

  return (
    <Panel>
      <PanelHeader title="§ Your inbox" />

      {/* The tether, drawn at the size it appears on a row, next to the switch
          that creates it. This is the one place the mark gets explained. */}
      <div className="mb-18 rounded-panel border-panel border-ink p-18">
        <SectionLabel className="mb-12">§ What it looks like</SectionLabel>
        <div className="grid w-full grid-cols-row-tether items-center">
          <Tether />
          <Chip spec={{ kind: "bucket", bucket: "fixed_costs" }} />
          <span className="truncate pr-14 text-body-s">Airtel Fiber</span>
          <span className="money whitespace-nowrap text-body-s">−₹1,499</span>
        </div>
      </div>
      <Helper className="-mt-8 mb-18 max-w-[52ch]">
        Connect Gmail and Sorted reads your bank alert emails, pulls out the amount and the
        merchant, and holds each one for you to confirm. Rows it filed carry that dotted mark for
        good, so you always know which numbers you typed and which ones it did.
      </Helper>

      {status.isLoading ? (
        <Skeleton className="h-[22px] w-[180px] rounded-sm opacity-40" />
      ) : status.isError ? (
        <Notice
          title="Could not check the connection."
          body="Please try again shortly."
        />
      ) : (
        <>
          {connected ? (
            <Suspense fallback={null}>
              <ConnectedAcknowledgement />
            </Suspense>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-14">
            <span className="flex items-center gap-10">
              <span
                aria-hidden
                className="grid h-22 w-22 place-items-center rounded-pill border-panel border-ink text-ink"
              >
                <Icon name={connected ? "check" : "mail"} size={12} />
              </span>
              <span className="text-body-s">{connected ? "Connected" : "Not connected"}</span>
            </span>

            {connected ? (
              <span className="flex items-center gap-8">
                <Button
                  variant="ghost"
                  size="sm"
                  busy={resync.isPending}
                  onClick={() => resync.mutate()}
                >
                  Resync
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  busy={disconnect.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Disconnect Gmail? Nothing already filed is removed, but no new emails will be read."
                      )
                    ) {
                      disconnect.mutate();
                    }
                  }}
                >
                  Disconnect
                </Button>
              </span>
            ) : (
              /* A real navigation, not a fetch: /gmail/connect answers with a
                 302 to Google's consent screen, which the browser has to follow
                 itself. An XHR would silently follow it and fail on CORS. */
              <Button asChild size="sm">
                <a href={`${API_BASE}/gmail/connect`}>Connect Gmail</a>
              </Button>
            )}
          </div>
          <PanelFooter>
            Read-only access. Sorted never sends, deletes or replies to anything.
          </PanelFooter>
        </>
      )}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Statement passwords
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Automatic ingestion (bank-alert-email parsing, and a PDF statement arriving
 * as a Gmail attachment) only ever runs for a sender listed here. Everything
 * else is skipped, untouched, no matter what else is configured. Match is the
 * EXACT sender address a message's own "From" header resolves to, never a
 * domain or a substring: a lookalike sender must never be trusted by
 * accident.
 */
function TrustedSendersPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const sources = useQuery({
    queryKey: ["email-sources"],
    queryFn: () => apiFetch<EmailSource[]>("/email-sources"),
  });

  const [form, setForm] = useState({ senderPattern: "", institution: "" });

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<EmailSource>("/email-sources", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-sources"] });
      setForm({ senderPattern: "", institution: "" });
      showToast("Sender trusted", "success");
    },
    onError: () => showToast("Could not save that sender", "error"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/email-sources/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-sources"] });
      showToast("Sender removed", "success");
    },
    onError: () => showToast("Could not remove that sender", "error"),
  });

  const rows = sources.data ?? [];

  return (
    <Panel>
      <PanelHeader title="§ Trusted senders" meta={rows.length > 0 ? `${rows.length}` : undefined} />
      <Helper className="-mt-8 mb-18 max-w-[56ch]">
        The exact email address a statement or alert has to arrive from before Sorted will read
        it automatically. Nothing outside this list is ever touched, no matter what else you have
        configured.
      </Helper>

      {sources.isLoading ? (
        <div className="flex flex-col gap-12">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-[22px] w-full rounded-sm opacity-40" />
          ))}
        </div>
      ) : sources.isError ? (
        <Notice
          title="Could not load your trusted senders."
          body="Please try again shortly. Nothing has been lost."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No senders trusted yet."
          body="Add the exact address your bank's statements or alerts arrive from, and Sorted will start reading them automatically."
        />
      ) : (
        <div>
          {rows.map((entry) => (
            <div
              key={entry._id}
              className="grid grid-cols-[1fr_auto] items-center gap-14 border-b border-rule py-12 last:border-b-0"
            >
              <RowName
                name={entry.institution}
                sub={
                  entry.hasEmailBodyParser
                    ? `${entry.senderPattern} · alerts and statements`
                    : `${entry.senderPattern} · statements only`
                }
              />
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Stop trusting "${entry.senderPattern}"?`)) {
                    remove.mutate(entry._id);
                  }
                }}
                disabled={remove.isPending}
                className="rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-alert disabled:opacity-[.55]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        noValidate
        className="mt-18 flex flex-col gap-14 border-t border-rule pt-18"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.senderPattern.trim() || !form.institution.trim()) {
            showToast("Enter both the sender address and the institution name");
            return;
          }
          create.mutate({
            senderPattern: form.senderPattern.trim(),
            institution: form.institution.trim(),
          });
        }}
      >
        <SectionLabel>§ Trust a sender</SectionLabel>
        <Field id="es-sender" label="Sender address" hint="Exact, not a domain">
          <Input
            id="es-sender"
            placeholder="alerts@hdfcbank.net"
            value={form.senderPattern}
            onChange={(e) => setForm({ ...form, senderPattern: e.target.value })}
          />
        </Field>
        <Field id="es-institution" label="Institution">
          <Input
            id="es-institution"
            placeholder="HDFC Bank"
            value={form.institution}
            onChange={(e) => setForm({ ...form, institution: e.target.value })}
          />
        </Field>
        <FormActions className="mt-0 border-t-0 pt-0">
          <Button type="submit" busy={create.isPending}>
            Trust Sender
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}

/**
 * A flat, unordered list of passwords Sorted tries against any statement PDF,
 * whether uploaded manually on Transactions or arriving automatically as a
 * Gmail attachment from an already-trusted sender. There is deliberately no
 * bank↔password mapping to configure: every stored password is tried, in no
 * particular order, until one unlocks the file.
 */
function StatementPasswordsPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const passwords = useQuery({
    queryKey: ["statement-passwords"],
    queryFn: () => apiFetch<StatementPassword[]>("/statement-passwords"),
  });

  const [form, setForm] = useState({ label: "", password: "" });

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<StatementPassword>("/statement-passwords", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["statement-passwords"] });
      setForm({ label: "", password: "" });
      showToast("Password saved", "success");
    },
    onError: () => showToast("Could not save that password", "error"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/statement-passwords/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["statement-passwords"] });
      showToast("Password removed", "success");
    },
    onError: () => showToast("Could not remove that password", "error"),
  });

  const rows = passwords.data ?? [];

  return (
    <Panel>
      <PanelHeader title="§ Statement passwords" meta={rows.length > 0 ? `${rows.length}` : undefined} />
      <Helper className="-mt-8 mb-18 max-w-[56ch]">
        Every password here is tried, in no particular order, against any statement PDF you upload
        or that arrives automatically from a bank you have already told Sorted to trust. There is no
        need to say which password belongs to which bank.
      </Helper>

      {passwords.isLoading ? (
        <div className="flex flex-col gap-12">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-[22px] w-full rounded-sm opacity-40" />
          ))}
        </div>
      ) : passwords.isError ? (
        <Notice
          title="Could not load your saved passwords."
          body="Please try again shortly. Nothing has been lost."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No passwords saved yet."
          body="Add the password on your bank's e-statement PDF here, once, and Sorted will try it automatically on every statement."
        />
      ) : (
        <div>
          {rows.map((entry) => (
            <div
              key={entry._id}
              className="grid grid-cols-[1fr_auto] items-center gap-14 border-b border-rule py-12 last:border-b-0"
            >
              <RowName name={entry.label || "Untitled password"} sub="Never shown again once saved" />
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Remove "${entry.label || "this password"}"?`)) {
                    remove.mutate(entry._id);
                  }
                }}
                disabled={remove.isPending}
                className="rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-alert disabled:opacity-[.55]"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        noValidate
        className="mt-18 flex flex-col gap-14 border-t border-rule pt-18"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.password.trim()) {
            showToast("Enter the password");
            return;
          }
          create.mutate({
            label: form.label.trim() || undefined,
            password: form.password,
          });
        }}
      >
        <SectionLabel>§ Add a password</SectionLabel>
        <Field id="sp-label" label="Label" hint="Optional">
          <Input
            id="sp-label"
            placeholder="SBI savings statement"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </Field>
        <Field id="sp-password" label="Password">
          <Input
            id="sp-password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <FormActions className="mt-0 border-t-0 pt-0">
          <Button type="submit" busy={create.isPending}>
            Save Password
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════════════

function ExportPanel() {
  return (
    <Panel>
      <PanelHeader title="§ Your data" />
      <Helper className="-mt-8 mb-18 max-w-[52ch]">
        Everything in one JSON file: accounts, transactions, holding lots, goals and recurring
        items. It is yours, and it leaves in a format something else can read.
      </Helper>
      <Button asChild variant="ghost" size="sm" className="self-start">
        <a href={`${API_BASE}/export`} download>
          <Icon name="download" size={15} />
          Download everything
        </a>
      </Button>
      <PanelFooter>
        Categories, filing rules and tax entries are not in the file yet
      </PanelFooter>
    </Panel>
  );
}
