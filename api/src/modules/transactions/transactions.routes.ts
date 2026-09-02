import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { Transaction } from "../../models/Transaction.js";
import { RecurringTransaction } from "../../models/RecurringTransaction.js";
import { applyCategorizationRules } from "../categorization/categorization.engine.js";
import { maybeCreateRuleFromCorrection, encodeCursor, decodeCursor } from "./transactions.service.js";
import { findLikelyDuplicate } from "./duplicate-detection.js";
import { invalidateDashboardCache } from "../dashboard/dashboard.service.js";
import { applyBalanceDelta } from "../accounts/balance.service.js";

export const transactionsRouter = Router();
transactionsRouter.use(requireAuth);

transactionsRouter.get("/", async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const filter: Record<string, unknown> = { userId };
    if (req.query.accountId) filter.accountId = req.query.accountId;
    if (req.query.categoryId) filter.categoryId = req.query.categoryId;
    if (req.query.dateFrom || req.query.dateTo) {
      filter.date = {
        ...(req.query.dateFrom ? { $gte: new Date(req.query.dateFrom as string) } : {}),
        ...(req.query.dateTo ? { $lte: new Date(req.query.dateTo as string) } : {}),
      };
    }

    if (req.query.cursor) {
      const { date, id } = decodeCursor(req.query.cursor as string);
      filter.$or = [{ date: { $lt: date } }, { date, _id: { $lt: id } }];
    }

    const items = await Transaction.find(filter)
      .sort({ date: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = items.length > limit;
    const page = items.slice(0, limit);
    const nextCursor = hasMore ? encodeCursor(page.at(-1)!.date, page.at(-1)!._id.toString()) : null;

    res.json({ items: page, nextCursor });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  accountId: z.string().min(1),
  categoryId: z.string().optional(),
  amount: z.number(),
  date: z.string(),
  note: z.string().optional(),
  merchant: z.string().optional(),
  force: z.boolean().optional(),
});

transactionsRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const date = new Date(data.date);

    if (!data.force) {
      const duplicate = await findLikelyDuplicate((req as any).userId, {
        accountId: data.accountId,
        amount: data.amount,
        date,
      });
      if (duplicate) {
        return res.status(409).json({ note: "possible_duplicate", duplicateId: duplicate._id });
      }
    }

    let categoryId = data.categoryId ?? null;
    if (!categoryId) {
      categoryId = await applyCategorizationRules((req as any).userId, {
        merchant: data.merchant,
        note: data.note,
      });
    }

    const transaction = await Transaction.create({
      ...data,
      categoryId,
      date,
      userId: (req as any).userId,
      source: "manual",
      status: "confirmed",
    });
    await applyBalanceDelta((req as any).userId, data.accountId, data.amount);
    await invalidateDashboardCache((req as any).userId);
    res.status(201).json(transaction);
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  categoryId: z.string().optional(),
  amount: z.number().optional(),
  date: z.string().optional(),
  note: z.string().optional(),
  merchant: z.string().optional(),
  createRule: z.boolean().optional(),
  matchValue: z.string().optional(),
  // A person-initiated "this is recurring" flag, mirroring `createRule`'s
  // shape: opt-in, bundled into the same save as the rest of the edit,
  // never inferred automatically (that's what `detectRecurringSuggestions`
  // is for, over CONFIRMED history). Requires a category, same as
  // `RecurringTransaction.categoryId` being a required field: there's no
  // sensible "recurring but uncategorised" commitment to track.
  createRecurring: z.boolean().optional(),
  recurringFrequency: z.enum(["monthly", "weekly", "yearly", "custom"]).optional(),
  recurringNextDueDate: z.string().optional(),
});

transactionsRouter.patch("/:id", async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const { createRule, matchValue, createRecurring, recurringFrequency, recurringNextDueDate, ...updateFields } =
      data;
    const userId = (req as any).userId;

    const update: Record<string, unknown> = { ...updateFields };
    if (updateFields.date) {
      update.date = new Date(updateFields.date);
    }

    // Read the PRE-edit transaction first: `accountId` is never editable (not in
    // `updateSchema`), so the account this balance change applies to is fixed, but
    // the amount's DELTA (new minus old) can only be known by comparing against
    // what it used to be.
    const existing = await Transaction.findOne({ _id: req.params.id, userId });
    if (!existing) return res.status(404).json({ error: "Not found" });

    const transaction = await Transaction.findOneAndUpdate({ _id: req.params.id, userId }, update, {
      new: true,
    });
    if (!transaction) return res.status(404).json({ error: "Not found" });

    // A transaction confirmed from a reconciled statement import (or an
    // email-balance reconciliation) never had its `amount` applied as a
    // delta in the first place (see `balanceDeltaApplied` on the
    // `Transaction` model), so adjusting the balance here would be applying
    // a delta that was never there to begin with.
    if (data.amount !== undefined && data.amount !== existing.amount && existing.balanceDeltaApplied !== false) {
      await applyBalanceDelta(userId, existing.accountId, data.amount - existing.amount);
    }

    if (createRule && matchValue && data.categoryId) {
      await maybeCreateRuleFromCorrection(userId, matchValue, data.categoryId);
    }

    if (createRecurring && recurringFrequency && recurringNextDueDate && transaction.categoryId) {
      await RecurringTransaction.create({
        userId,
        name: transaction.merchant || transaction.note || "Recurring payment",
        type: transaction.amount < 0 ? "expense" : "income",
        amount: Math.abs(transaction.amount),
        frequency: recurringFrequency,
        nextDueDate: new Date(recurringNextDueDate),
        accountId: transaction.accountId,
        categoryId: transaction.categoryId,
      });
    }

    await invalidateDashboardCache(userId);
    res.json(transaction);
  } catch (err) {
    next(err);
  }
});

transactionsRouter.delete("/:id", async (req, res, next) => {
  try {
    const userId = (req as any).userId;
    // Read before delete: the balance reversal needs the transaction's own
    // amount/accountId, which are gone the instant `deleteOne` succeeds.
    const transaction = await Transaction.findOne({ _id: req.params.id, userId });
    if (!transaction) return res.status(404).json({ error: "Not found" });

    await Transaction.deleteOne({ _id: req.params.id, userId });
    // See `balanceDeltaApplied`'s doc comment on the Transaction model: only
    // reverse a delta that was actually applied when this transaction was
    // created. Reversing unconditionally used to move a reconciled account's
    // balance in the WRONG direction, since there was no delta to undo.
    if (transaction.balanceDeltaApplied !== false) {
      await applyBalanceDelta(userId, transaction.accountId, -transaction.amount);
    }
    await invalidateDashboardCache(userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
