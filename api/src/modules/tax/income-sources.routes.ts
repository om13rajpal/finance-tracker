import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { IncomeSource } from "../../models/IncomeSource.js";

export const incomeSourcesRouter = Router();
incomeSourcesRouter.use(requireAuth);

incomeSourcesRouter.get("/", async (req, res, next) => {
  try {
    const fy = req.query.fy as string | undefined;
    const filter: Record<string, unknown> = { userId: (req as any).userId };
    if (fy) filter.financialYear = fy;
    const sources = await IncomeSource.find(filter);
    res.json(sources);
  } catch (err) {
    next(err);
  }
});

const breakdownSchema = z.object({
  basic: z.number().optional(),
  hra: z.number().optional(),
  allowances: z.number().optional(),
  rentPaidAnnual: z.number().optional(),
  isMetro: z.boolean().optional(),
});

const createSchema = z.object({
  type: z.enum(["salary", "other"]),
  financialYear: z.string(),
  annualAmount: z.number(),
  breakdown: breakdownSchema.optional(),
});

incomeSourcesRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const source = await IncomeSource.create({ ...data, userId: (req as any).userId });
    res.status(201).json(source);
  } catch (err) {
    next(err);
  }
});

const updateSchema = createSchema.partial();
incomeSourcesRouter.patch("/:id", async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const source = await IncomeSource.findOneAndUpdate(
      { _id: req.params.id, userId: (req as any).userId },
      data,
      { new: true }
    );
    if (!source) return res.status(404).json({ error: "Not found" });
    res.json(source);
  } catch (err) {
    next(err);
  }
});

incomeSourcesRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await IncomeSource.deleteOne({ _id: req.params.id, userId: (req as any).userId });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
