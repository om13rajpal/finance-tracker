"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

interface Goal {
  _id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate?: string;
}

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

// Percentage used for both the displayed number and the bar width: capped at
// 100 so an over-funded goal (currentAmount > targetAmount) never overflows
// the bar or shows a nonsensical ">100%" width. targetAmount <= 0 is treated
// as 0% rather than dividing by zero / producing Infinity or NaN.
function progressPercent(currentAmount: number, targetAmount: number): number {
  if (targetAmount <= 0) return 0;
  return Math.min(100, Math.max(0, (currentAmount / targetAmount) * 100));
}

export default function GoalsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: goals,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["goals"],
    queryFn: () => apiFetch<Goal[]>("/goals"),
  });

  const [form, setForm] = useState({ name: "", targetAmount: "", targetDate: "" });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<Goal>("/goals", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      setForm({ name: "", targetAmount: "", targetDate: "" });
      showToast("Goal created", "success");
    },
    onError: () => showToast("Failed to create goal", "error"),
  });

  function submitCreateGoal() {
    if (!form.name.trim()) {
      showToast("Enter a goal name");
      return;
    }
    const targetAmount = Number(form.targetAmount);
    if (form.targetAmount.trim() === "" || Number.isNaN(targetAmount) || targetAmount <= 0) {
      showToast("Enter a valid target amount");
      return;
    }
    createMutation.mutate({
      name: form.name,
      targetAmount,
      targetDate: form.targetDate || undefined,
    });
  }

  // Per-goal draft input for the "update progress" field, keyed by goal id,
  // so editing one goal's current amount never clobbers another's.
  const [progressDrafts, setProgressDrafts] = useState<Record<string, string>>({});

  const updateMutation = useMutation({
    mutationFn: ({ id, currentAmount }: { id: string; currentAmount: number }) =>
      apiFetch<Goal>(`/goals/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ currentAmount }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      setProgressDrafts((prev) => ({ ...prev, [variables.id]: "" }));
      showToast("Progress updated", "success");
    },
    onError: () => showToast("Failed to update progress", "error"),
  });

  function submitProgressUpdate(goalId: string) {
    const raw = progressDrafts[goalId] ?? "";
    const currentAmount = Number(raw);
    if (raw.trim() === "" || Number.isNaN(currentAmount) || currentAmount < 0) {
      showToast("Enter a valid amount");
      return;
    }
    updateMutation.mutate({ id: goalId, currentAmount });
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/goals/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      showToast("Goal deleted", "success");
    },
    onError: () => showToast("Failed to delete goal", "error"),
  });

  function submitDeleteGoal(goal: Goal) {
    if (!window.confirm(`Delete goal "${goal.name}"? This cannot be undone.`)) return;
    deleteMutation.mutate(goal._id);
  }

  return (
    <ProtectedLayout>
      <h1 className="mb-6 text-2xl font-semibold">Goals</h1>

      <Card className="mb-6">
        <p className="mb-3 font-medium">Add Goal</p>
        <div className="flex flex-col gap-3">
          <label htmlFor="goal-name" className="text-sm">
            Name
            <Input
              id="goal-name"
              className="mt-1 w-full"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label htmlFor="goal-target" className="text-sm">
            Target Amount
            <Input
              id="goal-target"
              className="mt-1 w-full"
              type="number"
              value={form.targetAmount}
              onChange={(e) => setForm({ ...form, targetAmount: e.target.value })}
            />
          </label>
          <label htmlFor="goal-date" className="text-sm">
            Target Date (optional)
            <Input
              id="goal-date"
              className="mt-1 w-full"
              type="date"
              value={form.targetDate}
              onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
            />
          </label>
          <Button onClick={submitCreateGoal} disabled={createMutation.isPending}>
            Add Goal
          </Button>
        </div>
      </Card>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : isError ? (
        <p className="text-sm text-red-600">Could not load goals. Please try again shortly.</p>
      ) : (goals ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">No goals yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {(goals ?? []).map((g) => {
            const percent = progressPercent(g.currentAmount, g.targetAmount);
            const progressDraft = progressDrafts[g._id] ?? "";
            return (
              <Card key={g._id}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{g.name}</p>
                    {g.targetDate && (
                      <p className="text-xs text-gray-500">
                        Target date: {new Date(g.targetDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">
                      {formatInr(g.currentAmount)} / {formatInr(g.targetAmount)}
                    </p>
                    <p className="text-xs text-gray-400">{Math.round(percent)}%</p>
                  </div>
                </div>
                <div className="mt-2 h-2 w-full rounded bg-gray-200">
                  <div
                    className="h-2 rounded bg-black"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <label htmlFor={`goal-progress-${g._id}`} className="sr-only">
                    Update progress for {g.name}
                  </label>
                  <Input
                    id={`goal-progress-${g._id}`}
                    className="flex-1"
                    type="number"
                    placeholder="New current amount"
                    value={progressDraft}
                    onChange={(e) =>
                      setProgressDrafts((prev) => ({ ...prev, [g._id]: e.target.value }))
                    }
                  />
                  <Button
                    onClick={() => submitProgressUpdate(g._id)}
                    disabled={updateMutation.isPending}
                  >
                    Update
                  </Button>
                  <Button
                    className="bg-red-600"
                    onClick={() => submitDeleteGoal(g)}
                    disabled={deleteMutation.isPending}
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </ProtectedLayout>
  );
}
