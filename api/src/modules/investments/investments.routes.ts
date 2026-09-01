import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { requireAuth } from "../auth/auth.middleware.js";
import { HoldingLot } from "../../models/HoldingLot.js";
import { ImportBatch } from "../../models/ImportBatch.js";
import { Transaction } from "../../models/Transaction.js";
import { getHoldingsRollup } from "./holdings.service.js";
import { parseZerodhaCsv } from "./csv-import/zerodha.parser.js";
import { parseGrowwCsv } from "./csv-import/groww.parser.js";
import { invalidateDashboardCache } from "../dashboard/dashboard.service.js";
import { recordSale } from "../tax/capital-gains.service.js";
import { applyBalanceDelta } from "../accounts/balance.service.js";

const upload = multer({ storage: multer.memoryStorage() });
export const investmentsRouter = Router();
investmentsRouter.use(requireAuth);

investmentsRouter.get("/holdings", async (req, res, next) => {
  try {
    const rollup = await getHoldingsRollup((req as any).userId);
    res.json(rollup);
  } catch (err) {
    next(err);
  }
});

investmentsRouter.get("/holding-lots", async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const items = await HoldingLot.find({ userId }).sort({ buyDate: -1 }).limit(limit);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

const buySchema = z.object({
  symbol: z.string().min(1),
  platform: z.enum(["zerodha", "groww", "other"]),
  instrumentType: z.enum(["stock", "mutual_fund"]),
  buyDate: z.string(),
  buyPrice: z.number().positive(),
  units: z.number().positive(),
  isElss: z.boolean().optional(),
  // OPTIONAL, deliberately: existing callers (Zerodha/Groww CSV import) have no
  // account context available at import time at all — a historical trade
  // statement says nothing about which of this app's own bank accounts funded
  // it — and must keep working exactly as before, without gaining the
  // linked-transaction behavior below. Only when a caller (this manual "add
  // holding" route, used going forward) actually knows and supplies one does a
  // purchase get wired into the transaction/balance system, closing the
  // double-counting gap without touching any historical CSV-imported data.
  accountId: z.string().optional(),
});

/**
 * Manually records a BUY: always creates a `HoldingLot` (unconditionally, same
 * as the CSV import path), and — ONLY when `accountId` is supplied — ALSO
 * creates a real linked expense `Transaction` (so the cash outflow is visible
 * in transaction history and budget calculations, not just a silent balance
 * adjustment) and applies its cost as a balance delta to that account, exactly
 * as if the purchase had been manually entered as an expense.
 *
 * This is what actually fixes the net-worth double-count for a NEW purchase:
 * before this route existed, buying a holding never touched any account, so
 * the cash spent was still counted as sitting in the account AND as the new
 * holding's value. With the funding account wired up, the account's own
 * `currentBalance` now genuinely drops by the purchase cost, so
 * `computeFullNetWorth` (accounts total + holdings value) sums to the correct
 * figure with no special-casing needed there at all — the fix is in the data,
 * not the aggregate math.
 */
investmentsRouter.post("/holdings", async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const data = buySchema.parse(req.body);
    // Upper-cased, matching the CSV import parsers' own normalization — `symbol`
    // is the join key for FIFO sell-matching, the holdings rollup, and price
    // lookups, so a case variant here would silently fork a position in two.
    const symbol = data.symbol.trim().toUpperCase();
    const buyDate = new Date(data.buyDate);
    const cost = Math.round(data.buyPrice * data.units * 100) / 100;

    let transaction = null;
    if (data.accountId) {
      transaction = await Transaction.create({
        userId,
        accountId: data.accountId,
        categoryId: null,
        amount: -cost,
        date: buyDate,
        note: `Bought ${data.units} ${symbol} @ ${data.buyPrice}`,
        merchant: symbol,
        source: "manual",
        status: "confirmed",
      });
      await applyBalanceDelta(userId, data.accountId, -cost);
    }

    const lot = await HoldingLot.create({
      userId,
      symbol,
      platform: data.platform,
      instrumentType: data.instrumentType,
      buyDate,
      buyPrice: data.buyPrice,
      units: data.units,
      remainingUnits: data.units,
      isElss: data.isElss ?? false,
      transactionId: transaction ? transaction._id.toString() : null,
    });

    await invalidateDashboardCache(userId);
    res.status(201).json({ lot, transaction });
  } catch (err) {
    next(err);
  }
});

const sellSchema = z.object({
  symbol: z.string().min(1),
  instrumentType: z.enum(["stock", "mutual_fund"]),
  sellDate: z.string(),
  sellPrice: z.number().positive(),
  unitsSold: z.number().positive(),
  // Same reasoning as `buySchema.accountId` above — optional, and only wires up
  // a linked Transaction when actually supplied.
  accountId: z.string().optional(),
});

/**
 * Manually records a SELL: always runs the existing FIFO/capital-gains
 * pipeline (`recordSale` — same one the CSV import path already uses,
 * untouched here), and — ONLY when `accountId` is supplied — ALSO creates a
 * real linked INCOME `Transaction` for the sale proceeds and credits that
 * account, symmetric with the buy route above.
 *
 * `recordSale` (via `applySellFifo`) guarantees a failed sell (asking for more
 * units than are held) leaves every `HoldingLot` completely untouched before
 * it ever throws — caught here and reported as a clean 400, never a partial
 * lot mutation with no linked Transaction to match it.
 */
investmentsRouter.post("/holdings/sell", async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const data = sellSchema.parse(req.body);
    const symbol = data.symbol.trim().toUpperCase();
    const sellDate = new Date(data.sellDate);
    const proceeds = Math.round(data.sellPrice * data.unitsSold * 100) / 100;

    let events;
    try {
      events = await recordSale(userId, {
        symbol,
        instrumentType: data.instrumentType,
        sellDate,
        sellPrice: data.sellPrice,
        unitsSold: data.unitsSold,
      });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }

    let transaction = null;
    if (data.accountId) {
      transaction = await Transaction.create({
        userId,
        accountId: data.accountId,
        categoryId: null,
        amount: proceeds,
        date: sellDate,
        note: `Sold ${data.unitsSold} ${symbol} @ ${data.sellPrice}`,
        merchant: symbol,
        source: "manual",
        status: "confirmed",
      });
      await applyBalanceDelta(userId, data.accountId, proceeds);
    }

    await invalidateDashboardCache(userId);
    res.status(201).json({
      events,
      transaction,
      // See `usedDefaultCapitalGainsConfig` on SellEvent — surfaced here too
      // so the UI can flag it immediately, not only on a later Tax-page visit.
      usedDefaultConfig: events.some((e) => e.usedDefaultCapitalGainsConfig),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Deletes a HoldingLot the user never should have created (a mis-entered
 * Buy) — and, if it was bought with a funding account, its linked expense
 * `Transaction` too, reversing that account's balance the same way a plain
 * transaction delete does.
 *
 * Only allowed while the lot is completely untouched by any sale
 * (`remainingUnits === units`): once FIFO has matched units from it, one or
 * more `SellEvent`s reference its `lotId` for capital-gains reporting —
 * deleting it out from under those would leave orphaned/unexplainable
 * records. There's no supported way to undo a sell in this app today, so a
 * (partially) sold lot simply can't be deleted; only a completely unsold one.
 */
investmentsRouter.delete("/holding-lots/:id", async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const lot = await HoldingLot.findOne({ _id: req.params.id, userId });
    if (!lot) return res.status(404).json({ error: "Not found" });

    if (lot.remainingUnits !== lot.units) {
      return res.status(400).json({
        error: "This holding has been sold (in full or in part) and can't be deleted — it has capital-gains history linked to it.",
      });
    }

    await HoldingLot.deleteOne({ _id: lot._id });

    if (lot.transactionId) {
      const transaction = await Transaction.findOne({ _id: lot.transactionId, userId });
      if (transaction) {
        await Transaction.deleteOne({ _id: transaction._id });
        if (transaction.balanceDeltaApplied !== false) {
          await applyBalanceDelta(userId, transaction.accountId, -transaction.amount);
        }
      }
    }

    await invalidateDashboardCache(userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

investmentsRouter.post("/investments/import", upload.single("file"), async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const platform = req.body.platform as string | undefined;
    if (platform !== "zerodha" && platform !== "groww") {
      return res.status(400).json({ error: "platform must be 'zerodha' or 'groww'" });
    }

    const rows =
      platform === "zerodha"
        ? parseZerodhaCsv(req.file.buffer.toString("utf8"))
        : parseGrowwCsv(req.file.buffer.toString("utf8"));

    const rowResults: { row: number; status: "success" | "failed"; reason?: string; transactionId?: string }[] = [];
    const resultingIds: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if ("error" in row) {
        rowResults.push({ row: i + 1, status: "failed", reason: row.error });
        continue;
      }

      try {
        if (row.tradeType === "buy") {
          const lot = await HoldingLot.create({
            userId,
            symbol: row.symbol,
            platform,
            // The Zerodha/Groww trade-history CSV export covers equities only —
            // it has no instrument-type column, so buy rows are always "stock".
            // Mutual fund SIP/lump-sum imports are a separate format, out of
            // scope for this parser.
            instrumentType: "stock",
            buyDate: new Date(row.date),
            buyPrice: row.price,
            units: row.quantity,
            remainingUnits: row.quantity,
          });
          resultingIds.push(lot._id.toString());
          rowResults.push({ row: i + 1, status: "success" });
        } else {
          // recordSale internally calls applySellFifo, which throws (without
          // mutating anything) if unitsSold exceeds total remainingUnits for the
          // symbol — that's caught here and recorded as a failed row, consistent
          // with the CSV import per-row error isolation pattern, rather than
          // letting it silently go negative or abort the batch. recordSale then
          // classifies each FIFO-matched lot as STCG/LTCG and persists a SellEvent
          // per lot, so every CSV-imported sell is recorded for capital gains
          // reporting, not just reflected in HoldingLot.remainingUnits.
          await recordSale(userId, {
            symbol: row.symbol,
            // The Zerodha/Groww trade-history CSV export covers equities only (see
            // the buy-row note above) — sell rows are always "stock" too.
            instrumentType: "stock",
            sellDate: new Date(row.date),
            sellPrice: row.price,
            unitsSold: row.quantity,
          });
          rowResults.push({ row: i + 1, status: "success" });
        }
      } catch (err) {
        rowResults.push({ row: i + 1, status: "failed", reason: (err as Error).message });
      }
    }

    const batch = await ImportBatch.create({
      userId,
      source: platform === "zerodha" ? "zerodha_csv" : "groww_csv",
      filename: req.file.originalname,
      rowResults,
      resultingIds,
    });

    await invalidateDashboardCache(userId);
    res.status(200).json(batch);
  } catch (err) {
    next(err);
  }
});
