import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { PendingTransaction } from "../../models/PendingTransaction.js";
import { Transaction } from "../../models/Transaction.js";
import { findLikelyDuplicate, findLikelyDuplicatesBatch } from "./duplicate-detection.js";
import { maybeCreateRuleFromCorrection } from "./transactions.service.js";
import { applyCategorizationRules } from "../categorization/categorization.engine.js";
import { invalidateDashboardCache } from "../dashboard/dashboard.service.js";
import { applyConfirmedTransactionBalanceEffect } from "../accounts/balance.service.js";
import { BulkConfirmBatch } from "../../models/BulkConfirmBatch.js";
import { bulkConfirmPendingQueue } from "../../jobs/workers/bulkConfirmPending.worker.js";

export const pendingTransactionsRouter = Router();
pendingTransactionsRouter.use(requireAuth);

pendingTransactionsRouter.get("/", async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const items = await PendingTransaction.find({ userId }).sort({ date: -1 });

    // Flag each row that's likely a duplicate of an already-confirmed
    // Transaction UP FRONT, in the list itself, not just at confirm time.
    // This is the same window/account/amount check `findLikelyDuplicate`
    // does per-item at confirm; batched here (see
    // `findLikelyDuplicatesBatch`'s doc comment) so the review queue itself
    // can show it before the person tries to file anything, which matters
    // most exactly when several overlapping statement imports have queued
    // up the same real transaction more than once. Only rows with an
    // account assigned can be checked at all (the query needs one): an
    // email-parsed row still waiting on an account is never flagged.
    const withAccount = items
      .map((item, index) => ({ item, index }))
      .filter((x) => x.item.accountId);
    const duplicateIndexes = await findLikelyDuplicatesBatch(
      userId,
      withAccount.map((x) => ({ accountId: x.item.accountId as string, amount: x.item.amount, date: x.item.date }))
    );
    const duplicatePendingIds = new Set(
      withAccount.filter((x, i) => duplicateIndexes.has(i)).map((x) => x.item._id.toString())
    );

    const withFlags = items.map((item) => ({
      ...item.toObject(),
      possibleDuplicate: duplicatePendingIds.has(item._id.toString()),
    }));

    res.json(withFlags);
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

    // Merge edits onto the pending transaction's values: duplicate detection and
    // the resulting Transaction must both use these FINAL, post-edit values, not
    // the original parsed values.
    const merged = { ...pending.toObject(), ...edits };

    // Task 22 made `PendingTransaction.accountId` nullable (an email-parsed
    // transaction doesn't know which account it belongs to until reviewed),
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

    const balanceDeltaApplied = await applyConfirmedTransactionBalanceEffect(
      userId,
      merged.accountId,
      merged.amount,
      merged.emailBalance ?? null,
      merged.date,
      // Only honor the "already reconciled" flag if this confirm didn't
      // redirect the transaction to a DIFFERENT account than the one its
      // import actually reconciled: the reconciliation's assumption (this
      // money left THAT account) no longer holds if it didn't, in the end,
      // stay on that account, and the rare case of editing a PDF-statement
      // row's account during confirm needs its normal delta applied like any
      // other transaction.
      pending.balanceReconciledAtImport === true && merged.accountId === pending.accountId
    );

    const transaction = await Transaction.create({
      userId,
      accountId: merged.accountId,
      categoryId,
      amount: merged.amount,
      date: merged.date,
      note: merged.note,
      merchant: merged.merchant,
      // The pending doc's OWN source, never a hardcoded value or something
      // client-supplied via `edits`: `pending.source`, not `merged.source`,
      // since `confirmSchema` never accepts a `source` field to merge in the
      // first place. This used to be hardcoded to "email_parsed", which was
      // harmless while that was the only possible source but became a real
      // bug once `pdf_statement_parsed` existed too.
      source: pending.source,
      status: "confirmed",
      balanceDeltaApplied,
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
 * request: the review-queue equivalent of a multi-select "delete". Ids that
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
 * Enqueues a background confirm of every listed pending transaction, using
 * ONLY each one's own already-known values, no per-item edits, unlike
 * `/:id/confirm`. That's a deliberate, scoped difference: a bulk action over
 * a review queue with dozens of rows (e.g. after a large PDF statement
 * import) has no per-row edit UI to source edits from, so the worker mirrors
 * `/:id/confirm`'s categorization-fallback and duplicate-detection logic
 * exactly, but can't accept `accountId`, `categoryId`, etc.: only the ids
 * to confirm as-is.
 *
 * Async, not synchronous: confirming each pending transaction is several
 * sequential DB round trips, and running all of that inline for a large
 * batch (117 items, in production) reliably exceeded the request-timeout
 * path and returned a raw 502 with zero user-facing feedback, even though
 * the work kept running server-side and mostly succeeded. This returns
 * `202` immediately with a `batchId` for `GET /bulk-confirm/:batchId` to
 * poll; see `bulkConfirmPending.worker.ts`.
 *
 * A pending transaction that can't be confirmed as-is (no `accountId` yet,
 * e.g. an email-parsed row nobody has assigned an account to; a likely
 * duplicate of an existing confirmed `Transaction`; or an id that doesn't
 * exist / isn't this user's) is skipped, not failed, same "one bad item
 * doesn't corrupt the rest of the batch" philosophy used throughout this
 * codebase's background workers. The batch's `results` report both what
 * succeeded and, for anything skipped, why, so the caller can tell the
 * person exactly which rows still need individual attention.
 */
pendingTransactionsRouter.post("/bulk-confirm", async (req, res, next) => {
  try {
    const { ids } = bulkIdsSchema.parse(req.body);
    const userId = (req as any).userId;

    const batch = await BulkConfirmBatch.create({ userId, status: "processing", total: ids.length, results: [] });
    await bulkConfirmPendingQueue.add("confirm", { batchId: batch._id.toString(), userId, ids });

    res.status(202).json({ batchId: batch._id, status: "processing" });
  } catch (err) {
    next(err);
  }
});

/**
 * Polled by the frontend after the `202` above to watch a bulk-confirm run's
 * async progress until it reaches a terminal `status`
 * (`"completed"`/`"failed"`). Scoped to `req.userId`: a batch that exists
 * but belongs to someone else 404s exactly like one that doesn't exist at
 * all, same as the equivalent PDF-import poll route.
 */
pendingTransactionsRouter.get("/bulk-confirm/:batchId", async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const batch = await BulkConfirmBatch.findOne({ _id: req.params.batchId, userId });
    if (!batch) return res.status(404).json({ error: "Bulk-confirm batch not found" });
    res.status(200).json(batch);
  } catch (err) {
    next(err);
  }
});
