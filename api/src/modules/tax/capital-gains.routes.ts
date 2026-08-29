import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { SellEvent } from "../../models/SellEvent.js";

export const capitalGainsRouter = Router();
capitalGainsRouter.use(requireAuth);

capitalGainsRouter.get("/", async (req, res, next) => {
  try {
    const fy = req.query.fy as string | undefined;
    if (!fy) return res.status(400).json({ error: "fy query param is required" });

    const userId = (req as any).userId;
    const events = await SellEvent.find({ userId, financialYear: fy }).sort({ sellDate: -1 });

    const totals = events.reduce(
      (acc, e) => {
        if (e.classification === "STCG") {
          acc.stcg += e.gainAmount;
          acc.stcgCount += 1;
        } else {
          acc.ltcg += e.gainAmount;
          acc.ltcgCount += 1;
        }
        return acc;
      },
      { stcg: 0, ltcg: 0, stcgCount: 0, ltcgCount: 0 }
    );

    res.json({ events, totals });
  } catch (err) {
    next(err);
  }
});
