"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { ApiError, apiFetch } from "@/lib/api-client";
import type {
  CapitalGainsResponse,
  DeductionSource,
  IncomeSourceRow,
  IncomeType,
  TaxDeductionRow,
  TaxEstimateResponse,
  TaxEstimateResult,
} from "@/lib/api-types";
import {
  financialYearFromDate,
  formatDate,
  formatInr,
  formatUnits,
  recentFinancialYears,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Icon } from "@/components/app/icons";
import {
  Checkbox,
  Field,
  FieldGrid,
  FormActions,
  MoneyInput,
  Segmented,
  Select,
} from "@/components/app/form";
import {
  Amount,
  Bar,
  EmptyState,
  Helper,
  Notice,
  PageHeader,
  Panel,
  PanelFooter,
  PanelHeader,
  Readout,
  ScrollableTable,
  SectionLabel,
  Skeleton,
} from "@/components/app/primitives";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import { useToast } from "@/components/ui/Toast";

/**
 * Sorted · Tax
 *
 * The densest screen in the product, and the only one whose top-line number is
 * a COMPARISON rather than a figure. Everything else here — gains, deductions,
 * income — exists to move that comparison, so it is stated first and the
 * evidence follows.
 *
 * THE RECOMMENDED REGIME IS NOT GREEN. It is marked with a tick, the word
 * "recommended", and the --ink-wash fill the nav rail already uses for the
 * current page. Introducing a fifth colour to say "this one" would break the
 * only colour rule the product has.
 *
 * THE 80C BAR IS A REFERENCE, NOT THE TRUTH. Its denominator is the statutory
 * ₹1,50,000 and its numerator is EVERY section on file, not only 80C — which
 * is exactly what `GET /tax/estimate` does when it pools sections against the
 * same limit. It is drawn as a reference so the two never quietly disagree,
 * and the label says so.
 */

const SECTION_80C_REFERENCE_LIMIT = 150000;

const DEDUCTION_SOURCE_LABELS: Record<DeductionSource, string> = {
  manual: "Added by you",
  auto_elss: "From your ELSS lots",
  auto_ppf: "From your PPF",
};

const ESTIMATE_ROWS: { label: string; key: keyof TaxEstimateResult }[] = [
  { label: "Taxable income", key: "taxableIncome" },
  { label: "Tax on slab income", key: "taxOnSlabIncome" },
  { label: "Tax on capital gains", key: "taxOnCapitalGains" },
  { label: "Before rebate", key: "totalTaxBeforeRebate" },
  { label: "Section 87A rebate", key: "rebateApplied" },
];

export default function TaxPage() {
  const [fy, setFy] = useState(() => financialYearFromDate(new Date()));
  const years = recentFinancialYears(6);

  return (
    <ProtectedLayout>
      <PageHeader
        title="Tax"
        meta={`FY ${fy} · 1 April to 31 March`}
        actions={
          <div className="flex items-center gap-12">
            <label htmlFor="fy-selector" className="font-num text-label uppercase text-dim">
              Financial year
            </label>
            <Select
              id="fy-selector"
              value={fy}
              onChange={(e) => setFy(e.target.value)}
              className="w-[168px] py-10 text-body-s"
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      <div className="flex flex-col gap-22">
        <RegimeComparison fy={fy} />

        {/* Capital gains is short and income is tall, so they share the wide
            column; deductions sits alone in the narrow one. Grouped the other
            way round the page ended with a 700px column of nothing beside a
            column that ran off the screen. */}
        <div className="grid items-start gap-22 xl:grid-cols-[7fr_5fr]">
          <div className="flex min-w-0 flex-col gap-22">
            <CapitalGains fy={fy} />
            <IncomeSources fy={fy} />
          </div>
          <Deductions fy={fy} />
        </div>
      </div>
    </ProtectedLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// The comparison
// ═══════════════════════════════════════════════════════════════════════════

function RegimeComparison({ fy }: { fy: string }) {
  const estimate = useQuery({
    queryKey: ["estimate", fy],
    queryFn: () => apiFetch<TaxEstimateResponse>(`/tax/estimate?fy=${encodeURIComponent(fy)}`),
    retry: false,
  });

  if (estimate.isLoading) {
    return (
      <Panel>
        <PanelHeader title="§ Old regime versus new" meta={`FY ${fy}`} />
        <div className="grid gap-22 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-[220px] w-full rounded-panel opacity-30" />
          ))}
        </div>
      </Panel>
    );
  }

  if (estimate.isError) {
    // A 404 here means one specific, fixable thing: no slab configuration
    // exists for this financial year. Saying "something went wrong" would
    // send the owner looking in the wrong place entirely.
    const missingConfig = estimate.error instanceof ApiError && estimate.error.status === 404;
    return (
      <Notice
        title={
          missingConfig
            ? `No tax slabs are on file for FY ${fy}.`
            : "Could not work out the estimate."
        }
        body={
          missingConfig
            ? "The comparison needs a slab configuration for both regimes before it can be computed. Everything else on this screen still works."
            : "Please try again shortly. The figures below are unaffected."
        }
      />
    );
  }

  const data = estimate.data!;
  const saving = Math.abs(data.old.totalTax - data.new.totalTax);

  return (
    <Panel>
      <PanelHeader
        title="§ Old regime versus new"
        meta={saving > 0 ? `${formatInr(saving)} apart` : "Identical"}
      />
      <div className="grid gap-22 lg:grid-cols-2">
        {(["old", "new"] as const).map((regime) => {
          const result = data[regime];
          const recommended = data.recommendation === regime;
          return (
            <section
              key={regime}
              className={cn(
                "rounded-panel border-panel border-ink p-22",
                // --ink-wash, the same 1.12:1 fill the nav rail uses for the
                // current page. Enough to say "this one" without introducing a
                // colour, and ink on it still measures 14.4:1.
                recommended ? "bg-ink-wash" : "bg-transparent"
              )}
            >
              <div className="flex items-baseline justify-between gap-14">
                <SectionLabel>§ {regime === "old" ? "Old regime" : "New regime"}</SectionLabel>
                {recommended ? (
                  <span className="flex items-center gap-4 font-num text-label uppercase tracking-label text-ink">
                    <Icon name="check" size={12} />
                    Recommended
                  </span>
                ) : null}
              </div>

              <p className="money m-0 mt-12 text-[40px] leading-[1.05] lg:text-figure-2">
                {formatInr(result.totalTax)}
              </p>
              <p className="m-0 mt-4 font-num text-micro uppercase tracking-micro text-dim">
                Total tax
              </p>

              <dl className="m-0 mt-18">
                {ESTIMATE_ROWS.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-baseline justify-between gap-14 border-t border-rule py-8"
                  >
                    <dt className="font-num text-micro uppercase tracking-micro text-dim">
                      {row.label}
                    </dt>
                    <dd className="money m-0 text-body-s">{formatInr(result[row.key])}</dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
      </div>
      <PanelFooter>
        {data.recommendation === "old" ? "The old regime" : "The new regime"} costs{" "}
        {saving > 0 ? `${formatInr(saving)} less` : "the same"} on these numbers
      </PanelFooter>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Capital gains
// ═══════════════════════════════════════════════════════════════════════════

function CapitalGains({ fy }: { fy: string }) {
  const gains = useQuery({
    queryKey: ["capital-gains", fy],
    queryFn: () =>
      apiFetch<CapitalGainsResponse>(`/tax/capital-gains?fy=${encodeURIComponent(fy)}`),
  });

  return (
    <Panel>
      <PanelHeader title="§ Capital gains" meta={`FY ${fy}`} />
      {gains.isLoading ? (
        <div className="flex flex-col gap-12">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[22px] w-full rounded-sm opacity-40" />
          ))}
        </div>
      ) : gains.isError ? (
        <Notice
          title="Could not load capital gains."
          body="Please try again shortly. Nothing has been lost."
        />
      ) : (
        <>
          <div className="grid gap-22 sm:grid-cols-2">
            <Readout
              label="Short term"
              value={gains.data!.totals.stcg}
              sub={`${gains.data!.totals.stcgCount} ${
                gains.data!.totals.stcgCount === 1 ? "sale" : "sales"
              }`}
            />
            <Readout
              label="Long term"
              value={gains.data!.totals.ltcg}
              sub={`${gains.data!.totals.ltcgCount} ${
                gains.data!.totals.ltcgCount === 1 ? "sale" : "sales"
              }`}
            />
          </div>

          {gains.data!.events.length === 0 ? (
            <EmptyState
              className="pb-0"
              title="Nothing sold this year."
              body="A sell row in a trade import is matched FIFO against your oldest lots, and each match lands here as one event."
            />
          ) : (
            /* Same narrow-width treatment as the Investments tables: the held
               dates fold into the symbol cell on a phone rather than sitting
               off-screen behind a scroller. */
            <ScrollableTable label="Capital gains events" className="mt-18">
              <table className="w-full border-collapse text-body-s sm:min-w-[520px]">
                <caption className="sr-only">Capital gains events for FY {fy}</caption>
                <thead>
                  <tr className="border-b border-ink">
                    <th
                      scope="col"
                      className="pb-8 pr-14 text-left font-num text-label font-medium uppercase tracking-label text-dim"
                    >
                      Symbol
                    </th>
                    <th
                      scope="col"
                      className="hidden pb-8 pr-14 text-left font-num text-label font-medium uppercase tracking-label text-dim sm:table-cell"
                    >
                      Held
                    </th>
                    <th
                      scope="col"
                      className="pb-8 pr-14 text-right font-num text-label font-medium uppercase tracking-label text-dim"
                    >
                      Units
                    </th>
                    <th
                      scope="col"
                      className="pb-8 text-right font-num text-label font-medium uppercase tracking-label text-dim"
                    >
                      Gain
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {gains.data!.events.map((event) => (
                    <tr key={event._id} className="border-b border-rule last:border-b-0">
                      <td className="py-10 pr-14 align-top">
                        <span className="block font-medium">{event.symbol}</span>
                        <span className="mt-2 block font-num text-micro uppercase tracking-micro text-dim">
                          {event.classification === "LTCG" ? "Long term" : "Short term"}
                        </span>
                        <span className="mt-2 block font-num text-micro uppercase tracking-micro text-dim sm:hidden">
                          {formatDate(event.buyDate)} to {formatDate(event.sellDate)}
                        </span>
                      </td>
                      <td className="hidden py-10 pr-14 align-top font-num text-micro uppercase tracking-micro text-dim sm:table-cell">
                        {formatDate(event.buyDate)}
                        <span className="mt-2 block">to {formatDate(event.sellDate)}</span>
                      </td>
                      <td className="money py-10 pr-14 text-right align-top">
                        {formatUnits(event.unitsSold)}
                      </td>
                      <td className="py-10 text-right align-top">
                        <Amount className="block">{formatInr(event.gainAmount)}</Amount>
                        <span className="mt-2 block font-num text-micro uppercase tracking-micro text-dim">
                          cost {formatInr(event.costBasis)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          )}
          <PanelFooter>
            Equity rules are the same under both regimes, so these figures do not move the
            comparison above by themselves
          </PanelFooter>
        </>
      )}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Deductions
// ═══════════════════════════════════════════════════════════════════════════

function invalidateEstimate(queryClient: QueryClient, fy: string) {
  // A deduction or an income source changes the dual-regime estimate as well
  // as its own list. Invalidating only the list leaves the headline comparison
  // silently showing a stale number.
  queryClient.invalidateQueries({ queryKey: ["estimate", fy] });
}

function Deductions({ fy }: { fy: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [form, setForm] = useState({ section: "", amount: "" });

  const deductions = useQuery({
    queryKey: ["deductions", fy],
    queryFn: () => apiFetch<TaxDeductionRow[]>(`/tax/deductions?fy=${encodeURIComponent(fy)}`),
  });

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<TaxDeductionRow>("/tax/deductions", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deductions", fy] });
      invalidateEstimate(queryClient, fy);
      setForm({ section: "", amount: "" });
      showToast("Deduction added", "success");
    },
    onError: () => showToast("Could not add that deduction", "error"),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/tax/deductions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deductions", fy] });
      invalidateEstimate(queryClient, fy);
      showToast("Deduction removed", "success");
    },
    onError: (err) =>
      showToast(
        err instanceof ApiError && err.status === 400
          ? "That one is derived from your holdings and updates itself."
          : "Could not remove that deduction",
        "error"
      ),
  });

  const rows = deductions.data ?? [];
  const total = rows.reduce((sum, d) => sum + d.amount, 0);

  return (
    <Panel>
      <PanelHeader title="§ Deductions" meta={`FY ${fy}`} />
      {deductions.isLoading ? (
        <div className="flex flex-col gap-12">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[22px] w-full rounded-sm opacity-40" />
          ))}
        </div>
      ) : deductions.isError ? (
        <Notice
          title="Could not load deductions."
          body="Please try again shortly. Nothing has been lost."
        />
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-14">
            <span className="font-num text-micro uppercase tracking-micro text-dim">
              On file
            </span>
            <Amount>
              {formatInr(total)}{" "}
              <span className="text-dim-2">/ {formatInr(SECTION_80C_REFERENCE_LIMIT)}</span>
            </Amount>
          </div>
          {/* The ink wall means the same thing here as it does on a budget
              row — the fill is clamped and cannot show how far past the line
              this went. It is NOT a warning: being past the 80C reference is a
              good place to be, so the note beside it is --dim, not --alert. */}
          <Bar
            className="mt-8"
            percent={(total / SECTION_80C_REFERENCE_LIMIT) * 100}
            over={total > SECTION_80C_REFERENCE_LIMIT}
            fill="bg-bucket-invest"
            label={`${formatInr(total)} of deductions on file against a ${formatInr(
              SECTION_80C_REFERENCE_LIMIT
            )} section 80C reference limit`}
          />
          <Helper className="mt-10">
            {total > SECTION_80C_REFERENCE_LIMIT
              ? `${formatInr(total - SECTION_80C_REFERENCE_LIMIT)} past the 80C reference. Every section is pooled against that one limit here; the estimate above applies each regime's real caps.`
              : "Every section pooled against the 80C limit, as a reference. The estimate above applies each regime's real caps."}
          </Helper>

          {rows.length === 0 ? (
            <EmptyState
              className="pb-0"
              title="Nothing on file yet."
              body="Add an 80C or 80D figure below. ELSS purchases are picked up from your holdings automatically."
            />
          ) : (
            <ul className="m-0 mt-18 flex list-none flex-col p-0">
              {rows.map((d) => (
                <li
                  key={d._id}
                  className="flex items-center justify-between gap-14 border-t border-rule py-12"
                >
                  <span className="min-w-0">
                    <span className="block text-body-s font-medium">{d.section}</span>
                    <span className="mt-2 block font-num text-micro uppercase tracking-micro text-dim">
                      {DEDUCTION_SOURCE_LABELS[d.source]}
                    </span>
                  </span>
                  <span className="flex items-center gap-14">
                    <Amount>{formatInr(d.amount)}</Amount>
                    {d.source === "manual" ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove the ${d.section} deduction of ${formatInr(d.amount)}?`
                            )
                          ) {
                            remove.mutate(d._id);
                          }
                        }}
                        disabled={remove.isPending}
                        className="rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-alert disabled:opacity-[.55]"
                      >
                        Remove
                      </button>
                    ) : (
                      <span className="font-num text-micro uppercase tracking-micro text-dim">
                        Automatic
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <form
        noValidate
        className="mt-18 flex flex-col gap-14 border-t border-rule pt-18"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.section.trim()) {
            showToast("Enter a section, for example 80C");
            return;
          }
          const amount = Number(form.amount);
          if (form.amount.trim() === "" || Number.isNaN(amount) || amount <= 0) {
            showToast("Enter an amount above zero");
            return;
          }
          create.mutate({ section: form.section.trim(), amount, financialYear: fy });
        }}
      >
        <FieldGrid>
          <Field id="deduction-section" label="Section">
            <Input
              id="deduction-section"
              placeholder="80C"
              value={form.section}
              onChange={(e) => setForm({ ...form, section: e.target.value })}
            />
          </Field>
          <Field id="deduction-amount" label="Amount">
            <MoneyInput
              id="deduction-amount"
              placeholder="150000"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </Field>
        </FieldGrid>
        <FormActions className="mt-0 border-t-0 pt-0">
          <Button type="submit" size="sm" busy={create.isPending}>
            Add Deduction
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Income sources
// ═══════════════════════════════════════════════════════════════════════════

function IncomeSources({ fy }: { fy: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const empty = {
    type: "salary" as IncomeType,
    annualAmount: "",
    basic: "",
    hra: "",
    allowances: "",
    rentPaidAnnual: "",
    isMetro: false,
  };
  const [form, setForm] = useState(empty);

  const sources = useQuery({
    queryKey: ["income-sources", fy],
    queryFn: () => apiFetch<IncomeSourceRow[]>(`/tax/income-sources?fy=${encodeURIComponent(fy)}`),
  });

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<IncomeSourceRow>("/tax/income-sources", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["income-sources", fy] });
      invalidateEstimate(queryClient, fy);
      setForm(empty);
      showToast("Income source added", "success");
    },
    onError: () => showToast("Could not add that income source", "error"),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/tax/income-sources/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["income-sources", fy] });
      invalidateEstimate(queryClient, fy);
      showToast("Income source removed", "success");
    },
    onError: () => showToast("Could not remove that income source", "error"),
  });

  const rows = sources.data ?? [];
  const total = rows.reduce((sum, s) => sum + s.annualAmount, 0);

  return (
    <Panel>
      <PanelHeader
        title="§ Income"
        meta={rows.length > 0 ? formatInr(total) : `FY ${fy}`}
      />
      {sources.isLoading ? (
        <div className="flex flex-col gap-12">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-[22px] w-full rounded-sm opacity-40" />
          ))}
        </div>
      ) : sources.isError ? (
        <Notice
          title="Could not load income sources."
          body="Please try again shortly. Nothing has been lost."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          className="pb-0"
          title="No income on file."
          body="The estimate needs at least one income source before it can say anything useful."
        />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((s) => (
            <li key={s._id} className="border-t border-rule py-12 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-14">
                <span className="text-body-s font-medium">
                  {s.type === "salary" ? "Salary" : "Other income"}
                </span>
                <span className="flex items-center gap-14">
                  <Amount>{formatInr(s.annualAmount)}</Amount>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove this ${s.type === "salary" ? "salary" : "other income"} entry of ${formatInr(
                            s.annualAmount
                          )}?`
                        )
                      ) {
                        remove.mutate(s._id);
                      }
                    }}
                    disabled={remove.isPending}
                    className="rounded-xs bg-transparent p-0 font-sans text-caption text-dim-2 underline underline-offset-[3px] transition-colors duration-hover ease-out hover:text-alert disabled:opacity-[.55]"
                  >
                    Remove
                  </button>
                </span>
              </div>
              {s.type === "salary" && s.breakdown ? (
                <p className="m-0 mt-4 font-num text-micro uppercase tracking-micro text-dim">
                  {[
                    s.breakdown.basic != null ? `Basic ${formatInr(s.breakdown.basic)}` : null,
                    s.breakdown.hra != null ? `HRA ${formatInr(s.breakdown.hra)}` : null,
                    s.breakdown.rentPaidAnnual != null
                      ? `Rent ${formatInr(s.breakdown.rentPaidAnnual)} · ${
                          s.breakdown.isMetro ? "metro" : "non-metro"
                        }`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <form
        noValidate
        className="mt-18 flex flex-col gap-14 border-t border-rule pt-18"
        onSubmit={(e) => {
          e.preventDefault();
          const annualAmount = Number(form.annualAmount);
          if (form.annualAmount.trim() === "" || Number.isNaN(annualAmount) || annualAmount <= 0) {
            showToast("Enter an annual amount above zero");
            return;
          }
          const payload: Record<string, unknown> = {
            type: form.type,
            financialYear: fy,
            annualAmount,
          };
          if (form.type === "salary") {
            const breakdown: Record<string, number | boolean> = {};
            const numeric: [keyof typeof form, string][] = [
              ["basic", "basic"],
              ["hra", "hra"],
              ["allowances", "allowances"],
              ["rentPaidAnnual", "rentPaidAnnual"],
            ];
            for (const [field, key] of numeric) {
              const raw = String(form[field]).trim();
              if (raw === "") continue;
              const value = Number(raw);
              if (Number.isNaN(value)) {
                showToast("The salary breakdown must be numbers");
                return;
              }
              breakdown[key] = value;
            }
            // isMetro only changes the HRA exemption, which needs rent to be
            // computed at all — sending it alone would be noise.
            if (breakdown.rentPaidAnnual !== undefined) breakdown.isMetro = form.isMetro;
            if (Object.keys(breakdown).length > 0) payload.breakdown = breakdown;
          }
          create.mutate(payload);
        }}
      >
        <div className="flex flex-col gap-8">
          <span className="font-sans text-body-s font-medium text-ink">Type</span>
          <Segmented
            name="income-type"
            ariaLabel="Income type"
            value={form.type}
            onChange={(type) => setForm({ ...form, type })}
            options={[
              { value: "salary", label: "Salary" },
              { value: "other", label: "Other" },
            ]}
          />
        </div>

        <Field id="income-amount" label="Annual amount">
          <MoneyInput
            id="income-amount"
            placeholder="1200000"
            value={form.annualAmount}
            onChange={(e) => setForm({ ...form, annualAmount: e.target.value })}
          />
        </Field>

        {form.type === "salary" ? (
          <>
            <FieldGrid>
              <Field id="income-basic" label="Basic" hint="Optional">
                <MoneyInput
                  id="income-basic"
                  value={form.basic}
                  onChange={(e) => setForm({ ...form, basic: e.target.value })}
                />
              </Field>
              <Field id="income-hra" label="HRA" hint="Optional">
                <MoneyInput
                  id="income-hra"
                  value={form.hra}
                  onChange={(e) => setForm({ ...form, hra: e.target.value })}
                />
              </Field>
              <Field id="income-allowances" label="Allowances" hint="Optional">
                <MoneyInput
                  id="income-allowances"
                  value={form.allowances}
                  onChange={(e) => setForm({ ...form, allowances: e.target.value })}
                />
              </Field>
              <Field id="income-rent-paid-annual" label="Rent paid" hint="Optional">
                <MoneyInput
                  id="income-rent-paid-annual"
                  value={form.rentPaidAnnual}
                  onChange={(e) => setForm({ ...form, rentPaidAnnual: e.target.value })}
                />
              </Field>
            </FieldGrid>
            <Checkbox
              id="income-is-metro"
              label="I live in a metro city"
              helper="Changes the HRA exemption from 40% of basic to 50%. Only used when rent is filled in, and only under the old regime."
              checked={form.isMetro}
              onChange={(e) => setForm({ ...form, isMetro: e.target.checked })}
            />
          </>
        ) : null}

        <FormActions className="mt-0 border-t-0 pt-0">
          <Button type="submit" size="sm" busy={create.isPending}>
            Add Income Source
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}
