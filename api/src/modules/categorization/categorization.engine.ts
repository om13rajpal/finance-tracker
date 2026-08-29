import { CategorizationRule } from "../../models/CategorizationRule.js";

export async function applyCategorizationRules(
  userId: string,
  tx: { merchant?: string; note?: string }
): Promise<string | null> {
  const rules = await CategorizationRule.find({ userId }).sort({ priority: 1 }).lean();

  for (const rule of rules) {
    const fieldValue = (rule.matchField === "merchant" ? tx.merchant : tx.note) ?? "";
    const normalizedField = fieldValue.toUpperCase();
    const normalizedMatch = rule.matchValue.toUpperCase();

    const isMatch =
      rule.matchType === "exact" ? normalizedField === normalizedMatch : normalizedField.includes(normalizedMatch);

    if (isMatch) return rule.categoryId;
  }

  return null;
}
