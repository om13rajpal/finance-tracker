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
      // The pending doc's OWN source, never a hardcoded value or something
      // client-supplied via `edits` — `pending.source`, not `merged.source`,
      // since `confirmSchema` never accepts a `source` field to merge in the
      // first place. This used to be hardcoded to "email_parsed", which was
      // harmless while that was the only possible source but became a real
      // bug once `pdf_statement_parsed` existed too.
      source: pending.source,
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

const bulkIdsSchema = z.object({ ids: z.array(z.string()).min(1) });

/**
 * Discards every listed pending transaction belonging to this user in one
 * request — the review-queue equivalent of a multi-select "delete". Ids that
 * don't exist or belong to someone else are silently excluded from the
 * delete rather than failing the whole batch (same `$in` + userId scoping
 * `/:id/reject` uses per-item, just batched); the response's `deletedCount`
 * tells the caller how many of the requested ids actually existed to
 * discard.
 */
pendingTransactionsRouter.post("/bulk-reject", async (req, res, next) => {
  try {
    const { ids } = bulkIdsSchema.parse(req.body);
    const userId = (req as any).userId;
    const result = await PendingTransaction.deleteMany({ _id: { $in: ids }, userId });
    res.json({ deletedCount: result.deletedCount });
  } catch (err) {
    next(err);
  }
});

/**
 * Confirms every listed pending transaction using ONLY its own already-known
 * values — no per-item edits, unlike `/:id/confirm`. That's a deliberate,
 * scoped difference: a bulk action over a review queue with dozens of rows
 * (e.g. after a large PDF statement import) has no per-row edit UI to source
 * edits from, so this route mirrors `/:id/confirm`'s categorization-fallback
 * and duplicate-detection logic exactly, but can't accept `accountId`,
 * `categoryId`, etc. — only the ids to confirm as-is.
 *
 * A pending transaction that can't be confirmed as-is (no `accountId` yet —
 * e.g. an email-parsed row nobody has assigned an account to; a likely
 * duplicate of an existing confirmed `Transaction`; or an id that doesn't
 * exist / isn't this user's) is skipped, not failed — same "one bad item
 * doesn't corrupt the rest of the batch" philosophy used throughout this
 * codebase's background workers. The response reports both what succeeded
 * and, for anything skipped, why, so the caller can tell the person exactly
 * which rows still need individual attention.
 */
pendingTransactionsRouter.post("/bulk-confirm", async (req, res, next) => {
  try {
    const { ids } = bulkIdsSchema.parse(req.body);
    const userId = (req as any).userId;

    const confirmedIds: string[] = [];
    const skipped: { id: string; reason: "not_found" | "account_required" | "possible_duplicate" }[] = [];

    for (const id of ids) {
      const pending = await PendingTransaction.findOne({ _id: id, userId });
      if (!pending) {
        skipped.push({ id, reason: "not_found" });
        continue;
      }
      if (!pending.accountId) {
        skipped.push({ id, reason: "account_required" });
        continue;
      }

      let categoryId: string | null = pending.categoryId ?? null;
      if (!categoryId) {
        categoryId = await applyCategorizationRules(userId, {
          merchant: pending.merchant,
          note: pending.note,
        });
      }

      const duplicate = await findLikelyDuplicate(userId, {
        accountId: pending.accountId,
        amount: pending.amount,
        date: pending.date,
      });
      if (duplicate) {
        skipped.push({ id, reason: "possible_duplicate" });
        continue;
      }

      await Transaction.create({
        userId,
        accountId: pending.accountId,
        categoryId,
        amount: pending.amount,
        date: pending.date,
        note: pending.note,
        merchant: pending.merchant,
        source: pending.source,
        status: "confirmed",
      });
      await PendingTransaction.deleteOne({ _id: pending._id });
      confirmedIds.push(id);
    }

    if (confirmedIds.length > 0) await invalidateDashboardCache(userId);
    res.json({ confirmedIds, skipped });
  } catch (err) {
    next(err);
  }
});
