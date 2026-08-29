import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { getDashboard } from "./dashboard.service.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (req, res, next) => {
  try {
    const result = await getDashboard((req as any).userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
