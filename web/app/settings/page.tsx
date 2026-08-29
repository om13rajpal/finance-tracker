"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

type MatchField = "merchant" | "note";
type MatchType = "contains" | "exact";

interface CategorizationRule {
  _id: string;
  matchField: MatchField;
  matchType: MatchType;
  matchValue: string;
  categoryId: string;
  priority: number;
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

const MATCH_FIELD_LABELS: Record<MatchField, string> = {
  merchant: "Merchant",
  note: "Note",
};

const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  contains: "contains",
  exact: "is exactly",
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: rules,
    isLoading: rulesLoading,
    isError: rulesError,
  } = useQuery({
    queryKey: ["categorization-rules"],
    queryFn: () => apiFetch<CategorizationRule[]>("/categorization-rules"),
  });

  const { data: categoryTree } = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<CategoryNode[]>("/categories"),
  });
  const flatCategories = flattenForSelect(categoryTree ?? []);
  const categoryNameById = new Map(flatCategories.map(({ node }) => [node._id, node.name]));

  const {
    data: gmailStatus,
    isLoading: gmailLoading,
    isError: gmailError,
  } = useQuery({
    queryKey: ["gmail-status"],
    queryFn: () => apiFetch<{ connected: boolean }>("/gmail/status"),
  });

  const [ruleForm, setRuleForm] = useState({
    matchField: "merchant" as MatchField,
    matchType: "contains" as MatchType,
    matchValue: "",
    categoryId: "",
  });

  const createRuleMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<CategorizationRule>("/categorization-rules", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorization-rules"] });
      setRuleForm({ matchField: "merchant", matchType: "contains", matchValue: "", categoryId: "" });
      showToast("Categorization rule created", "success");
    },
    onError: () => showToast("Failed to create categorization rule", "error"),
  });

  function submitCreateRule() {
    if (!ruleForm.matchValue.trim()) {
      showToast("Enter a value to match on");
      return;
    }
    if (!ruleForm.categoryId) {
      showToast("Choose a category");
      return;
    }
    createRuleMutation.mutate({
      matchField: ruleForm.matchField,
      matchType: ruleForm.matchType,
      matchValue: ruleForm.matchValue,
      categoryId: ruleForm.categoryId,
    });
  }

  const deleteRuleMutation = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/categorization-rules/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorization-rules"] });
      showToast("Categorization rule deleted", "success");
    },
    onError: () => showToast("Failed to delete categorization rule", "error"),
  });

  function submitDeleteRule(rule: CategorizationRule) {
    if (!window.confirm(`Delete this rule ("${rule.matchValue}")? This cannot be undone.`)) return;
    deleteRuleMutation.mutate(rule._id);
  }

  const disconnectMutation = useMutation({
    mutationFn: () => apiFetch<void>("/gmail/disconnect", { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gmail-status"] });
      showToast("Gmail disconnected", "success");
    },
    onError: () => showToast("Failed to disconnect Gmail", "error"),
  });

  function submitDisconnectGmail() {
    if (!window.confirm("Disconnect Gmail? Auto-ingestion of email transactions will stop.")) return;
    disconnectMutation.mutate();
  }

  return (
    <ProtectedLayout>
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>

      <Card className="mb-6">
        <p className="mb-3 font-medium">Categorization Rules</p>
        <div className="mb-4 flex flex-col gap-3">
          <label htmlFor="rule-field" className="text-sm">
            Field
            <select
              id="rule-field"
              className="mt-1 w-full rounded border px-3 py-2"
              value={ruleForm.matchField}
              onChange={(e) => setRuleForm({ ...ruleForm, matchField: e.target.value as MatchField })}
            >
              <option value="merchant">Merchant</option>
              <option value="note">Note</option>
            </select>
          </label>
          <label htmlFor="rule-type" className="text-sm">
            Match Type
            <select
              id="rule-type"
              className="mt-1 w-full rounded border px-3 py-2"
              value={ruleForm.matchType}
              onChange={(e) => setRuleForm({ ...ruleForm, matchType: e.target.value as MatchType })}
            >
              <option value="contains">Contains</option>
              <option value="exact">Is exactly</option>
            </select>
          </label>
          <label htmlFor="rule-match" className="text-sm">
            Value
            <Input
              id="rule-match"
              className="mt-1 w-full"
              placeholder="e.g. Starbucks"
              value={ruleForm.matchValue}
              onChange={(e) => setRuleForm({ ...ruleForm, matchValue: e.target.value })}
            />
          </label>
          <label htmlFor="rule-category" className="text-sm">
            Category
            <select
              id="rule-category"
              className="mt-1 w-full rounded border px-3 py-2"
              value={ruleForm.categoryId}
              onChange={(e) => setRuleForm({ ...ruleForm, categoryId: e.target.value })}
            >
              <option value="">Select a category</option>
              {flatCategories.map(({ node, depth }) => (
                <option key={node._id} value={node._id}>
                  {"  ".repeat(depth)}
                  {node.name}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={submitCreateRule} disabled={createRuleMutation.isPending}>
            Add Rule
          </Button>
        </div>

        {rulesLoading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : rulesError ? (
          <p className="text-sm text-red-600">Could not load categorization rules. Please try again shortly.</p>
        ) : (rules ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">No categorization rules yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(rules ?? []).map((r) => (
              <li key={r._id} className="flex items-center justify-between text-sm">
                <span>
                  {MATCH_FIELD_LABELS[r.matchField]} {MATCH_TYPE_LABELS[r.matchType]} &quot;{r.matchValue}&quot; &rarr;{" "}
                  {categoryNameById.get(r.categoryId) ?? r.categoryId}
                </span>
                <Button
                  className="bg-red-600"
                  onClick={() => submitDeleteRule(r)}
                  disabled={deleteRuleMutation.isPending}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mb-6">
        <p className="mb-3 font-medium">Gmail Auto-Ingestion</p>
        {gmailLoading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : gmailError ? (
          <p className="text-sm text-red-600">Could not load Gmail connection status. Please try again shortly.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-gray-500">
              Status: {gmailStatus?.connected ? "Connected" : "Not connected"}
            </p>
            {gmailStatus?.connected ? (
              <Button
                className="bg-red-600"
                onClick={submitDisconnectGmail}
                disabled={disconnectMutation.isPending}
              >
                Disconnect
              </Button>
            ) : (
              <a href="/api/gmail/connect">
                <Button>Connect Gmail</Button>
              </a>
            )}
          </>
        )}
      </Card>

      <Card>
        <p className="mb-3 font-medium">Data Export</p>
        <p className="mb-3 text-sm text-gray-500">
          Download all of your data (accounts, transactions, holdings, goals, and recurring items) as JSON.
        </p>
        <a href="/api/export">
          <Button>Download my data (JSON)</Button>
        </a>
      </Card>
    </ProtectedLayout>
  );
}
