import { Schema, model } from "mongoose";

const emailSourceSchema = new Schema({
  userId: { type: String, required: true, index: true },
  senderPattern: { type: String, required: true },
  institution: { type: String, required: true },
  parserKey: { type: String, required: true },
});

export const EmailSource = model("EmailSource", emailSourceSchema);
