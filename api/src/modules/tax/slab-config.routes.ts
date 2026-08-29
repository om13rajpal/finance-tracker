import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware.js";
import { TaxSlabConfig } from "../../models/TaxSlabConfig.js";

export const slabConfigRouter = Router();
slabConfigRouter.use(requireAuth);

slabConfigRouter.get("/", async (_req, res, next) => {
  try {
    const configs = await TaxSlabConfig.find().sort({ financialYear: -1, regime: 1 });
    res.json(configs);
  } catch (err) {
    next(err);
  }
});

const slabSchema = z.object({ upTo: z.number().nullable(), rate: z.number() });
const capitalGainsBucketSchema = z.object({
  stcgHoldingDays: z.number(),
  stcgRate: z.number().nullable(),
  ltcgRate: z.number().nullable(),
  ltcgExemptionLimit: z.number(),
});

const configSchema = z.object({
  financialYear: z.string(),
  regime: z.enum(["old", "new"]),
  standardDeduction: z.number(),
  slabs: z.array(slabSchema),
  section87ARebateLimit: z.number(),
  section87ARebateMaxTax: z.number(),
  // Required, deliberately NOT optional: TaxSlabConfig's mongoose schema defaults
  // section80CLimit to 150000, so omitting it on a NEW-regime config would silently
  // grant Rs. 1,50,000 of deductions that regime does not allow and understate its
  // tax. Every tax figure here must be entered explicitly, never inherited from a
  // schema default. (Use 0 for the new regime.)
  section80CLimit: z.number(),
  capitalGains: z.object({
    equity: capitalGainsBucketSchema,
    debt: capitalGainsBucketSchema,
  }),
});

// Upsert on {financialYear, regime} — a repeat POST for the same FY+regime updates
// the existing config in place rather than creating a duplicate (also enforced at
// the DB layer by TaxSlabConfig's unique index on {financialYear, regime}).
slabConfigRouter.post("/", async (req, res, next) => {
  try {
    const data = configSchema.parse(req.body);
    const config = await TaxSlabConfig.findOneAndUpdate(
      { financialYear: data.financialYear, regime: data.regime },
      data,
      { upsert: true, new: true }
    );
    res.status(201).json(config);
  } catch (err) {
    next(err);
  }
});
