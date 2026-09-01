import { describe, it, expect, afterEach } from "vitest";
import { PendingTransaction } from "../../src/models/PendingTransaction.js";
import { Transaction } from "../../src/models/Transaction.js";
import { CategorizationRule } from "../../src/models/CategorizationRule.js";
import { getCategorizationSuggestions } from "../../src/modules/categorization/categorization-suggestions.service.js";

const userId = "user-cat-suggest";

afterEach(async () => {
  await PendingTransaction.deleteMany({ userId });
  await Transaction.deleteMany({ userId });
  await CategorizationRule.deleteMany({ userId });
});

async function seedPending(merchant: string, count: number) {
  for (let i = 0; i < count; i++) {
    await PendingTransaction.create({
      userId,
      accountId: "acc-1",
      categoryId: null,
      amount: -100 - i,
      date: new Date(Date.UTC(2026, 0, 1 + i)),
      merchant,
      source: "pdf_statement_parsed",
    });
  }
}

async function seedUncategorizedConfirmed(merchant: string, count: number) {
  for (let i = 0; i < count; i++) {
    await Transaction.create({
      userId,
      accountId: "acc-1",
      categoryId: null,
      amount: -100 - i,
      date: new Date(Date.UTC(2026, 0, 1 + i)),
      merchant,
      source: "csv_import",
      status: "confirmed",
    });
  }
}

describe("getCategorizationSuggestions", () => {
  it("suggests a merchant that appears 3+ times uncategorized in the pending queue", async () => {
    await seedPending("Zepto", 3);
    const suggestions = await getCategorizationSuggestions(userId);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ merchant: "Zepto", count: 3 });
    expect(suggestions[0].pendingIds).toHaveLength(3);
  });

  it("does not suggest a merchant seen fewer than 3 times", async () => {
    await seedPending("Zepto", 2);
    expect(await getCategorizationSuggestions(userId)).toHaveLength(0);
  });

  it("combines counts from both the pending queue and uncategorized confirmed transactions", async () => {
    await seedPending("Zepto", 2);
    await seedUncategorizedConfirmed("Zepto", 2);
    const suggestions = await getCategorizationSuggestions(userId);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].count).toBe(4);
    expect(suggestions[0].pendingIds).toHaveLength(2);
    expect(suggestions[0].transactionIds).toHaveLength(2);
  });

  it("excludes a merchant that an existing rule already matches", async () => {
    await seedPending("Zepto", 4);
    await CategorizationRule.create({
      userId,
      matchField: "merchant",
      matchType: "contains",
      matchValue: "ZEPTO",
      categoryId: "cat-groceries",
    });
    expect(await getCategorizationSuggestions(userId)).toHaveLength(0);
  });

  it("does not include already-categorized transactions", async () => {
    await Transaction.create({
      userId,
      accountId: "acc-1",
      categoryId: "cat-groceries",
      amount: -100,
      date: new Date(),
      merchant: "Zepto",
      source: "csv_import",
      status: "confirmed",
    });
    await seedUncategorizedConfirmed("Zepto", 2);
    // Only 2 genuinely uncategorized — below threshold.
    expect(await getCategorizationSuggestions(userId)).toHaveLength(0);
  });

  it("sorts by occurrence count, most first", async () => {
    await seedPending("Small Merchant", 3);
    await seedPending("Big Merchant", 6);
    const suggestions = await getCategorizationSuggestions(userId);
    expect(suggestions.map((s) => s.merchant)).toEqual(["Big Merchant", "Small Merchant"]);
  });

  it("ignores other users' data", async () => {
    await PendingTransaction.create({
      userId: "someone-else",
      accountId: "acc-1",
      categoryId: null,
      amount: -100,
      date: new Date(),
      merchant: "Zepto",
      source: "pdf_statement_parsed",
    });
    expect(await getCategorizationSuggestions(userId)).toHaveLength(0);
  });
});
