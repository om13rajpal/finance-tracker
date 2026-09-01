import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { Account } from "../../models/Account.js";
import { BalanceSnapshot } from "../../models/BalanceSnapshot.js";
import { invalidateDashboardCache } from "../dashboard/dashboard.service.js";

export const accountsRouter = Router();
accountsRouter.use(requireAuth);

accountsRouter.get("/", async (req, res, next) => {
  try {
    const accounts = await Account.find({ userId: (req as any).userId });
    res.json(accounts);
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  type: z.enum(["bank", "credit_card", "ppf", "cash"]),
  institution: z.string().min(1),
  nickname: z.string().min(1),
  currentBalance: z.number(),
  dueDate: z.string().optional(),
});

accountsRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const account = await Account.create({
      ...data,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      userId: (req as any).userId,
      isLiability: data.type === "credit_card",
    });
    await invalidateDashboardCache((req as any).userId);
    res.status(201).json(account);
  } catch (err) {
    next(err);
  }
});

const updateSchema = createSchema.partial();
accountsRouter.patch("/:id", async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const update: Record<string, unknown> = { ...data };
    if (data.dueDate) {
      update.dueDate = new Date(data.dueDate);
    }
    if (data.type) {
      update.isLiability = data.type === "credit_card";
    }
    const account = await Account.findOneAndUpdate(
      { _id: req.params.id, userId: (req as any).userId },
      update,
      { new: true }
    );
    if (!account) return res.status(404).json({ error: "Not found" });
    await invalidateDashboardCache((req as any).userId);
    res.json(account);
  } catch (err) {
    next(err);
  }
});

accountsRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await Account.deleteOne({ _id: req.params.id, userId: (req as any).userId });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    await invalidateDashboardCache((req as any).userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

const balanceSchema = z.object({ balance: z.number() });
accountsRouter.post("/:id/balance", async (req, res, next) => {
  try {
    const { balance } = balanceSchema.parse(req.body);
    const userId = (req as any).userId;

    // Read first (not for a guard — a manual correction ALWAYS wins, no staleness
    // check the way `reconcileBalance` has) purely to capture `previousBalance` for
    // the audit-trail snapshot below.
    const previous = await Account.findOne({ _id: req.params.id, userId });
    if (!previous) return res.status(404).json({ error: "Not found" });

    const now = new Date();
    const account = await Account.findOneAndUpdate(
      { _id: req.params.id, userId },
      // `balanceAsOf: now` matters as much as `currentBalance` itself: it stamps
      // this figure as accurate "as of right now," so a LATER-processed automated
      // reconciliation describing an EARLIER point in time (an old statement
      // uploaded after the fact, a delayed email alert) correctly loses to this
      // correction via `reconcileBalance`'s own staleness guard instead of
      // silently overwriting it.
      { currentBalance: balance, balanceAsOf: now, lastUpdated: now },
      { new: true }
    );
    if (!account) return res.status(404).json({ error: "Not found" });

    await BalanceSnapshot.create({
      accountId: account._id.toString(),
      balance,
      date: now,
      source: "manual",
      previousBalance: previous.currentBalance,
      delta: Math.round((balance - previous.currentBalance) * 100) / 100,
      asOf: now,
    });
    await invalidateDashboardCache(userId);
    res.json(account);
  } catch (err) {
    next(err);
  }
});

accountsRouter.get("/:id/balance-history", async (req, res, next) => {
  try {
    const account = await Account.findOne({ _id: req.params.id, userId: (req as any).userId });
    if (!account) return res.status(404).json({ error: "Not found" });

    const history = await BalanceSnapshot.find({ accountId: account._id.toString() }).sort({ date: 1 });
    res.json(history);
  } catch (err) {
    next(err);
  }
});
