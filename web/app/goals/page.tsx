"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api-client";
import type { Goal } from "@/lib/api-types";
import { BUCKET_META } from "@/lib/buckets";
import { formatDate, formatInr, relativeDays } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Chip } from "@/components/app/chip";
import { Icon } from "@/components/app/icons";
import { DateInput, Field, FormActions, MoneyInput } from "@/components/app/form";
import {
  Amount,
  Bar,
  BarSkeleton,
  EmptyState,
  Helper,
  Notice,
  PageHeader,
  Panel,
  PanelFooter,
  PanelHeader,
  Readout,
  Skeleton,
} from "@/components/app/primitives";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import { useToast } from "@/components/ui/Toast";

/**
 * Sorted · Goals
 *
 * A goal is money set aside for something named, which is precisely the
 * `savings` bucket, so every bar on this screen is savings blue. That is not a
 * decorative choice: it is the one place in the product where a bucket colour
 * means "this is what that bucket is FOR", and it makes the Budgets screen's
 * savings row and this screen visibly the same idea.
 *
 * A REACHED GOAL IS NOT AN ERROR. The bar clamps at 100% and the row says
 * "reached" in words. Over-funding is fine and common: you do not get warned
 * for saving too much.
 */

function percentOf(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.max(0, (current / target) * 100));
}

export default function GoalsPage() {
  const goals = useQuery({
    queryKey: ["goals"],
    queryFn: () => apiFetch<Goal[]>("/goals"),
  });

  const list = useMemo(() => goals.data ?? [], [goals.data]);
  const saved = list.reduce((sum, g) => sum + g.currentAmount, 0);
  const target = list.reduce((sum, g) => sum + g.targetAmount, 0);
  const reached = list.filter((g) => g.targetAmount > 0 && g.currentAmount >= g.targetAmount).length;

  return (
    <ProtectedLayout>
      <PageHeader
        title="Goals"
        meta={list.length > 0 ? `${list.length} · ${reached} reached` : undefined}
      />

      <div className="grid items-start gap-22 xl:grid-cols-[7fr_5fr]">
        <div className="flex min-w-0 flex-col gap-22">
          {!goals.isLoading && !goals.isError && list.length > 0 ? (
            <Panel>
              <PanelHeader title="§ Set aside" />
              <div className="grid gap-22 sm:grid-cols-3">
                <Readout label="Saved so far" value={saved} />
                <Readout label="Aiming for" value={target} />
                <Readout
                  label="Still to go"
                  value={Math.max(0, target - saved)}
                  sub={target > 0 ? `${Math.round((saved / target) * 100)}% of the way` : undefined}
                />
              </div>
              <PanelFooter>
                Goals are tracked by hand, nothing here moves on its own
              </PanelFooter>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title="§ Goals" />
            {goals.isLoading ? (
              <div>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex flex-col gap-12 border-b border-rule py-14 last:border-b-0">
                    <Skeleton className="h-[15px] w-[180px] rounded-sm" />
                    <BarSkeleton />
                  </div>
                ))}
              </div>
            ) : goals.isError ? (
              <Notice
                title="Could not load your goals."
                body="Please try again shortly. Nothing has been lost."
              />
            ) : list.length === 0 ? (
              <EmptyState
                title="No goals yet."
                body="Name the thing you are saving for and how much it costs. A goal with a name gets funded; a vague intention to save does not."
              />
            ) : (
              <div className="reveal-in" data-stagger>
                {list.map((goal, i) => (
                  <GoalRow key={goal._id} goal={goal} staggerIndex={i} />
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="xl:sticky xl:top-32">
          <AddGoalPanel />
        </div>
      </div>
    </ProtectedLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// One goal
// ═══════════════════════════════════════════════════════════════════════════

function GoalRow({ goal, staggerIndex }: { goal: Goal; staggerIndex?: number }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  const percent = percentOf(goal.currentAmount, goal.targetAmount);
  const done = goal.targetAmount > 0 && goal.currentAmount >= goal.targetAmount;
  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);

  const update = useMutation({
    mutationFn: (currentAmount: number) =>
      apiFetch<Goal>(`/goals/${goal._id}`, {
        method: "PATCH",
        body: JSON.stringify({ currentAmount }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      setDraft("");
      setEditing(false);
      showToast("Progress updated", "success");
    },
    onError: () => showToast("Could not update that goal", "error"),
  });

  const remove = useMutation({
    mutationFn: () => apiFetch<void>(`/goals/${goal._id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      showToast("Goal deleted", "success");
    },
    onError: () => showToast("Could not delete that goal", "error"),
  });

  return (
    <div
      className={cn("border-b border-rule py-14 last:border-b-0 last:pb-0", staggerIndex !== undefined && "row-stagger")}
      style={staggerIndex !== undefined ? { ["--i" as string]: staggerIndex } : undefined}
    >
      <div className="grid grid-cols-row items-center gap-x-14 gap-y-10">
        <Chip spec={{ kind: "bucket", bucket: "savings" }} labelled />
        <span className="flex min-w-0 flex-wrap items-baseline gap-10">
          <span className="truncate text-body-s font-medium">{goal.name}</span>
          {done ? (
            <span className="flex items-center gap-4 font-num text-micro uppercase tracking-micro text-ink">
              <Icon name="check" size={12} />
              Reached
            </span>
          ) : goal.targetDate ? (
            <span className="font-num text-micro uppercase tracking-micro text-dim">
              {formatDate(goal.targetDate)} · {relativeDays(goal.targetDate)}
            </span>
          ) : null}
        </span>
        <Amount>
          {formatInr(goal.currentAmount)}{" "}
          <span className="text-dim-2">/ {formatInr(goal.targetAmount)}</span>
        </Amount>

        <Bar
          className="col-start-2 col-end-4"
          percent={percent}
          fill={BUCKET_META.savings.fill}
          live
          label={`${goal.name}: ${formatInr(goal.currentAmount)} of ${formatInr(
            goal.targetAmount
          )}, ${Math.round(percent)} percent`}
        />

        <div className="col-start-2 col-end-4 flex flex-wrap items-center justify-between gap-12">
          <span className="font-num text-micro uppercase tracking-micro text-dim">
            {done ? "Fully funded" : `${formatInr(remaining)} to go · ${Math.round(percent)}%`}
          </span>
          {/* The editor is BEHIND a toggle, matching the Accounts row.
              Four goals meant four permanently-open text inputs and eight
              buttons on a screen whose actual job is to show four bars: the
              controls outweighed the content, and a goal is something you top
              up once a month, not something you edit while reading. */}
          {!editing ? (
            <div className="flex items-center gap-14">
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-expanded={false}
                className="rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-ink"
              >
                Update progress
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete "${goal.name}"? This cannot be undone.`)) remove.mutate();
                }}
                disabled={remove.isPending}
                className={cn(
                  "rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px]",
                  "transition-colors duration-hover ease-out hover:text-alert disabled:opacity-[.55]"
                )}
              >
                Delete
              </button>
            </div>
          ) : (
          <form
            noValidate
            className="reveal-in flex items-center gap-12"
            onSubmit={(e) => {
              e.preventDefault();
              const value = Number(draft);
              if (draft.trim() === "" || Number.isNaN(value) || value < 0) {
                showToast("Enter an amount of zero or more");
                return;
              }
              update.mutate(value);
            }}
          >
            <label htmlFor={`goal-progress-${goal._id}`} className="sr-only">
              Update progress for {goal.name}
            </label>
            <MoneyInput
              id={`goal-progress-${goal._id}`}
              placeholder="New total saved"
              autoFocus
              className="w-[170px] px-14 py-8 text-body-s"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button type="submit" size="sm" busy={update.isPending}>
              Save
            </Button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft("");
              }}
              className="rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-ink"
            >
              Cancel
            </button>
          </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Add
// ═══════════════════════════════════════════════════════════════════════════

function AddGoalPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [form, setForm] = useState({ name: "", targetAmount: "", targetDate: "" });

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<Goal>("/goals", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      setForm({ name: "", targetAmount: "", targetDate: "" });
      showToast("Goal added", "success");
    },
    onError: () => showToast("Could not create that goal", "error"),
  });

  return (
    <Panel>
      <PanelHeader title="§ Add a goal" />
      <form
        noValidate
        className="flex flex-col gap-14"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim()) {
            showToast("Give the goal a name");
            return;
          }
          const targetAmount = Number(form.targetAmount);
          if (form.targetAmount.trim() === "" || Number.isNaN(targetAmount) || targetAmount <= 0) {
            showToast("Enter a target above zero");
            return;
          }
          create.mutate({
            name: form.name.trim(),
            targetAmount,
            ...(form.targetDate ? { targetDate: form.targetDate } : {}),
          });
        }}
      >
        <Field id="goal-name" label="Name">
          <Input
            id="goal-name"
            placeholder="Japan, April"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>

        <Field id="goal-target" label="Target Amount">
          <MoneyInput
            id="goal-target"
            placeholder="250000"
            value={form.targetAmount}
            onChange={(e) => setForm({ ...form, targetAmount: e.target.value })}
          />
        </Field>

        <Field id="goal-date" label="Target date" hint="Optional">
          <DateInput
            id="goal-date"
            value={form.targetDate}
            onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
          />
        </Field>

        <Helper>
          Progress is yours to move. Nothing on this screen is deducted from an account: a goal is
          a promise you are keeping track of, not a transfer.
        </Helper>

        <FormActions>
          <Button type="submit" busy={create.isPending}>
            Add Goal
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}
