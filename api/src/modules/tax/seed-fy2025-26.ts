/**
 * Seeds illustrative TaxSlabConfig data for FY2025-26 (old + new regime).
 *
 * *** THESE FIGURES ARE ILLUSTRATIVE, NOT AUTHORITATIVE. ***
 * Indian tax slabs, rebate limits, and capital gains rules change with every
 * Union Budget. Before relying on this app's tax estimate for any real
 * decision, verify every number below against the actual FY2025-26
 * notification (or whichever FY you're using) from the Income Tax
 * Department, and update via POST /tax/slab-config if anything differs.
 * This script is a starting point, not a source of truth.
 *
 * Run manually: not part of automatic seeding, since tax figures should
 * never silently propagate into a running app without a human confirming
 * they're current.
 */
import { connectDB } from "../../config/db.js";
import { TaxSlabConfig } from "../../models/TaxSlabConfig.js";
import mongoose from "mongoose";

async function seed() {
  await connectDB();

  await TaxSlabConfig.findOneAndUpdate(
    { financialYear: "2025-26", regime: "new" },
    {
      financialYear: "2025-26",
      regime: "new",
      standardDeduction: 75000,
      slabs: [
        { upTo: 400000, rate: 0 },
        { upTo: 800000, rate: 0.05 },
        { upTo: 1200000, rate: 0.1 },
        { upTo: 1600000, rate: 0.15 },
        { upTo: 2000000, rate: 0.2 },
        { upTo: 2400000, rate: 0.25 },
        { upTo: null, rate: 0.3 },
      ],
      section87ARebateLimit: 1200000,
      section87ARebateMaxTax: 60000,
      section80CLimit: 0, // new regime does not allow the 80C deduction
      capitalGains: {
        equity: { stcgHoldingDays: 365, stcgRate: 0.2, ltcgRate: 0.125, ltcgExemptionLimit: 125000 },
        debt: { stcgHoldingDays: 0, stcgRate: null, ltcgRate: null, ltcgExemptionLimit: 0 },
      },
    },
    { upsert: true }
  );

  await TaxSlabConfig.findOneAndUpdate(
    { financialYear: "2025-26", regime: "old" },
    {
      financialYear: "2025-26",
      regime: "old",
      standardDeduction: 50000,
      slabs: [
        { upTo: 250000, rate: 0 },
        { upTo: 500000, rate: 0.05 },
        { upTo: 1000000, rate: 0.2 },
        { upTo: null, rate: 0.3 },
      ],
      section87ARebateLimit: 500000,
      section87ARebateMaxTax: 12500,
      section80CLimit: 150000,
      capitalGains: {
        equity: { stcgHoldingDays: 365, stcgRate: 0.2, ltcgRate: 0.125, ltcgExemptionLimit: 125000 },
        debt: { stcgHoldingDays: 0, stcgRate: null, ltcgRate: null, ltcgExemptionLimit: 0 },
      },
    },
    { upsert: true }
  );

  console.log("Seeded FY2025-26 tax slab config (old + new regime). VERIFY THESE FIGURES before real use.");
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
