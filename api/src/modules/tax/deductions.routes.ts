import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { TaxDeduction } from "../../models/TaxDeduction.js";
import { syncAutoDeductions } from "./deductions.service.js";

export const deductionsRouter = Router();
deductionsRouter.use(requireAuth);

deductionsRouter.get("/", async (req, res, next) => {
  try {
    const fy = req.query.fy as string | undefined;
    if (!fy) return res.status(400).json({ error: "fy query param is required" });
    // Refresh the auto-derived (ELSS) deduction from the user's tagged HoldingLots
    // before listing, so the auto row is always current with the holdings it's
    // derived from rather than a snapshot taken at some earlier write.
    await syncAutoDeductions((req as any).userId, fy);
    const deductions = await TaxDeduction.find({ userId: (req as any).userId, financialYear: fy });
    res.json(deductions);
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  section: z.string().min(1),
  amount: z.number(),
  financialYear: z.string(),
});

deductionsRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const deduction = await TaxDeduction.create({ ...data, userId: (req as any).userId, source: "manual" });
    res.status(201).json(deduction);
  } catch (err) {
    next(err);
  }
});

deductionsRouter.delete("/:id", async (req, res, next) => {
  try {
    const deduction = await TaxDeduction.findOne({ _id: req.params.id, userId: (req as any).userId });
    if (!deduction) return res.status(404).json({ error: "Not found" });
    if (deduction.source !== "manual") {
      return res.status(400).json({ error: "Auto-derived deductions can't be deleted directly; they update automatically." });
    }
    await TaxDeduction.deleteOne({ _id: deduction._id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
