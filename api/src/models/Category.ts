import { Schema, model, Types } from "mongoose";

const categorySchema = new Schema({
  userId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  type: { type: String, enum: ["expense", "income"], required: true },
  color: { type: String, default: "#888888" },
  parentCategoryId: { type: Types.ObjectId, ref: "Category", default: null },
  bucket: { type: String, enum: ["fixed_costs", "investments", "savings", "guilt_free"], required: true },
  budgetLimit: { type: Number, default: 0 },
});

export const Category = model("Category", categorySchema);
