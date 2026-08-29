import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { Transaction } from "../../models/Transaction.js";
import { applyCategorizationRules } from "../categorization/categorization.engine.js";
import { maybeCreateRuleFromCorrection, encodeCursor, decodeCursor } from "./transactions.service.js";
import { findLikelyDuplicate } from "./duplicate-detection.js";
import { invalidateDashboardCache } from "../dashboard/dashboard.service.js";

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
});

transactionsRouter.patch("/:id", async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const { createRule, matchValue, ...updateFields } = data;

    const update: Record<string, unknown> = { ...updateFields };
    if (updateFields.date) {
      update.date = new Date(updateFields.date);
    }

    const transaction = await Transaction.findOneAndUpdate(
      { _id: req.params.id, userId: (req as any).userId },
      update,
      { new: true }
    );
    if (!transaction) return res.status(404).json({ error: "Not found" });

    if (createRule && matchValue && data.categoryId) {
      await maybeCreateRuleFromCorrection((req as any).userId, matchValue, data.categoryId);
    }

    await invalidateDashboardCache((req as any).userId);
    res.json(transaction);
  } catch (err) {
    next(err);
  }
});

transactionsRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await Transaction.deleteOne({ _id: req.params.id, userId: (req as any).userId });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    await invalidateDashboardCache((req as any).userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
