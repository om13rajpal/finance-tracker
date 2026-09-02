import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { CategorizationRule } from "../../models/CategorizationRule.js";
import { PendingTransaction } from "../../models/PendingTransaction.js";
import { Transaction } from "../../models/Transaction.js";
import { getCategorizationSuggestions } from "./categorization-suggestions.service.js";
import { matchesRule } from "./categorization.engine.js";
import { invalidateDashboardCache } from "../dashboard/dashboard.service.js";

export const categorizationRouter = Router();
categorizationRouter.use(requireAuth);

categorizationRouter.get("/", async (req, res, next) => {
  try {
    const rules = await CategorizationRule.find({ userId: (req as any).userId }).sort({ priority: 1 });
    res.json(rules);
  } catch (err) {
    next(err);
  }
});

// Mounted above the (parameterless-collision-free but still worth keeping
// convention with) rest of this router's static routes: see
// `getCategorizationSuggestions`'s own doc comment for what this surfaces
// and why it never touches data on its own.
categorizationRouter.get("/suggestions", async (req, res, next) => {
  try {
    const suggestions = await getCategorizationSuggestions((req as any).userId);
    res.json(suggestions);
  } catch (err) {
    next(err);
  }
});

const previewSchema = z.object({
  matchField: z.enum(["merchant", "note"]),
  matchType: z.enum(["contains", "exact"]),
  matchValue: z.string().min(1),
});

/**
 * Answers, up front, exactly which existing UNCATEGORISED pending and
 * confirmed transactions a rule with these match criteria would apply to if
 * created right now: what the "Add a rule" form shows live as the person
 * types, so they can see and pick from the affected transactions before
 * committing, then pass the ones they want back as `applyToPendingIds`/
 * `applyToTransactionIds` on the actual `POST /`. Read-only: creates
 * nothing, changes nothing.
 *
 * Only ever-uncategorised rows are candidates: an already-categorised
 * transaction is never silently reassigned by a new rule (same "never
 * backfill without an explicit, itemised opt-in" boundary `POST /`'s own
 * `applyToPendingIds`/`applyToTransactionIds` already enforces).
 *
 * Filters in application code with the exact same `matchesRule` the live
 * engine uses, rather than a parallel Mongo query, so this can never drift
 * out of sync with what creating the rule would actually do. Personal-scale
 * data (at most a few hundred rows), so an in-memory filter over every
 * uncategorised row is cheap; capped at 500 each anyway as a sane ceiling.
 */
categorizationRouter.get("/preview", async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const criteria = previewSchema.parse(req.query);

    const [pendingCandidates, transactionCandidates] = await Promise.all([
      PendingTransaction.find({ userId, categoryId: null }).limit(500).lean(),
      Transaction.find({ userId, categoryId: null }).limit(500).lean(),
    ]);

    const pending = pendingCandidates
      .filter((tx) => matchesRule(criteria, tx))
      .map((tx) => ({
        _id: tx._id,
        merchant: tx.merchant,
        note: tx.note,
        amount: tx.amount,
        date: tx.date,
        source: tx.source,
      }));
    const transactions = transactionCandidates
      .filter((tx) => matchesRule(criteria, tx))
      .map((tx) => ({
        _id: tx._id,
        merchant: tx.merchant,
        note: tx.note,
        amount: tx.amount,
        date: tx.date,
        source: tx.source,
      }));

    res.json({ pending, transactions });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  matchField: z.enum(["merchant", "note"]),
  matchType: z.enum(["contains", "exact"]),
  matchValue: z.string().min(1),
  categoryId: z.string().min(1),
  priority: z.number().optional(),
  // Optional, and ONLY ever populated by the frontend's "accept this
  // suggestion" action (see `getCategorizationSuggestions`): a deliberate,
  // person-initiated, narrowly-scoped exception to this app's general "never
  // backfill existing data when a rule is created" rule: it applies the new
  // rule's `categoryId` ONLY to these specific already-known ids (exactly the
  // ones that prompted the suggestion the person is looking at), never a
  // broader retroactive sweep over history.
  applyToPendingIds: z.array(z.string()).optional(),
  applyToTransactionIds: z.array(z.string()).optional(),
});

categorizationRouter.post("/", async (req, res, next) => {
  try {
    const { applyToPendingIds, applyToTransactionIds, ...data } = createSchema.parse(req.body);
    const userId = (req as any).userId;
    const rule = await CategorizationRule.create({ ...data, userId });

    if (applyToPendingIds && applyToPendingIds.length > 0) {
      await PendingTransaction.updateMany(
        { _id: { $in: applyToPendingIds }, userId, categoryId: null },
        { categoryId: data.categoryId }
      );
    }
    if (applyToTransactionIds && applyToTransactionIds.length > 0) {
      await Transaction.updateMany(
        { _id: { $in: applyToTransactionIds }, userId, categoryId: null },
        { categoryId: data.categoryId }
      );
      await invalidateDashboardCache(userId);
    }

    res.status(201).json(rule);
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  matchField: z.enum(["merchant", "note"]).optional(),
  matchType: z.enum(["contains", "exact"]).optional(),
  matchValue: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  priority: z.number().optional(),
});

/**
 * Edits an existing rule's match criteria and/or category. Deliberately does
 * NOT touch anything already-categorised: unlike `POST /`'s opt-in
 * `applyToPendingIds`/`applyToTransactionIds`, changing a rule after the
 * fact never retroactively reassigns transactions this rule (or its
 * previous version) already filed, only changes what it matches going
 * forward. That backfill-on-edit case doesn't exist yet; if it's ever
 * needed it should be its own explicit, itemised opt-in, the same shape as
 * creation's.
 */
categorizationRouter.patch("/:id", async (req, res, next) => {
  try {
    const edits = updateSchema.parse(req.body);
    const rule = await CategorizationRule.findOneAndUpdate(
      { _id: req.params.id, userId: (req as any).userId },
      edits,
      { new: true }
    );
    if (!rule) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(rule);
  } catch (err) {
    next(err);
  }
});

categorizationRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await CategorizationRule.deleteOne({ _id: req.params.id, userId: (req as any).userId });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
