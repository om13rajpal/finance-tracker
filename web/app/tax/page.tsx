"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

// Mirrors api/src/lib/financialYear.ts's financialYearFromDate exactly (Apr 1 -
// Mar 31 Indian financial year, UTC date math) so the frontend's default FY
// matches what the backend would compute for "today". This is only used to
// pre-fill the FY selector — the user can freely change it, and every section
// below reads from that shared value rather than recomputing its own.
function financialYearFromDate(date: Date): string {
  const month = date.getUTCMonth();
  const year = date.getUTCFullYear();
  const startYear = month >= 3 ? year : year - 1;
  const endYearShort = ((startYear + 1) % 100).toString().padStart(2, "0");
  return `${startYear}-${endYearShort}`;
}

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

// Section 80C's statutory limit (Rs. 1,50,000). This is ONLY used as the
// denominator for the frontend progress bar — a visual aid so the user can see
// how close they are to maxing out 80C. The real cap enforcement (capping
// deductions per-regime when computing the tax estimate) happens server-side
// in GET /tax/estimate (Task 8), which is the source of truth. Kept in sync
// with the old regime's `section80CLimit`; if a Union Budget changes it, this
// bar's denominator has to be updated alongside the TaxSlabConfig document.
//
// The bar's numerator sums deductions across ALL sections, not just 80C. That
// deliberately mirrors what the backend estimate does (it pools every section
// into one total against this same limit) rather than contradicting it — see
// the KNOWN SIMPLIFICATION note in api/src/modules/tax/estimate.routes.ts.
const SECTION_80C_REFERENCE_LIMIT = 150000;

// Same clamp pattern as the core build's /goals page: caps the bar at 100% so
// a user who has logged more than Rs. 1,50,000 in deductions never overflows
// the bar, and treats a non-positive reference limit as 0% rather than
// dividing by zero.
function progressPercent(amount: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.max(0, (amount / limit) * 100));
}

type Classification = "STCG" | "LTCG";

interface SellEventRow {
  _id: string;
  symbol: string;
  buyDate: string;
  sellDate: string;
  unitsSold: number;
  costBasis: number;
  sellPrice: number;
  gainAmount: number;
  classification: Classification;
}

interface CapitalGainsResponse {
  events: SellEventRow[];
  totals: { stcg: number; ltcg: number; stcgCount: number; ltcgCount: number };
}

type DeductionSource = "auto_ppf" | "auto_elss" | "manual";

interface TaxDeductionRow {
  _id: string;
  section: string;
  amount: number;
  financialYear: string;
  source: DeductionSource;
}

const DEDUCTION_SOURCE_LABELS: Record<DeductionSource, string> = {
  manual: "Manual",
  auto_elss: "Auto (ELSS)",
  auto_ppf: "Auto (PPF)",
};

type IncomeType = "salary" | "other";

interface IncomeSourceRow {
  _id: string;
  type: IncomeType;
  financialYear: string;
  annualAmount: number;
  breakdown?: {
    basic?: number | null;
    hra?: number | null;
    allowances?: number | null;
    rentPaidAnnual?: number | null;
    isMetro?: boolean | null;
  } | null;
}

interface TaxEstimateResult {
  taxableIncome: number;
  taxOnSlabIncome: number;
  taxOnCapitalGains: number;
  totalTaxBeforeRebate: number;
  rebateApplied: number;
  totalTax: number;
}

interface TaxEstimateResponse {
  old: TaxEstimateResult;
  new: TaxEstimateResult;
  recommendation: "old" | "new";
}

export default function TaxPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [fy, setFy] = useState(() => financialYearFromDate(new Date()));

  return (
    <ProtectedLayout>
      <h1 className="mb-6 text-2xl font-semibold">Tax</h1>

      <Card className="mb-6">
        <label htmlFor="fy-selector" className="text-sm">
          Financial Year
          <Input
            id="fy-selector"
            className="mt-1 w-full max-w-xs"
            placeholder="e.g. 2025-26"
            value={fy}
            onChange={(e) => setFy(e.target.value)}
          />
        </label>
        <p className="mt-2 text-xs text-gray-500">
          All sections below reflect data for FY {fy || "—"}.
        </p>
      </Card>

      <CapitalGainsSection fy={fy} />
      <DeductionsSection fy={fy} queryClient={queryClient} showToast={showToast} />
      <IncomeSourcesSection fy={fy} queryClient={queryClient} showToast={showToast} />
      <RegimeComparisonSection fy={fy} />
    </ProtectedLayout>
  );
}

function CapitalGainsSection({ fy }: { fy: string }) {
  const {
    data,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["capital-gains", fy],
    queryFn: () => apiFetch<CapitalGainsResponse>(`/tax/capital-gains?fy=${encodeURIComponent(fy)}`),
    enabled: fy.trim().length > 0,
  });

  return (
    <Card className="mb-6">
      <p className="mb-3 font-medium">Capital Gains</p>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : isError ? (
        <p className="text-sm text-red-600">Could not load capital gains. Please try again shortly.</p>
      ) : (
        <>
          <div className="mb-4 flex gap-6">
            <div>
              <p className="text-xs text-gray-500">Short-Term (STCG)</p>
              <p className="text-lg font-semibold">{formatInr(data?.totals.stcg ?? 0)}</p>
              <p className="text-xs text-gray-400">{data?.totals.stcgCount ?? 0} events</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Long-Term (LTCG)</p>
              <p className="text-lg font-semibold">{formatInr(data?.totals.ltcg ?? 0)}</p>
              <p className="text-xs text-gray-400">{data?.totals.ltcgCount ?? 0} events</p>
            </div>
          </div>

          {(data?.events ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">No capital gains events for this FY.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1 pr-4">Symbol</th>
                    <th className="py-1 pr-4">Buy Date</th>
                    <th className="py-1 pr-4">Sell Date</th>
                    <th className="py-1 pr-4">Units</th>
                    <th className="py-1 pr-4">Classification</th>
                    <th className="py-1 pr-4">Gain</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.events ?? []).map((e) => (
                    <tr key={e._id} className="border-b last:border-0">
                      <td className="py-1 pr-4">{e.symbol}</td>
                      <td className="py-1 pr-4">{new Date(e.buyDate).toLocaleDateString()}</td>
                      <td className="py-1 pr-4">{new Date(e.sellDate).toLocaleDateString()}</td>
                      <td className="py-1 pr-4">{e.unitsSold}</td>
                      <td className="py-1 pr-4">{e.classification}</td>
                      <td className="py-1 pr-4">{formatInr(e.gainAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function DeductionsSection({
  fy,
  queryClient,
  showToast,
}: {
  fy: string;
  queryClient: ReturnType<typeof useQueryClient>;
  showToast: ReturnType<typeof useToast>["showToast"];
}) {
  const {
    data: deductions,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["deductions", fy],
    queryFn: () => apiFetch<TaxDeductionRow[]>(`/tax/deductions?fy=${encodeURIComponent(fy)}`),
    enabled: fy.trim().length > 0,
  });

  const [form, setForm] = useState({ section: "", amount: "" });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<TaxDeductionRow>("/tax/deductions", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      // A new deduction changes both the deductions list itself and the dual-regime
      // estimate (which recomputes totalDeductions, capped per-regime). Both keys
      // must be invalidated or the estimate section would silently show stale
      // numbers after this mutation — the exact class of cross-invalidation bug
      // called out in the core build's Tasks 32/34.
      queryClient.invalidateQueries({ queryKey: ["deductions", fy] });
      queryClient.invalidateQueries({ queryKey: ["estimate", fy] });
      setForm({ section: "", amount: "" });
      showToast("Deduction added", "success");
    },
    onError: () => showToast("Failed to add deduction", "error"),
  });

  function submitCreate() {
    if (!form.section.trim()) {
      showToast("Enter a section (e.g. 80C, 80D)");
      return;
    }
    const amount = Number(form.amount);
    if (form.amount.trim() === "" || Number.isNaN(amount) || amount <= 0) {
      showToast("Enter a valid amount");
      return;
    }
    createMutation.mutate({ section: form.section, amount, financialYear: fy });
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/tax/deductions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deductions", fy] });
      queryClient.invalidateQueries({ queryKey: ["estimate", fy] });
      showToast("Deduction deleted", "success");
    },
    onError: () => showToast("Failed to delete deduction", "error"),
  });

  function submitDelete(d: TaxDeductionRow) {
    if (!window.confirm(`Delete this ${d.section} deduction of ${formatInr(d.amount)}?`)) return;
    deleteMutation.mutate(d._id);
  }

  const total = (deductions ?? []).reduce((sum, d) => sum + d.amount, 0);
  const percent = progressPercent(total, SECTION_80C_REFERENCE_LIMIT);

  return (
    <Card className="mb-6">
      <p className="mb-3 font-medium">Deductions</p>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : isError ? (
        <p className="text-sm text-red-600">Could not load deductions. Please try again shortly.</p>
      ) : (
        <>
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm">
              <span>Total deductions on file</span>
              <span className="text-gray-500">
                {formatInr(total)} / {formatInr(SECTION_80C_REFERENCE_LIMIT)} (80C reference)
              </span>
            </div>
            <div className="mt-1 h-2 w-full rounded bg-gray-200">
              <div className="h-2 rounded bg-black" style={{ width: `${percent}%` }} />
            </div>
          </div>

          {(deductions ?? []).length === 0 ? (
            <p className="mb-4 text-sm text-gray-500">No deductions on file for this FY.</p>
          ) : (
            <ul className="mb-4 flex flex-col gap-2">
              {(deductions ?? []).map((d) => (
                <li key={d._id} className="flex items-center justify-between text-sm">
                  <span>
                    {d.section} &mdash; {formatInr(d.amount)}{" "}
                    <span className="text-xs text-gray-400">({DEDUCTION_SOURCE_LABELS[d.source]})</span>
                  </span>
                  {d.source === "manual" && (
                    <Button
                      className="bg-red-600"
                      onClick={() => submitDelete(d)}
                      disabled={deleteMutation.isPending}
                    >
                      Delete
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="flex flex-col gap-3">
        <label htmlFor="deduction-section" className="text-sm">
          Section
          <Input
            id="deduction-section"
            className="mt-1 w-full"
            placeholder="e.g. 80C, 80D"
            value={form.section}
            onChange={(e) => setForm({ ...form, section: e.target.value })}
          />
        </label>
        <label htmlFor="deduction-amount" className="text-sm">
          Amount
          <Input
            id="deduction-amount"
            className="mt-1 w-full"
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </label>
        <Button onClick={submitCreate} disabled={createMutation.isPending}>
          Add Deduction
        </Button>
      </div>
    </Card>
  );
}

function IncomeSourcesSection({
  fy,
  queryClient,
  showToast,
}: {
  fy: string;
  queryClient: ReturnType<typeof useQueryClient>;
  showToast: ReturnType<typeof useToast>["showToast"];
}) {
  const {
    data: sources,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["income-sources", fy],
    queryFn: () => apiFetch<IncomeSourceRow[]>(`/tax/income-sources?fy=${encodeURIComponent(fy)}`),
    enabled: fy.trim().length > 0,
  });

  const [form, setForm] = useState({
    type: "salary" as IncomeType,
    annualAmount: "",
    basic: "",
    hra: "",
    allowances: "",
    rentPaidAnnual: "",
    isMetro: false,
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<IncomeSourceRow>("/tax/income-sources", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      // Income sources feed grossSalary/otherIncome in the estimate computation, so
      // the estimate must be invalidated alongside the income-sources list itself
      // (same cross-invalidation requirement as the deductions mutation above).
      queryClient.invalidateQueries({ queryKey: ["income-sources", fy] });
      queryClient.invalidateQueries({ queryKey: ["estimate", fy] });
      setForm({
        type: "salary",
        annualAmount: "",
        basic: "",
        hra: "",
        allowances: "",
        rentPaidAnnual: "",
        isMetro: false,
      });
      showToast("Income source added", "success");
    },
    onError: () => showToast("Failed to add income source", "error"),
  });

  function submitCreate() {
    const annualAmount = Number(form.annualAmount);
    if (form.annualAmount.trim() === "" || Number.isNaN(annualAmount) || annualAmount <= 0) {
      showToast("Enter a valid annual amount");
      return;
    }

    const payload: Record<string, unknown> = {
      type: form.type,
      financialYear: fy,
      annualAmount,
    };

    if (form.type === "salary") {
      const breakdown: Record<string, number | boolean> = {};
      if (form.basic.trim() !== "") breakdown.basic = Number(form.basic);
      if (form.hra.trim() !== "") breakdown.hra = Number(form.hra);
      if (form.allowances.trim() !== "") breakdown.allowances = Number(form.allowances);
      if (form.rentPaidAnnual.trim() !== "") breakdown.rentPaidAnnual = Number(form.rentPaidAnnual);
      if (
        Object.entries(breakdown).some(([key, v]) => key !== "isMetro" && Number.isNaN(v))
      ) {
        showToast("Breakdown fields must be numbers");
        return;
      }
      // isMetro only matters (and is only sent) alongside rentPaidAnnual — it has no
      // effect on the HRA exemption calculation without rent data, and defaults to
      // false server-side anyway, so there's no need to send it standalone.
      if (form.rentPaidAnnual.trim() !== "") breakdown.isMetro = form.isMetro;
      if (Object.keys(breakdown).length > 0) payload.breakdown = breakdown;
    }

    createMutation.mutate(payload);
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/tax/income-sources/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["income-sources", fy] });
      queryClient.invalidateQueries({ queryKey: ["estimate", fy] });
      showToast("Income source deleted", "success");
    },
    onError: () => showToast("Failed to delete income source", "error"),
  });

  function submitDelete(s: IncomeSourceRow) {
    if (!window.confirm(`Delete this ${s.type} income source of ${formatInr(s.annualAmount)}?`)) return;
    deleteMutation.mutate(s._id);
  }

  return (
    <Card className="mb-6">
      <p className="mb-3 font-medium">Income Sources</p>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : isError ? (
        <p className="text-sm text-red-600">Could not load income sources. Please try again shortly.</p>
      ) : (sources ?? []).length === 0 ? (
        <p className="mb-4 text-sm text-gray-500">No income sources on file for this FY.</p>
      ) : (
        <ul className="mb-4 flex flex-col gap-2">
          {(sources ?? []).map((s) => (
            <li key={s._id} className="flex items-center justify-between text-sm">
              <span>
                {s.type === "salary" ? "Salary" : "Other"} &mdash; {formatInr(s.annualAmount)}
                {s.type === "salary" && s.breakdown && (
                  <span className="text-xs text-gray-400">
                    {" "}
                    (Basic: {formatInr(s.breakdown.basic ?? 0)}, HRA: {formatInr(s.breakdown.hra ?? 0)}, Allowances:{" "}
                    {formatInr(s.breakdown.allowances ?? 0)}
                    {s.breakdown.rentPaidAnnual != null && (
                      <>
                        , Rent: {formatInr(s.breakdown.rentPaidAnnual)} ({s.breakdown.isMetro ? "metro" : "non-metro"})
                      </>
                    )}
                    )
                  </span>
                )}
              </span>
              <Button className="bg-red-600" onClick={() => submitDelete(s)} disabled={deleteMutation.isPending}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3">
        <label htmlFor="income-type" className="text-sm">
          Type
          <select
            id="income-type"
            className="mt-1 w-full rounded border px-3 py-2"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as IncomeType })}
          >
            <option value="salary">Salary</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label htmlFor="income-amount" className="text-sm">
          Annual Amount
          <Input
            id="income-amount"
            className="mt-1 w-full"
            type="number"
            value={form.annualAmount}
            onChange={(e) => setForm({ ...form, annualAmount: e.target.value })}
          />
        </label>
        {form.type === "salary" && (
          <>
            <label htmlFor="income-basic" className="text-sm">
              Basic (optional)
              <Input
                id="income-basic"
                className="mt-1 w-full"
                type="number"
                value={form.basic}
                onChange={(e) => setForm({ ...form, basic: e.target.value })}
              />
            </label>
            <label htmlFor="income-hra" className="text-sm">
              HRA (optional)
              <Input
                id="income-hra"
                className="mt-1 w-full"
                type="number"
                value={form.hra}
                onChange={(e) => setForm({ ...form, hra: e.target.value })}
              />
            </label>
            <label htmlFor="income-allowances" className="text-sm">
              Allowances (optional)
              <Input
                id="income-allowances"
                className="mt-1 w-full"
                type="number"
                value={form.allowances}
                onChange={(e) => setForm({ ...form, allowances: e.target.value })}
              />
            </label>
            <label htmlFor="income-rent-paid-annual" className="text-sm">
              Rent Paid Annually (optional, for HRA exemption)
              <Input
                id="income-rent-paid-annual"
                className="mt-1 w-full"
                type="number"
                value={form.rentPaidAnnual}
                onChange={(e) => setForm({ ...form, rentPaidAnnual: e.target.value })}
              />
            </label>
            <label htmlFor="income-is-metro" className="flex items-center gap-2 text-sm">
              <input
                id="income-is-metro"
                type="checkbox"
                checked={form.isMetro}
                onChange={(e) => setForm({ ...form, isMetro: e.target.checked })}
              />
              I live in a metro city
            </label>
          </>
        )}
        <Button onClick={submitCreate} disabled={createMutation.isPending}>
          Add Income Source
        </Button>
      </div>
    </Card>
  );
}

function RegimeComparisonSection({ fy }: { fy: string }) {
  const {
    data: estimate,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["estimate", fy],
    queryFn: () => apiFetch<TaxEstimateResponse>(`/tax/estimate?fy=${encodeURIComponent(fy)}`),
    enabled: fy.trim().length > 0,
  });

  const rows: { label: string; key: keyof TaxEstimateResult }[] = [
    { label: "Taxable Income", key: "taxableIncome" },
    { label: "Tax on Slab Income", key: "taxOnSlabIncome" },
    { label: "Tax on Capital Gains", key: "taxOnCapitalGains" },
    { label: "Tax Before Rebate", key: "totalTaxBeforeRebate" },
    { label: "Section 87A Rebate", key: "rebateApplied" },
    { label: "Total Tax", key: "totalTax" },
  ];

  return (
    <Card>
      <p className="mb-3 font-medium">Regime Comparison</p>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : isError ? (
        <p className="text-sm text-red-600">
          Could not load the tax estimate. Make sure a slab configuration exists for this FY.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {(["old", "new"] as const).map((regime) => {
            const result = estimate?.[regime];
            const isRecommended = estimate?.recommendation === regime;
            return (
              <div
                key={regime}
                className={
                  isRecommended
                    ? "rounded-lg border-2 border-green-600 bg-green-50 p-3"
                    : "rounded-lg border p-3"
                }
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-medium capitalize">{regime} Regime</p>
                  {isRecommended && (
                    <span className="rounded bg-green-600 px-2 py-0.5 text-xs text-white">Recommended</span>
                  )}
                </div>
                <dl className="flex flex-col gap-1 text-sm">
                  {rows.map((row) => (
                    <div key={row.key} className="flex justify-between">
                      <dt className="text-gray-500">{row.label}</dt>
                      <dd>{formatInr(result?.[row.key] ?? 0)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
