import { describe, it, expect, afterEach } from "vitest";
import { Transaction } from "../../src/models/Transaction.js";
import { RecurringTransaction } from "../../src/models/RecurringTransaction.js";
import { detectRecurringSuggestions } from "../../src/modules/recurring/recurring-detection.service.js";

const userId = "user-recurring-detect";
const accountId = "acc-1";

function monthlyDate(monthOffset: number, day = 23): Date {
  // Base month: Jan 2026, UTC midnight, matches how dates are stored
  // everywhere else in this codebase.
  return new Date(Date.UTC(2026, monthOffset, day));
}

afterEach(async () => {
  await Transaction.deleteMany({ userId });
  await RecurringTransaction.deleteMany({ userId });
});

describe("detectRecurringSuggestions", () => {
  it("detects a monthly subscription paid at a fixed amount", async () => {
    for (let i = 0; i < 5; i++) {
      await Transaction.create({
        userId,
        accountId,
        amount: -199,
        date: monthlyDate(i),
        merchant: "Netflix",
        source: "pdf_statement_parsed",
        status: "confirmed",
      });
    }

    const suggestions = await detectRecurringSuggestions(userId);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      merchant: "Netflix",
      accountId,
      type: "expense",
      amount: 199,
      frequency: "monthly",
      occurrenceCount: 5,
    });
  });

  it("does not suggest a merchant seen fewer than 3 times", async () => {
    for (let i = 0; i < 2; i++) {
      await Transaction.create({
        userId,
        accountId,
        amount: -199,
        date: monthlyDate(i),
        merchant: "Netflix",
        source: "pdf_statement_parsed",
        status: "confirmed",
      });
    }
    expect(await detectRecurringSuggestions(userId)).toHaveLength(0);
  });

  it("does not suggest a merchant with wildly irregular gaps", async () => {
    const dates = [monthlyDate(0, 1), monthlyDate(0, 5), monthlyDate(4, 12), monthlyDate(9, 28)];
    for (const date of dates) {
      await Transaction.create({
        userId,
        accountId,
        amount: -450,
        date,
        merchant: "Random Shop",
        source: "csv_import",
        status: "confirmed",
      });
    }
    expect(await detectRecurringSuggestions(userId)).toHaveLength(0);
  });

  it("does not suggest a merchant that's a mix of debits and credits", async () => {
    for (let i = 0; i < 4; i++) {
      await Transaction.create({
        userId,
        accountId,
        amount: i % 2 === 0 ? -500 : 500,
        date: monthlyDate(i),
        merchant: "Mixed Merchant",
        source: "csv_import",
        status: "confirmed",
      });
    }
    expect(await detectRecurringSuggestions(userId)).toHaveLength(0);
  });

  it("does not suggest a merchant already tracked as an active RecurringTransaction", async () => {
    for (let i = 0; i < 4; i++) {
      await Transaction.create({
        userId,
        accountId,
        amount: -199,
        date: monthlyDate(i),
        merchant: "Netflix",
        source: "pdf_statement_parsed",
        status: "confirmed",
      });
    }
    await RecurringTransaction.create({
      userId,
      name: "Netflix",
      type: "expense",
      amount: 199,
      frequency: "monthly",
      nextDueDate: monthlyDate(5),
      accountId,
      categoryId: "cat-subscriptions",
    });

    expect(await detectRecurringSuggestions(userId)).toHaveLength(0);
  });

  it("treats the same merchant on two different accounts as two separate suggestions", async () => {
    for (let i = 0; i < 3; i++) {
      await Transaction.create({
        userId,
        accountId: "acc-1",
        amount: -199,
        date: monthlyDate(i),
        merchant: "Netflix",
        source: "pdf_statement_parsed",
        status: "confirmed",
      });
      await Transaction.create({
        userId,
        accountId: "acc-2",
        amount: -199,
        date: monthlyDate(i),
        merchant: "Netflix",
        source: "pdf_statement_parsed",
        status: "confirmed",
      });
    }

    const suggestions = await detectRecurringSuggestions(userId);
    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((s) => s.accountId).sort()).toEqual(["acc-1", "acc-2"]);
  });

  it("detects weekly and yearly cadences too", async () => {
    for (let i = 0; i < 4; i++) {
      await Transaction.create({
        userId,
        accountId,
        amount: -50,
        date: new Date(Date.UTC(2026, 0, 1 + i * 7)),
        merchant: "Weekly Cleaner",
        source: "manual",
        status: "confirmed",
      });
    }
    for (let i = 0; i < 3; i++) {
      await Transaction.create({
        userId,
        accountId,
        amount: 900,
        date: new Date(Date.UTC(2024 + i, 5, 15)),
        merchant: "Annual Renewal",
        source: "manual",
        status: "confirmed",
      });
    }

    const suggestions = await detectRecurringSuggestions(userId);
    const weekly = suggestions.find((s) => s.merchant === "Weekly Cleaner");
    const yearly = suggestions.find((s) => s.merchant === "Annual Renewal");
    expect(weekly?.frequency).toBe("weekly");
    expect(weekly?.type).toBe("expense");
    expect(yearly?.frequency).toBe("yearly");
    expect(yearly?.type).toBe("income");
  });

  it("proposes the shared category only when every occurrence agrees", async () => {
    for (let i = 0; i < 3; i++) {
      await Transaction.create({
        userId,
        accountId,
        amount: -199,
        date: monthlyDate(i),
        merchant: "Consistent Category",
        categoryId: "cat-subscriptions",
        source: "manual",
        status: "confirmed",
      });
    }
    for (let i = 0; i < 3; i++) {
      await Transaction.create({
        userId,
        accountId,
        amount: -199,
        date: monthlyDate(i),
        merchant: "Mixed Category",
        categoryId: i === 0 ? "cat-a" : "cat-b",
        source: "manual",
        status: "confirmed",
      });
    }

    const suggestions = await detectRecurringSuggestions(userId);
    expect(suggestions.find((s) => s.merchant === "Consistent Category")?.categoryId).toBe("cat-subscriptions");
    expect(suggestions.find((s) => s.merchant === "Mixed Category")?.categoryId).toBeNull();
  });

  it("ignores transactions from other users", async () => {
    await Transaction.create({
      userId: "someone-else",
      accountId,
      amount: -199,
      date: monthlyDate(0),
      merchant: "Netflix",
      source: "manual",
      status: "confirmed",
    });
    expect(await detectRecurringSuggestions(userId)).toHaveLength(0);
  });
});
