import { CategorizationRule } from "../../models/CategorizationRule.js";

/**
 * The one true "does this rule match this transaction" check, shared by the
 * live engine below and `categorization.routes.ts`'s preview endpoint (which
 * shows, up front, exactly which existing transactions a NOT-YET-created
 * rule would apply to). Both must agree exactly, or the preview would lie
 * about what creating the rule actually does.
 */
export function matchesRule(
  rule: { matchField: "merchant" | "note"; matchType: "contains" | "exact"; matchValue: string },
  tx: { merchant?: string; note?: string }
): boolean {
  const fieldValue = (rule.matchField === "merchant" ? tx.merchant : tx.note) ?? "";
  const normalizedField = fieldValue.toUpperCase();
  const normalizedMatch = rule.matchValue.toUpperCase();

  return rule.matchType === "exact" ? normalizedField === normalizedMatch : normalizedField.includes(normalizedMatch);
}

export async function applyCategorizationRules(
  userId: string,
  tx: { merchant?: string; note?: string }
): Promise<string | null> {
  const rules = await CategorizationRule.find({ userId }).sort({ priority: 1 }).lean();

  for (const rule of rules) {
    if (matchesRule(rule, tx)) return rule.categoryId;
  }

  return null;
}
