import { CategorizationRule } from "../../models/CategorizationRule.js";

export async function maybeCreateRuleFromCorrection(
  userId: string,
  matchValue: string,
  categoryId: string
): Promise<void> {
  await CategorizationRule.create({
    userId,
    matchField: "merchant",
    matchType: "contains",
    matchValue,
    categoryId,
    priority: 100,
  });
}

export function encodeCursor(date: Date, id: string): string {
  return Buffer.from(`${date.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { date: Date; id: string } {
  const [dateStr, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  return { date: new Date(dateStr), id };
}
