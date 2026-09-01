import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../auth/auth.middleware.js";
import { Transaction } from "../../../models/Transaction.js";
import { ImportBatch } from "../../../models/ImportBatch.js";
import { findLikelyDuplicate } from "../duplicate-detection.js";
import { applyCategorizationRules } from "../../categorization/categorization.engine.js";
import { parseGenericBankCsv } from "./parsers/genericBank.parser.js";
import { invalidateDashboardCache } from "../../dashboard/dashboard.service.js";
import { applyBalanceDelta } from "../../accounts/balance.service.js";
import { cleanMerchantLabelSmart } from "../../../lib/merchant-cleanup.js";

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

      // Same cleanup as the PDF-statement path (see `cleanMerchantLabel`'s
      // doc comment) — a generic bank CSV's "Description" column is exactly
      // as noisy as PDF narration, since it's the same underlying bank
      // export. Categorization matches against the CLEANED merchant, not
      // the raw text, so a rule created from what the person actually sees
      // (via the Categorize popup, pre-filled from this same field) keeps
      // matching consistently on future imports too.
      const cleanedMerchant = (await cleanMerchantLabelSmart(row.merchant)) || row.merchant;
      const noteWithRaw = row.note || row.merchant;
      const categoryId = await applyCategorizationRules(userId, { merchant: cleanedMerchant, note: noteWithRaw });
      const transaction = await Transaction.create({
        userId,
        accountId,
        categoryId,
        amount: row.amount,
        date,
        merchant: cleanedMerchant,
        note: noteWithRaw,
        source: "csv_import",
        status: "confirmed",
      });

      await applyBalanceDelta(userId, accountId, row.amount);

      resultingIds.push(transaction._id.toString());
      rowResults.push({ row: i + 1, status: "success", transactionId: transaction._id.toString() });
    }

    const batch = await ImportBatch.create({
      userId,
      accountId,
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
