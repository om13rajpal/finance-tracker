import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { PendingTransaction } from "../../models/PendingTransaction.js";
import { Transaction } from "../../models/Transaction.js";
import { findLikelyDuplicate } from "./duplicate-detection.js";
import { maybeCreateRuleFromCorrection } from "./transactions.service.js";
import { applyCategorizationRules } from "../categorization/categorization.engine.js";
import { invalidateDashboardCache } from "../dashboard/dashboard.service.js";

export const pendingTransactionsRouter = Router();
pendingTransactionsRouter.use(requireAuth);

pendingTransactionsRouter.get("/", async (req, res, next) => {
  try {
    const items = await PendingTransaction.find({ userId: (req as any).userId }).sort({ date: -1 });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

const confirmSchema = z.object({
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
  amount: z.number().optional(),
  note: z.string().optional(),
  merchant: z.string().optional(),
  createRule: z.boolean().optional(),
  matchValue: z.string().optional(),
  force: z.boolean().optional(),
});

pendingTransactionsRouter.post("/:id/confirm", async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const edits = confirmSchema.parse(req.body);

    const pending = await PendingTransaction.findOne({ _id: req.params.id, userId });
    if (!pending) return res.status(404).json({ error: "Not found" });

    // Merge edits onto the pending transaction's values — duplicate detection and
    // the resulting Transaction must both use these FINAL, post-edit values, not
    // the original parsed values.
    const merged = { ...pending.toObject(), ...edits };

    // Task 22 made `PendingTransaction.accountId` nullable — an email-parsed
    // transaction doesn't know which account it belongs to until reviewed —
    // so a Gmail-sourced pending transaction may reach this route with no
    // accountId at all. The client must supply one via `edits.accountId` in
    // that case; a clean 400 here is much better than letting a null through
    // to Transaction's schema validation (which requires accountId) and
    // surfacing as an opaque 500.
    if (!merged.accountId) {
      return res.status(400).json({ error: "accountId is required to confirm this transaction" });
    }

    let categoryId: string | null = merged.categoryId ?? null;
    if (!categoryId) {
      categoryId = await applyCategorizationRules(userId, {
        merchant: merged.merchant,
        note: merged.note,
      });
    }

    if (!edits.force) {
      const duplicate = await findLikelyDuplicate(userId, {
        accountId: merged.accountId,
        amount: merged.amount,
        date: merged.date,
      });
      if (duplicate) {
        return res.status(409).json({ note: "possible_duplicate", duplicateId: duplicate._id });
      }
    }

    const transaction = await Transaction.create({
      userId,
      accountId: merged.accountId,
      categoryId,
      amount: merged.amount,
      date: merged.date,
      note: merged.note,
      merchant: merged.merchant,
      source: "email_parsed",
      status: "confirmed",
    });

    // `matchValue` is optional on this route: the pending transaction's own
    // (possibly edited) `merchant` is already known here, so the caller
    // shouldn't have to repeat it just to opt into rule creation. An
    // explicitly-supplied `matchValue` still wins, preserving the existing
    // behavior for callers that want a rule keyed on something narrower than
    // the full merchant string (e.g. "SWIGGY" for a merchant of "SWIGGY
    // ORDER #123").
    if (edits.createRule && categoryId) {
      const matchValue = edits.matchValue || merged.merchant;
      if (matchValue) {
        await maybeCreateRuleFromCorrection(userId, matchValue, categoryId);
      }
    }

    await PendingTransaction.deleteOne({ _id: pending._id });
    await invalidateDashboardCache(userId);
    res.json(transaction);
  } catch (err) {
    next(err);
  }
});

pendingTransactionsRouter.post("/:id/reject", async (req, res, next) => {
  try {
    const result = await PendingTransaction.deleteOne({
      _id: req.params.id,
      userId: (req as any).userId,
    });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
