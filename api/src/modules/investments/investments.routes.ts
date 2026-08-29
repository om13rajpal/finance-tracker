import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../auth/auth.middleware.js";
import { HoldingLot } from "../../models/HoldingLot.js";
import { ImportBatch } from "../../models/ImportBatch.js";
import { getHoldingsRollup } from "./holdings.service.js";
import { parseZerodhaCsv } from "./csv-import/zerodha.parser.js";
import { parseGrowwCsv } from "./csv-import/groww.parser.js";
import { invalidateDashboardCache } from "../dashboard/dashboard.service.js";
import { recordSale } from "../tax/capital-gains.service.js";

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
