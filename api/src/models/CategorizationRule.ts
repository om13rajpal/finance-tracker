import { Schema, model } from "mongoose";

const categorizationRuleSchema = new Schema({
  userId: { type: String, required: true, index: true },
  matchField: { type: String, enum: ["merchant", "note"], required: true },
  matchType: { type: String, enum: ["contains", "exact"], required: true },
  matchValue: { type: String, required: true },
  categoryId: { type: String, required: true },
  priority: { type: Number, default: 100 },
  createdAt: { type: Date, default: Date.now },
});

export const CategorizationRule = model("CategorizationRule", categorizationRuleSchema);
