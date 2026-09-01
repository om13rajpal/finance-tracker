import { Schema, model } from "mongoose";

/**
 * Global (not per-user) cache of raw-narration-shape -> LLM-cleaned merchant
 * name, so a given bank/gateway's narration pattern is only ever sent to the
 * LLM once, no matter how many users or transactions produce it. `rawKey` is
 * a normalized shape of the narration (see `normalizeForCacheKey` in
 * `merchant-llm-cleanup.ts`), not the literal raw text — two transactions
 * from the same merchant almost always differ in embedded reference numbers,
 * so caching on the literal text would defeat the cache entirely.
 */
const merchantCleanupCacheSchema = new Schema({
  rawKey: { type: String, required: true, unique: true },
  cleanName: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const MerchantCleanupCache = model("MerchantCleanupCache", merchantCleanupCacheSchema);
