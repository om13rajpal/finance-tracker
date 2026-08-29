import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { RecurringTransaction } from "../../models/RecurringTransaction.js";
import { invalidateDashboardCache } from "../dashboard/dashboard.service.js";

export const recurringRouter = Router();
recurringRouter.use(requireAuth);

recurringRouter.get("/upcoming", async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 30;
    const now = new Date();
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const items = await RecurringTransaction.find({
      userId: (req as any).userId,
      status: "active",
      nextDueDate: { $gte: now, $lte: until },
    }).sort({ nextDueDate: 1 });

    res.json(items);
  } catch (err) {
    next(err);
  }
});

recurringRouter.get("/", async (req, res, next) => {
  try {
    const items = await RecurringTransaction.find({ userId: (req as any).userId }).sort({ nextDueDate: 1 });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["expense", "income"]),
  amount: z.number(),
  frequency: z.enum(["monthly", "weekly", "yearly", "custom"]),
  nextDueDate: z.string(),
  accountId: z.string().min(1),
  categoryId: z.string().min(1),
  linkedHoldingSymbol: z.string().optional(),
  autoCreate: z.boolean().optional(),
});

recurringRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const item = await RecurringTransaction.create({
      ...data,
      nextDueDate: new Date(data.nextDueDate),
      userId: (req as any).userId,
    });
    await invalidateDashboardCache((req as any).userId);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

const updateSchema = createSchema.partial().extend({ status: z.enum(["active", "paused", "cancelled"]).optional() });
recurringRouter.patch("/:id", async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const update: Record<string, unknown> = { ...data };
    if (data.nextDueDate) {
      update.nextDueDate = new Date(data.nextDueDate);
    }
    const item = await RecurringTransaction.findOneAndUpdate(
      { _id: req.params.id, userId: (req as any).userId },
      update,
      { new: true }
    );
    if (!item) return res.status(404).json({ error: "Not found" });
    await invalidateDashboardCache((req as any).userId);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

recurringRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await RecurringTransaction.deleteOne({ _id: req.params.id, userId: (req as any).userId });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    await invalidateDashboardCache((req as any).userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
