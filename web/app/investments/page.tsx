"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { API_BASE, apiFetch } from "@/lib/api-client";
import type {
  Account,
  BuyHoldingResult,
  Holding,
  HoldingLot,
  ImportBatchResult,
  InstrumentType,
  Platform,
  SellHoldingResult,
} from "@/lib/api-types";
import { formatDate, formatInr, formatPrice, formatUnits, todayInputValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProtectedLayout } from "@/components/ProtectedLayout";
import { Icon } from "@/components/app/icons";
import { Field, FieldGrid, FormActions, MoneyInput, DateInput, Segmented, Select } from "@/components/app/form";
import {
  EmptyState,
  Helper,
  IconButton,
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
 * Sorted · Investments
 *
 * A TABLE, not a list of rows, and that is a deliberate departure. Everywhere
 * else in the product a row is one thing with one amount. A holding is six
 * numbers that only mean anything read against each other and down their own
 * columns: units, average cost, live price, value, and what that adds up to.
 * A stacked row layout would break every one of those columns.
 *
 * WHAT "STALE" MEANS, EXACTLY. `priceStale` is true both when a cached price
 * has aged out (2 hours for a stock, 2 days for a fund) AND when no price has
 * ever been fetched for the symbol at all. It is not an error and it is not
 * drawn in --alert; it is a caveat on one number, so it is a mono micro-label
 * next to that number.
 *
 * A HOLDING WITH NO PRICE FALLS BACK TO COST. That is what
 * `computeFullNetWorth` does, so it is what this screen does, otherwise the
 * portfolio total here and the net worth figure on the dashboard would disagree
 * for exactly the symbols the price job has not reached yet.
 */

export default function InvestmentsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const holdings = useQuery({
    queryKey: ["holdings"],
    queryFn: () => apiFetch<Holding[]>("/holdings"),
  });
  const lots = useQuery({
    queryKey: ["holding-lots"],
    queryFn: () => apiFetch<{ items: HoldingLot[] }>("/holding-lots?limit=50"),
  });
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => apiFetch<Account[]>("/accounts"),
  });

  const deleteLot = useMutation({
    mutationFn: (lotId: string) => apiFetch<void>(`/holding-lots/${lotId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holdings"] });
      queryClient.invalidateQueries({ queryKey: ["holding-lots"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      showToast("Holding deleted", "success");
    },
    onError: (e) => showToast((e as Error).message || "Could not delete that holding", "error"),
  });

  const rows = holdings.data ?? [];
  const value = rows.reduce((sum, h) => sum + (h.currentValue ?? h.avgCost * h.totalUnits), 0);
  const cost = rows.reduce((sum, h) => sum + h.avgCost * h.totalUnits, 0);
  const gain = value - cost;
  const gainPct = cost > 0 ? (gain / cost) * 100 : 0;
  const priced = rows.filter((h) => h.currentPrice !== null && !h.priceStale).length;

  return (
    <ProtectedLayout>
      <PageHeader
        title="Investments"
        meta={rows.length > 0 ? `${rows.length} open ${rows.length === 1 ? "holding" : "holdings"}` : undefined}
      />

      <div className="grid items-start gap-22 xl:grid-cols-[7fr_5fr]">
        <div className="flex min-w-0 flex-col gap-22">
          {!holdings.isLoading && !holdings.isError && rows.length > 0 ? (
            <Panel>
              <PanelHeader title="§ The portfolio" meta={`${priced} of ${rows.length} priced`} />
              <div className="grid gap-22 sm:grid-cols-3">
                <Readout label="Market value" value={value} />
                <Readout label="What you paid" value={cost} />
                {/* Ink, like every other total in the product. A gain is not
                    tinted green here: the sign and the word carry it, and they
                    survive greyscale and deuteranopia, which a hue does not. */}
                <Readout
                  label={gain >= 0 ? "Up by" : "Down by"}
                  value={formatInr(Math.abs(gain))}
                  sub={`${gain >= 0 ? "+" : "−"}${Math.abs(gainPct).toFixed(1)}%`}
                />
              </div>
              <PanelFooter>
                Unpriced symbols are counted at what you paid, exactly as net worth counts them
              </PanelFooter>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title="§ Holdings" />
            {holdings.isLoading ? (
              <div className="flex flex-col gap-12">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-[22px] w-full rounded-sm opacity-40" />
                ))}
              </div>
            ) : holdings.isError ? (
              <Notice
                title="Could not load your holdings."
                body="Please try again shortly. Nothing has been lost."
              />
            ) : rows.length === 0 ? (
              <EmptyState
                title="No open holdings."
                body="Import a trade file from Zerodha or Groww and every buy becomes a lot, so cost basis is computed FIFO the way the tax office expects."
              />
            ) : (
              /* THE NARROW LAYOUT IS NOT A HORIZONTAL SCROLL.
                 At 390px a five-column money table is 560px wide, so two of
                 its columns sat off-screen behind a scroller with no
                 affordance. Average cost and price move INTO the symbol cell
                 on a phone instead, and come back as their own columns from
                 `sm` up: nothing is hidden, it is re-laid-out. */
              <ScrollableTable label="Holdings">
                <table className="w-full border-collapse text-body-s sm:min-w-[560px]">
                  <caption className="sr-only">
                    Open holdings, with units, average cost, latest price and current value
                  </caption>
                  <thead>
                    <tr className="border-b border-ink">
                      <Th align="left">Symbol</Th>
                      <Th align="right" className="hidden sm:table-cell">
                        Units
                      </Th>
                      <Th align="right" className="hidden sm:table-cell">
                        Avg cost
                      </Th>
                      <Th align="right" className="hidden sm:table-cell">
                        Price
                      </Th>
                      <Th align="right">Value</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((h) => {
                      const fallback = h.currentValue === null;
                      const rowValue = h.currentValue ?? h.avgCost * h.totalUnits;
                      return (
                        <tr key={h.symbol} className="border-b border-rule last:border-b-0">
                          <td className="py-12 pr-14 align-top">
                            <span className="block break-words font-medium">{h.symbol}</span>
                            <span className="mt-2 block font-num text-micro uppercase tracking-micro text-dim">
                              {h.instrumentType === "mutual_fund" ? "Mutual fund" : "Stock"}
                            </span>
                            <span className="mt-2 block font-num text-micro uppercase tracking-micro text-dim sm:hidden">
                              {formatUnits(h.totalUnits)} units · paid {formatPrice(h.avgCost)}
                            </span>
                            <span className="block font-num text-micro uppercase tracking-micro text-dim sm:hidden">
                              {h.currentPrice !== null ? formatPrice(h.currentPrice) : "unpriced"}
                              {h.priceStale && h.currentPrice !== null ? " · stale" : ""}
                            </span>
                          </td>
                          <td className="money hidden py-12 pr-14 text-right align-top sm:table-cell">
                            {formatUnits(h.totalUnits)}
                          </td>
                          <td className="money hidden py-12 pr-14 text-right align-top sm:table-cell">
                            {formatPrice(h.avgCost)}
                          </td>
                          <td className="hidden py-12 pr-14 text-right align-top sm:table-cell">
                            <span className="money block">
                              {h.currentPrice !== null ? formatPrice(h.currentPrice) : "–"}
                            </span>
                            {h.priceStale ? (
                              <span className="mt-2 block font-num text-micro uppercase tracking-micro text-dim">
                                {h.currentPrice === null ? "never priced" : "stale"}
                              </span>
                            ) : null}
                          </td>
                          <td className="py-12 text-right align-top">
                            <span className="money block">{formatInr(rowValue)}</span>
                            {fallback ? (
                              <span className="mt-2 block font-num text-micro uppercase tracking-micro text-dim">
                                at cost
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollableTable>
            )}
          </Panel>

          {/* ── the lots ─────────────────────────────────────────────────
              Cost basis is FIFO, matched oldest lot first, so the lots are
              not an implementation detail, they are the audit trail behind
              every capital-gains figure on the Tax screen. */}
          {(lots.data?.items.length ?? 0) > 0 ? (
            <Panel>
              <PanelHeader
                title="§ Lots"
                meta={`${lots.data!.items.length} most recent`}
              />
              <Helper className="-mt-8 mb-14 max-w-[60ch]">
                Every buy is its own lot. A sale is matched against the oldest lot first, which is
                what decides whether a gain is short or long term.
              </Helper>
              <ScrollableTable label="Purchase lots">
                <table className="w-full border-collapse text-body-s sm:min-w-[560px]">
                  <caption className="sr-only">Individual purchase lots, newest first</caption>
                  <thead>
                    <tr className="border-b border-ink">
                      <Th align="left">Symbol</Th>
                      <Th align="left" className="hidden sm:table-cell">
                        Bought
                      </Th>
                      <Th align="right">Units left</Th>
                      <Th align="right" className="hidden sm:table-cell">
                        Buy price
                      </Th>
                      <Th align="left" className="hidden sm:table-cell">
                        Platform
                      </Th>
                      <Th align="right">
                        <span className="sr-only">Delete</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {lots.data!.items.map((lot) => {
                      // Only an untouched lot (nothing FIFO-matched off it yet)
                      // can be deleted: see the route's own doc comment. A
                      // partially/fully sold lot has SellEvents referencing it.
                      const deletable = lot.remainingUnits === lot.units;
                      return (
                        <tr key={lot._id} className="border-b border-rule last:border-b-0">
                          <td className="py-10 pr-14 align-top">
                            <span className="block break-words font-medium">{lot.symbol}</span>
                            <span className="mt-2 block font-num text-micro uppercase tracking-micro text-dim sm:hidden">
                              {formatDate(lot.buyDate)} · {formatPrice(lot.buyPrice)} · {lot.platform}
                              {lot.isElss ? " · ELSS" : ""}
                            </span>
                          </td>
                          <td className="hidden py-10 pr-14 align-top font-num text-micro uppercase tracking-micro text-dim sm:table-cell">
                            {formatDate(lot.buyDate)}
                          </td>
                          <td className="money py-10 pr-14 text-right align-top">
                            {formatUnits(lot.remainingUnits)}
                            {lot.remainingUnits !== lot.units ? (
                              <span className="text-dim"> / {formatUnits(lot.units)}</span>
                            ) : null}
                          </td>
                          <td className="money hidden py-10 pr-14 text-right align-top sm:table-cell">
                            {formatPrice(lot.buyPrice)}
                          </td>
                          <td className="hidden py-10 pr-14 align-top font-num text-micro uppercase tracking-micro text-dim sm:table-cell">
                            {lot.platform}
                            {lot.isElss ? " · ELSS" : ""}
                          </td>
                          <td className="py-10 text-right align-top">
                            {deletable ? (
                              <IconButton
                                icon="trash"
                                label={`Delete ${lot.symbol} lot`}
                                disabled={deleteLot.isPending}
                                className="h-22 w-22 border-transparent text-dim hover:border-ink hover:text-alert"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Delete this ${lot.symbol} lot (${formatUnits(lot.units)} units)? This cannot be undone.`
                                    )
                                  ) {
                                    deleteLot.mutate(lot._id);
                                  }
                                }}
                              />
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollableTable>
              <PanelFooter>
                A fully sold lot keeps its row here but leaves the holdings table above
              </PanelFooter>
            </Panel>
          ) : null}
        </div>

        <div className="flex flex-col gap-22 xl:sticky xl:top-32">
          <BuySellPanel accounts={accounts.data ?? []} />
          <ImportPanel />
        </div>
      </div>
    </ProtectedLayout>
  );
}

function Th({
  children,
  align,
  className,
}: {
  children: React.ReactNode;
  align: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "pb-8 font-num text-label font-medium uppercase tracking-label text-dim",
        // Every header keeps its gutter except the last. Without it a
        // right-aligned column's header ran straight into the left-aligned one
        // beside it and printed "BUY PRICEPLATFORM" as a single word, a real
        // defect, invisible in the JSX and only findable by looking.
        "pr-14 last:pr-0",
        align === "right" ? "text-right" : "text-left",
        className
      )}
    >
      {children}
    </th>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Buy / sell
// ═══════════════════════════════════════════════════════════════════════════

type TradeDirection = "buy" | "sell";

/**
 * Records a single manual trade: the counterpart to the CSV import panel for
 * a one-off buy or sell that isn't sitting in a broker export.
 *
 * THE ACCOUNT FIELD IS OPTIONAL, DELIBERATELY. Picking one turns this from a
 * silent balance adjustment into a real linked expense/income transaction,
 * exactly as if the purchase or sale had been typed into Transactions by
 * hand, which is what keeps net worth from double-counting the cash a
 * purchase spends. Leaving it blank still records the lot/sale on its own,
 * matching how a CSV-imported historical trade behaves (no account context
 * available), so nothing about this form is ever a hard requirement to use.
 */
function BuySellPanel({ accounts }: { accounts: Account[] }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [direction, setDirection] = useState<TradeDirection>("buy");
  const empty = {
    symbol: "",
    platform: "zerodha" as Platform | "other",
    instrumentType: "stock" as InstrumentType,
    date: todayInputValue(),
    price: "",
    units: "",
    accountId: "",
  };
  const [form, setForm] = useState(empty);

  function invalidateAfterTrade() {
    queryClient.invalidateQueries({ queryKey: ["holdings"] });
    queryClient.invalidateQueries({ queryKey: ["holding-lots"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["capital-gains"] });
  }

  const buy = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<BuyHoldingResult>("/holdings", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      invalidateAfterTrade();
      setForm(empty);
      showToast("Purchase recorded", "success");
    },
    onError: (e) => showToast((e as Error).message || "Could not record that purchase", "error"),
  });

  const sell = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<SellHoldingResult>("/holdings/sell", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (result) => {
      invalidateAfterTrade();
      setForm(empty);
      // No confirmed tax slab config exists yet for this sale's financial
      // year: it was still recorded correctly (using the current statutory
      // STCG/LTCG rule), just flagging that nobody's confirmed a config for
      // this FY specifically. See Settings/Tax for adding one.
      showToast(
        result.usedDefaultConfig
          ? "Sale recorded (using the default tax rule: no confirmed config for this year yet)"
          : "Sale recorded",
        "success"
      );
    },
    onError: (e) => showToast((e as Error).message || "Could not record that sale", "error"),
  });

  const busy = buy.isPending || sell.isPending;

  return (
    <Panel>
      <PanelHeader title="§ Buy or sell" />
      <form
        noValidate
        className="flex flex-col gap-14"
        onSubmit={(e) => {
          e.preventDefault();
          const symbol = form.symbol.trim();
          if (!symbol) {
            showToast("Enter a symbol");
            return;
          }
          const price = Number(form.price);
          if (form.price.trim() === "" || Number.isNaN(price) || price <= 0) {
            showToast("Enter a price above zero");
            return;
          }
          const units = Number(form.units);
          if (form.units.trim() === "" || Number.isNaN(units) || units <= 0) {
            showToast("Enter a unit count above zero");
            return;
          }
          if (!form.date) {
            showToast("Choose a date");
            return;
          }

          if (direction === "buy") {
            buy.mutate({
              symbol,
              platform: form.platform,
              instrumentType: form.instrumentType,
              buyDate: form.date,
              buyPrice: price,
              units,
              accountId: form.accountId || undefined,
            });
          } else {
            sell.mutate({
              symbol,
              instrumentType: form.instrumentType,
              sellDate: form.date,
              sellPrice: price,
              unitsSold: units,
              accountId: form.accountId || undefined,
            });
          }
        }}
      >
        <div className="flex flex-col gap-8">
          <span className="font-sans text-body-s font-medium text-ink">Direction</span>
          <Segmented
            name="trade-direction"
            ariaLabel="Direction"
            value={direction}
            onChange={setDirection}
            options={[
              { value: "buy", label: "Buy" },
              { value: "sell", label: "Sell" },
            ]}
          />
        </div>

        <FieldGrid>
          <Field id="trade-symbol" label="Symbol">
            <Input
              id="trade-symbol"
              className="uppercase"
              placeholder="INFY"
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
            />
          </Field>
          <Field id="trade-instrument" label="Instrument">
            <Select
              id="trade-instrument"
              value={form.instrumentType}
              onChange={(e) => setForm({ ...form, instrumentType: e.target.value as InstrumentType })}
            >
              <option value="stock">Stock</option>
              <option value="mutual_fund">Mutual fund</option>
            </Select>
          </Field>
        </FieldGrid>

        <FieldGrid>
          <Field id="trade-price" label={direction === "buy" ? "Buy price" : "Sell price"}>
            <MoneyInput
              id="trade-price"
              placeholder="1500"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </Field>
          <Field id="trade-units" label="Units">
            <Input
              id="trade-units"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              className="font-num"
              placeholder="10"
              value={form.units}
              onChange={(e) => setForm({ ...form, units: e.target.value })}
            />
          </Field>
        </FieldGrid>

        <Field id="trade-date" label={direction === "buy" ? "Bought on" : "Sold on"}>
          <DateInput
            id="trade-date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </Field>

        {direction === "buy" ? (
          <Field id="trade-platform" label="Platform">
            <Select
              id="trade-platform"
              value={form.platform}
              onChange={(e) => setForm({ ...form, platform: e.target.value as Platform | "other" })}
            >
              <option value="zerodha">Zerodha</option>
              <option value="groww">Groww</option>
              <option value="other">Other</option>
            </Select>
          </Field>
        ) : null}

        <Field
          id="trade-account"
          label={direction === "buy" ? "Funding account (optional)" : "Credit to account (optional)"}
          helper={
            direction === "buy"
              ? "Pick one and this shows up as a real expense, deducted from that account, exactly like any other transaction."
              : "Pick one and the sale proceeds are credited there as a real income transaction."
          }
        >
          <Select
            id="trade-account"
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
          >
            <option value="">No linked account</option>
            {accounts.map((a) => (
              <option key={a._id} value={a._id}>
                {a.institution} · {a.nickname}
              </option>
            ))}
          </Select>
        </Field>

        <FormActions>
          <Button type="submit" busy={busy}>
            {direction === "buy" ? "Record purchase" : "Record sale"}
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Import
// ═══════════════════════════════════════════════════════════════════════════

function ImportPanel() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [platform, setPlatform] = useState<Platform>("zerodha");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportBatchResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("platform", platform);
      // `fetch`, not `apiFetch`: a multipart upload needs the browser to set
      // its own boundary, which a forced JSON content type would break.
      const res = await fetch(`${API_BASE}/investments/import`, {
        method: "POST",
        credentials: "include",
        body,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Import failed: ${res.status}`);
      }
      setResult(await res.json());
      queryClient.invalidateQueries({ queryKey: ["holdings"] });
      queryClient.invalidateQueries({ queryKey: ["holding-lots"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      // A sell row creates SellEvents, which are exactly what the Tax screen
      // reads, so a trade import moves capital gains too.
      queryClient.invalidateQueries({ queryKey: ["capital-gains"] });
    } catch (e) {
      showToast((e as Error).message || "Could not import that file", "error");
    } finally {
      setBusy(false);
    }
  }

  const failures = result?.rowResults.filter((r) => r.status === "failed") ?? [];
  const imported = result ? result.rowResults.length - failures.length : 0;

  return (
    <Panel>
      <PanelHeader title="§ Import trades" />
      <div className="flex flex-col gap-14">
        <Field
          id="platform-select"
          label="Platform"
          helper="The two files are shaped differently, so the parser needs to know which one this is."
        >
          <Select
            id="platform-select"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
          >
            <option value="zerodha">Zerodha</option>
            <option value="groww">Groww</option>
          </Select>
        </Field>

        <input
          ref={fileRef}
          id="investments-csv-file"
          type="file"
          accept=".csv"
          // A name of its own. The expected-columns line beside it is helper
          // text, not a <label>: see the note in transactions/page.tsx.
          aria-label="Trade file"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap items-center gap-12">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            busy={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="upload" size={15} />
            {busy ? "Reading…" : "Choose a trade CSV"}
          </Button>
          <span className="font-sans text-caption text-dim-2">
            Symbol, Trade Date, Trade Type, Quantity, Price
          </span>
        </div>

        {result ? (
          <div className="rounded-panel border-panel border-ink p-18">
            <SectionLabel>§ Import result</SectionLabel>
            <p className="m-0 mt-8 text-body-s">
              {imported} rows accepted, {failures.length} skipped.
            </p>
            {failures.length > 0 ? (
              <ul className="m-0 mt-12 flex list-none flex-col gap-8 p-0">
                {failures.slice(0, 6).map((f) => (
                  <li key={f.row} className="font-num text-micro uppercase tracking-micro text-dim">
                    Row {f.row} · {f.reason ?? "rejected"}
                  </li>
                ))}
                {failures.length > 6 ? (
                  <li className="font-num text-micro uppercase tracking-micro text-dim">
                    and {failures.length - 6} more
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}

        <Helper>
          A sell row is matched against your oldest lots first and becomes a capital-gains event on
          the Tax screen. If it asks for more units than you hold, that row is skipped whole: no
          partial deduction is ever made.
        </Helper>
      </div>
    </Panel>
  );
}
