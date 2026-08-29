import { Schema, model } from "mongoose";

const goalSchema = new Schema({
  userId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  targetAmount: { type: Number, required: true },
  currentAmount: { type: Number, default: 0 },
  targetDate: { type: Date, default: null },
});

export const Goal = model("Goal", goalSchema);
