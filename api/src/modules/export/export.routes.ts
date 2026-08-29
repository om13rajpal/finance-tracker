import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { Account } from "../../models/Account.js";
import { Transaction } from "../../models/Transaction.js";
import { HoldingLot } from "../../models/HoldingLot.js";
import { Goal } from "../../models/Goal.js";
import { RecurringTransaction } from "../../models/RecurringTransaction.js";

export const exportRouter = Router();
exportRouter.use(requireAuth);

exportRouter.get("/", async (req, res, next) => {
  try {
    const userId = (req as any).userId;

    const [accounts, transactions, holdingLots, goals, recurringTransactions] = await Promise.all([
      Account.find({ userId }).lean(),
      Transaction.find({ userId }).lean(),
      HoldingLot.find({ userId }).lean(),
      Goal.find({ userId }).lean(),
      RecurringTransaction.find({ userId }).lean(),
    ]);

    res.setHeader("Content-Disposition", 'attachment; filename="finance-tracker-export.json"');
    res.json({ accounts, transactions, holdingLots, goals, recurringTransactions });
  } catch (err) {
    next(err);
  }
});
