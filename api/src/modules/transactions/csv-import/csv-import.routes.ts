import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../auth/auth.middleware.js";
import { Transaction } from "../../../models/Transaction.js";
import { ImportBatch } from "../../../models/ImportBatch.js";
import { findLikelyDuplicate } from "../duplicate-detection.js";
import { applyCategorizationRules } from "../../categorization/categorization.engine.js";
import { parseGenericBankCsv } from "./parsers/genericBank.parser.js";
import { invalidateDashboardCache } from "../../dashboard/dashboard.service.js";

const upload = multer({ storage: multer.memoryStorage() });
export const csvImportRouter = Router();
csvImportRouter.use(requireAuth);

csvImportRouter.post("/import", upload.single("file"), async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const accountId = req.body.accountId as string | undefined;
    if (!accountId) return res.status(400).json({ error: "accountId is required" });

    const rows = parseGenericBankCsv(req.file.buffer.toString("utf8"));
    const rowResults: { row: number; status: "success" | "failed"; reason?: string; transactionId?: string }[] = [];
    const resultingIds: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if ("error" in row) {
        rowResults.push({ row: i + 1, status: "failed", reason: row.error });
        continue;
      }

      const date = new Date(row.date);
      const duplicate = await findLikelyDuplicate(userId, { accountId, amount: row.amount, date });
      if (duplicate) {
        rowResults.push({ row: i + 1, status: "failed", reason: "possible_duplicate" });
        continue;
      }

      const categoryId = await applyCategorizationRules(userId, { merchant: row.merchant, note: row.note });
      const transaction = await Transaction.create({
        userId,
        accountId,
        categoryId,
        amount: row.amount,
        date,
        merchant: row.merchant,
        note: row.note,
        source: "csv_import",
        status: "confirmed",
      });

      resultingIds.push(transaction._id.toString());
      rowResults.push({ row: i + 1, status: "success", transactionId: transaction._id.toString() });
    }

    const batch = await ImportBatch.create({
      userId,
      source: "bank_statement",
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
