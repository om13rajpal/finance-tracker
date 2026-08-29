import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { Category } from "../../models/Category.js";
import { getCategoryTree } from "./categories.service.js";
import { invalidateDashboardCache } from "../dashboard/dashboard.service.js";

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

categoriesRouter.get("/", async (req, res, next) => {
  try {
    const tree = await getCategoryTree((req as any).userId);
    res.json(tree);
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["expense", "income"]),
  bucket: z.enum(["fixed_costs", "investments", "savings", "guilt_free"]),
  color: z.string().optional(),
  parentCategoryId: z.string().optional(),
  budgetLimit: z.number().optional(),
});

categoriesRouter.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const category = await Category.create({ ...data, userId: (req as any).userId });
    await invalidateDashboardCache((req as any).userId);
    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
});

const updateSchema = createSchema.partial();
categoriesRouter.patch("/:id", async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    if (data.parentCategoryId && data.parentCategoryId === req.params.id) {
      return res.status(400).json({ error: "A category cannot be its own parent" });
    }
    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, userId: (req as any).userId },
      data,
      { new: true }
    );
    if (!category) return res.status(404).json({ error: "Not found" });
    await invalidateDashboardCache((req as any).userId);
    res.json(category);
  } catch (err) {
    next(err);
  }
});

categoriesRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await Category.deleteOne({ _id: req.params.id, userId: (req as any).userId });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
    await invalidateDashboardCache((req as any).userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
