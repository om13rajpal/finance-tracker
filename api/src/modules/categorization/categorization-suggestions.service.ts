import { PendingTransaction } from "../../models/PendingTransaction.js";
import { Transaction } from "../../models/Transaction.js";
import { CategorizationRule } from "../../models/CategorizationRule.js";

export type CategorizationSuggestion = {
  /** Not a real id — a stable string keyed on the merchant, for a React `key`
   * and to echo back to `POST /categorization-rules` when the person accepts. */
  key: string;
  merchant: string;
  count: number;
  pendingIds: string[];
  transactionIds: string[];
};

const MIN_OCCURRENCES = 3;

/**
 * Finds merchants that keep showing up without a category and don't already
 * have a matching rule — the "you keep manually categorizing this, want a
 * rule instead?" nudge this app doesn't currently offer (categorization is
 * otherwise 100% reactive: a rule only ever applies going forward, at
 * confirm/CSV-import time, to whatever someone happens to type in — see
 * `categorization.engine.ts`).
 *
 * Scans BOTH still-`PendingTransaction`s (the review queue) and already-
 * `confirmed` `Transaction`s with no category, since both are real loose
 * ends — a CSV import or a manual entry can land with `categoryId: null`
 * just as easily as a statement row can. Merchant grouping is
 * case-sensitive-on-display but the count key is lowercased, matching how
 * `cleanMerchantLabel`'s output is expected to already be a short, stable
 * display name rather than noisy raw narration.
 *
 * Excludes any merchant an EXISTING rule would already match (checked the
 * same way `applyCategorizationRules` matches — case-insensitive `contains`/
 * `exact` against `matchField`) — proposing a second, redundant rule for a
 * merchant that already has one would be confusing, and if it's still
 * turning up uncategorized despite an existing rule matching it, the fix
 * belongs to Settings' rule list, not a fresh suggestion here. This
 * deliberately does NOT mean "already-uncategorized items get silently
 * fixed" — this app never backfills existing data when a rule is created
 * (see `POST /categorization-rules`'s own doc comment); a suggestion here
 * is surfaced so the PERSON can choose to apply it, not applied on its own.
 */
export async function getCategorizationSuggestions(userId: string): Promise<CategorizationSuggestion[]> {
  const [pending, uncategorizedConfirmed, rules] = await Promise.all([
    PendingTransaction.find({ userId, categoryId: null }).select("_id merchant note").lean(),
    Transaction.find({ userId, categoryId: null, status: "confirmed" }).select("_id merchant note").lean(),
    CategorizationRule.find({ userId }).select("matchField matchType matchValue").lean(),
  ]);

  function alreadyRuled(merchant: string, note: string): boolean {
    return rules.some((rule) => {
      const fieldValue = (rule.matchField === "merchant" ? merchant : note) ?? "";
      const normalizedField = fieldValue.toUpperCase();
      const normalizedMatch = rule.matchValue.toUpperCase();
      return rule.matchType === "exact" ? normalizedField === normalizedMatch : normalizedField.includes(normalizedMatch);
    });
  }

  const groups = new Map<string, CategorizationSuggestion>();

  for (const item of pending) {
    const merchant = (item.merchant ?? "").trim();
    if (!merchant || alreadyRuled(merchant, item.note ?? "")) continue;
    const key = merchant.toLowerCase();
    const group = groups.get(key) ?? { key, merchant, count: 0, pendingIds: [], transactionIds: [] };
    group.count += 1;
    group.pendingIds.push(item._id.toString());
    groups.set(key, group);
  }

  for (const item of uncategorizedConfirmed) {
    const merchant = (item.merchant ?? "").trim();
    if (!merchant || alreadyRuled(merchant, item.note ?? "")) continue;
    const key = merchant.toLowerCase();
    const group = groups.get(key) ?? { key, merchant, count: 0, pendingIds: [], transactionIds: [] };
    group.count += 1;
    group.transactionIds.push(item._id.toString());
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((g) => g.count >= MIN_OCCURRENCES)
    .sort((a, b) => b.count - a.count);
}
