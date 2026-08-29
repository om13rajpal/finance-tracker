"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, API_BASE } from "@/lib/api-client";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

type Platform = "zerodha" | "groww";

interface Holding {
  symbol: string;
  instrumentType: string;
  totalUnits: number;
  avgCost: number;
  // The API (holdings.service.ts) always returns these fields — currentPrice
  // and currentValue are `null` (not omitted) when no price has ever been
  // fetched for the symbol, and priceStale is always a boolean (true when
  // there's no price to trust yet, not just when a cached price has aged).
  currentPrice: number | null;
  currentValue: number | null;
  priceStale: boolean;
}

interface ImportBatchResult {
  rowResults: { row: number; status: string; reason?: string }[];
}

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function InvestmentsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: holdings,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["holdings"],
    queryFn: () => apiFetch<Holding[]>("/holdings"),
  });

  const [platform, setPlatform] = useState<Platform>("zerodha");
  const [csvFileName, setCsvFileName] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportBatchResult | null>(null);

  async function handleUpload(file: File) {
    setIsImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("platform", platform);
      // Uses `fetch` directly rather than `apiFetch`: apiFetch always sets
      // `Content-Type: application/json`, which would break this multipart
      // upload (the browser needs to set its own multipart boundary).
      const res = await fetch(`${API_BASE}/investments/import`, {
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
      queryClient.invalidateQueries({ queryKey: ["holdings"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      showToast((e as Error).message || "Failed to import CSV", "error");
    } finally {
      setIsImporting(false);
    }
  }

  // Falls back to avgCost * totalUnits for a holding with no price fetched
  // yet, so the portfolio total isn't understated just because Task 15's
  // price-refresh job hasn't run for every symbol.
  const totalValue = (holdings ?? []).reduce(
    (sum, h) => sum + (h.currentValue ?? h.avgCost * h.totalUnits),
    0
  );

  return (
    <ProtectedLayout>
      <h1 className="mb-6 text-2xl font-semibold">Investments</h1>

      <Card className="mb-6">
        <p className="text-sm text-gray-500">Total Portfolio Value</p>
        <p className="text-3xl font-bold">{formatInr(totalValue)}</p>
      </Card>

      <Card className="mb-6">
        <p className="mb-3 font-medium">Import from Zerodha / Groww</p>
        <div className="flex items-end gap-3">
          <label htmlFor="platform-select" className="text-sm">
            Platform
            <select
              id="platform-select"
              className="mt-1 block rounded border px-2 py-1"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform)}
            >
              <option value="zerodha">Zerodha</option>
              <option value="groww">Groww</option>
            </select>
          </label>
          <label htmlFor="investments-csv-file" className="text-sm">
            Trade CSV
            <input
              id="investments-csv-file"
              className="mt-1 block"
              type="file"
              accept=".csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setCsvFileName(file.name);
                  handleUpload(file);
                }
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {isImporting && <p className="mt-2 text-sm text-gray-500">Importing {csvFileName}...</p>}
        {importResult && (
          <p className="mt-2 text-sm text-gray-600">
            {importResult.rowResults.filter((r) => r.status === "success").length} imported,{" "}
            {importResult.rowResults.filter((r) => r.status === "failed").length} failed
          </p>
        )}
      </Card>

      <Card>
        <p className="mb-3 font-medium">Holdings</p>
        {isLoading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : isError ? (
          <p className="text-sm text-red-600">Could not load holdings. Please try again shortly.</p>
        ) : (holdings ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">
            No holdings yet. Import a trade CSV to get started.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left font-medium text-gray-500">Symbol</th>
                <th className="text-left font-medium text-gray-500">Type</th>
                <th className="text-left font-medium text-gray-500">Units</th>
                <th className="text-left font-medium text-gray-500">Avg Cost</th>
                <th className="text-left font-medium text-gray-500">Current Price</th>
                <th className="text-left font-medium text-gray-500">Value</th>
              </tr>
            </thead>
            <tbody>
              {(holdings ?? []).map((h) => (
                <tr key={h.symbol}>
                  <td>{h.symbol}</td>
                  <td>{h.instrumentType}</td>
                  <td>{h.totalUnits}</td>
                  <td>{formatInr(h.avgCost)}</td>
                  <td>
                    {h.currentPrice !== null ? formatInr(h.currentPrice) : "—"}
                    {h.priceStale && <span className="ml-1 text-xs text-amber-600">(stale)</span>}
                  </td>
                  <td>{formatInr(h.currentValue ?? h.avgCost * h.totalUnits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </ProtectedLayout>
  );
}
