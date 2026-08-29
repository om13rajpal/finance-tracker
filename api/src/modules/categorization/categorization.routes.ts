import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { CategorizationRule } from "../../models/CategorizationRule.js";

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

const createSchema = z.object({
  matchField: z.enum(["merchant", "note"]),
  matchType: z.enum(["contains", "exact"]),
  matchValue: z.string().min(1),
  categoryId: z.string().min(1),
  priority: z.number().optional(),
});

categorizationRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const rule = await CategorizationRule.create({ ...data, userId: (req as any).userId });
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
