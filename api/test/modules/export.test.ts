import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { Account } from "../../src/models/Account.js";
import { Transaction } from "../../src/models/Transaction.js";
import { HoldingLot } from "../../src/models/HoldingLot.js";
import { Goal } from "../../src/models/Goal.js";
import { RecurringTransaction } from "../../src/models/RecurringTransaction.js";
import { PendingTransaction } from "../../src/models/PendingTransaction.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("data export", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/export");
    expect(res.status).toBe(401);
  });

  it("exports only the requesting user's data across accounts and goals", async () => {
    await Account.create({ userId: "user-export-a", type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 1000, isLiability: false });
    await Account.create({ userId: "user-export-b", type: "bank", institution: "SBI", nickname: "Savings", currentBalance: 2000, isLiability: false });
    await Goal.create({ userId: "user-export-a", name: "Trip", targetAmount: 50000, currentAmount: 1000 });
    await Goal.create({ userId: "user-export-b", name: "Car", targetAmount: 500000, currentAmount: 2000 });

    const res = await request(app).get("/export").set("Cookie", authCookie("user-export-a"));

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0].institution).toBe("HDFC");
    expect(res.body.goals).toHaveLength(1);
    expect(res.body.goals[0].name).toBe("Trip");
  });

  it("sets the Content-Disposition attachment header with the export filename", async () => {
    const res = await request(app).get("/export").set("Cookie", authCookie("user-export-header"));
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="finance-tracker-export.json"');
  });

  it("scopes transactions, holding lots, and recurring transactions to the requesting user only", async () => {
    const accountA = await Account.create({ userId: "user-export-c", type: "bank", institution: "HDFC", nickname: "Checking", currentBalance: 5000, isLiability: false });
    const accountB = await Account.create({ userId: "user-export-d", type: "bank", institution: "ICICI", nickname: "Checking", currentBalance: 5000, isLiability: false });

    await Transaction.create({ userId: "user-export-c", accountId: String(accountA._id), amount: -100, date: new Date(), merchant: "Coffee A" });
    await Transaction.create({ userId: "user-export-d", accountId: String(accountB._id), amount: -200, date: new Date(), merchant: "Coffee B" });

    await HoldingLot.create({ userId: "user-export-c", symbol: "AAPL", platform: "zerodha", instrumentType: "stock", buyDate: new Date(), buyPrice: 100, units: 10, remainingUnits: 10 });
    await HoldingLot.create({ userId: "user-export-d", symbol: "GOOG", platform: "zerodha", instrumentType: "stock", buyDate: new Date(), buyPrice: 200, units: 5, remainingUnits: 5 });

    await RecurringTransaction.create({ userId: "user-export-c", name: "Rent A", type: "expense", amount: 500, frequency: "monthly", nextDueDate: new Date(), accountId: String(accountA._id), categoryId: "cat-1" });
    await RecurringTransaction.create({ userId: "user-export-d", name: "Rent B", type: "expense", amount: 700, frequency: "monthly", nextDueDate: new Date(), accountId: String(accountB._id), categoryId: "cat-2" });

    const res = await request(app).get("/export").set("Cookie", authCookie("user-export-c"));

    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0].merchant).toBe("Coffee A");
    expect(res.body.holdingLots).toHaveLength(1);
    expect(res.body.holdingLots[0].symbol).toBe("AAPL");
    expect(res.body.recurringTransactions).toHaveLength(1);
    expect(res.body.recurringTransactions[0].name).toBe("Rent A");
  });

  it("returns empty arrays for a user with no data at all, across all five collections", async () => {
    const res = await request(app).get("/export").set("Cookie", authCookie("user-export-empty"));

    expect(res.status).toBe(200);
    expect(res.body.accounts).toEqual([]);
    expect(res.body.transactions).toEqual([]);
    expect(res.body.holdingLots).toEqual([]);
    expect(res.body.goals).toEqual([]);
    expect(res.body.recurringTransactions).toEqual([]);
  });

  it("does not include pending transactions, which are not part of the export scope", async () => {
    const account = await Account.create({ userId: "user-export-pending", type: "bank", institution: "HDFC", nickname: "Checking", currentBalance: 1000, isLiability: false });
    await PendingTransaction.create({ userId: "user-export-pending", accountId: String(account._id), amount: -50, date: new Date(), merchant: "Pending purchase" });

    const res = await request(app).get("/export").set("Cookie", authCookie("user-export-pending"));

    expect(res.status).toBe(200);
    expect(res.body.pendingTransactions).toBeUndefined();
  });
});
