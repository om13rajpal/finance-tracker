import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { Goal } from "../../models/Goal.js";

export const goalsRouter = Router();
goalsRouter.use(requireAuth);

goalsRouter.get("/", async (req, res, next) => {
  try {
    const goals = await Goal.find({ userId: (req as any).userId });
    res.json(goals);
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  name: z.string().min(1),
  targetAmount: z.number(),
  currentAmount: z.number().optional(),
  targetDate: z.string().optional(),
});

goalsRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const goal = await Goal.create({
      ...data,
      targetDate: data.targetDate ? new Date(data.targetDate) : null,
      userId: (req as any).userId,
    });
    res.status(201).json(goal);
  } catch (err) {
    next(err);
  }
});

const updateSchema = createSchema.partial();
goalsRouter.patch("/:id", async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const update: Record<string, unknown> = { ...data };
    if (data.targetDate) {
      update.targetDate = new Date(data.targetDate);
    }
    const goal = await Goal.findOneAndUpdate(
      { _id: req.params.id, userId: (req as any).userId },
      update,
      { new: true }
    );
    if (!goal) return res.status(404).json({ error: "Not found" });
    res.json(goal);
  } catch (err) {
    next(err);
  }
});

goalsRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await Goal.deleteOne({ _id: req.params.id, userId: (req as any).userId });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
