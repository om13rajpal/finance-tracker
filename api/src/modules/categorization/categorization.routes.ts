import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { CategorizationRule } from "../../models/CategorizationRule.js";
import { PendingTransaction } from "../../models/PendingTransaction.js";
import { Transaction } from "../../models/Transaction.js";
import { getCategorizationSuggestions } from "./categorization-suggestions.service.js";
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
