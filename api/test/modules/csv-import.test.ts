import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { Transaction } from "../../src/models/Transaction.js";
import { ImportBatch } from "../../src/models/ImportBatch.js";
import { Account } from "../../src/models/Account.js";

// Shape of one entry in an ImportBatch's rowResults, as it comes back over HTTP.
type RowResult = { row: number; status: "success" | "failed"; reason?: string };

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

const CSV = `Date,Description,Debit,Credit Amount
01/08/2026,SWIGGY ORDER,450,
02/08/2026,SALARY CREDIT,,50000
BAD-DATE,UNKNOWN,100,
04/08/2026,AMAZON,1200,
`;

describe("CSV import", () => {
  it("imports valid rows and records per-row failures without failing the batch", async () => {
    const cookie = authCookie("user-csv");
    const res = await request(app)
      .post("/transactions/import")
      .set("Cookie", cookie)
      .field("accountId", "acc-test-1")
      .attach("file", Buffer.from(CSV), "statement.csv");

    expect(res.status).toBe(200);
    const successCount = res.body.rowResults.filter((r: RowResult) => r.status === "success").length;
    const failedCount = res.body.rowResults.filter((r: RowResult) => r.status === "failed").length;
    expect(successCount).toBe(3);
    expect(failedCount).toBe(1);

    const count = await Transaction.countDocuments({ userId: "user-csv" });
    expect(count).toBe(3);
  });

  it("rejects an import with no accountId", async () => {
    const cookie = authCookie("user-csv-2");
    const res = await request(app)
      .post("/transactions/import")
      .set("Cookie", cookie)
      .attach("file", Buffer.from(CSV), "statement.csv");

    expect(res.status).toBe(400);
  });

  it("returns 400 with no accountId before parsing the file at all (no transactions/batch created)", async () => {
    const cookie = authCookie("user-csv-noaccount");
    const res = await request(app)
      .post("/transactions/import")
      .set("Cookie", cookie)
      .attach("file", Buffer.from(CSV), "statement.csv");

    expect(res.status).toBe(400);
    const txCount = await Transaction.countDocuments({ userId: "user-csv-noaccount" });
    expect(txCount).toBe(0);
    const batchCount = await ImportBatch.countDocuments({ userId: "user-csv-noaccount" });
    expect(batchCount).toBe(0);
  });

  it("returns 400 with no file uploaded", async () => {
    const cookie = authCookie("user-csv-nofile");
    const res = await request(app)
      .post("/transactions/import")
      .set("Cookie", cookie)
      .field("accountId", "acc-test-1");

    expect(res.status).toBe(400);
  });

  it("parses DD/MM/YYYY correctly, not MM/DD/YYYY (day 13 cannot be a month)", async () => {
    const cookie = authCookie("user-csv-dateorder");
    const csv = `Date,Description,Debit,Credit Amount\n13/01/2026,TEST MERCHANT,300,\n`;

    const res = await request(app)
      .post("/transactions/import")
      .set("Cookie", cookie)
      .field("accountId", "acc-test-1")
      .attach("file", Buffer.from(csv), "statement.csv");

    expect(res.status).toBe(200);
    expect(res.body.rowResults[0].status).toBe("success");

    const tx = await Transaction.findOne({ userId: "user-csv-dateorder" });
    expect(tx).not.toBeNull();
    // 13/01/2026 must be interpreted as day=13, month=01 (January), i.e. year 2026, month index 0 (Jan), day 13
    expect(tx!.date.getUTCFullYear()).toBe(2026);
    expect(tx!.date.getUTCMonth()).toBe(0); // January
    expect(tx!.date.getUTCDate()).toBe(13);
  });

  it("flags a row that matches an existing transaction as a failed duplicate, without aborting the batch", async () => {
    const userId = "user-csv-dup";
    const cookie = authCookie(userId);

    await Transaction.create({
      userId,
      accountId: "acc-test-1",
      amount: -450,
      date: new Date("2026-08-01"),
      source: "manual",
      status: "confirmed",
    });

    const res = await request(app)
      .post("/transactions/import")
      .set("Cookie", cookie)
      .field("accountId", "acc-test-1")
      .attach("file", Buffer.from(CSV), "statement.csv");

    expect(res.status).toBe(200);
    // row 1 (SWIGGY, -450) collides with the seeded transaction and should be flagged failed
    const row1 = res.body.rowResults.find((r: RowResult) => r.row === 1);
    expect(row1.status).toBe("failed");
    expect(row1.reason).toBeTruthy();

    // still 2 other valid rows import fine (salary + amazon), bad-date row fails too
    const successCount = res.body.rowResults.filter((r: RowResult) => r.status === "success").length;
    expect(successCount).toBe(2);

    const count = await Transaction.countDocuments({ userId });
    expect(count).toBe(1 + 2); // seeded + 2 newly imported
  });

  it("fails a row where both Debit and Credit are populated (malformed)", async () => {
    const cookie = authCookie("user-csv-both");
    const csv = `Date,Description,Debit,Credit Amount\n05/08/2026,WEIRD ROW,100,200\n`;

    const res = await request(app)
      .post("/transactions/import")
      .set("Cookie", cookie)
      .field("accountId", "acc-test-1")
      .attach("file", Buffer.from(csv), "statement.csv");

    expect(res.status).toBe(200);
    expect(res.body.rowResults[0].status).toBe("failed");

    const count = await Transaction.countDocuments({ userId: "user-csv-both" });
    expect(count).toBe(0);
  });

  it("fails a row where neither Debit nor Credit is populated (empty amount)", async () => {
    const cookie = authCookie("user-csv-neither");
    const csv = `Date,Description,Debit,Credit Amount\n06/08/2026,EMPTY ROW,,\n`;

    const res = await request(app)
      .post("/transactions/import")
      .set("Cookie", cookie)
      .field("accountId", "acc-test-1")
      .attach("file", Buffer.from(csv), "statement.csv");

    expect(res.status).toBe(200);
    expect(res.body.rowResults[0].status).toBe("failed");

    const count = await Transaction.countDocuments({ userId: "user-csv-neither" });
    expect(count).toBe(0);
  });

  it("persists an ImportBatch with rowResults and resultingIds matching the created transactions", async () => {
    const userId = "user-csv-batch";
    const cookie = authCookie(userId);

    const res = await request(app)
      .post("/transactions/import")
      .set("Cookie", cookie)
      .field("accountId", "acc-test-1")
      .attach("file", Buffer.from(CSV), "statement.csv");

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("bank_statement");
    expect(res.body.filename).toBe("statement.csv");
    expect(res.body.resultingIds).toHaveLength(3);

    const batch = await ImportBatch.findById(res.body._id);
    expect(batch).not.toBeNull();
    expect(batch!.rowResults).toHaveLength(4);
    expect(batch!.resultingIds).toHaveLength(3);

    const successIds = batch!.rowResults.filter((r) => r.status === "success").map((r) => r.transactionId);
    for (const id of successIds) {
      expect(batch!.resultingIds).toContain(id);
    }
  });

  it("applies every imported row's amount as a delta to the linked account's currentBalance", async () => {
    const userId = "user-csv-balance";
    const cookie = authCookie(userId);
    const account = await Account.create({
      userId,
      type: "bank",
      institution: "Test Bank",
      nickname: "Test",
      currentBalance: 1000,
    });

    const res = await request(app)
      .post("/transactions/import")
      .set("Cookie", cookie)
      .field("accountId", account._id.toString())
      .attach("file", Buffer.from(CSV), "statement.csv");

    expect(res.status).toBe(200);
    // CSV: -450 (SWIGGY), +50000 (SALARY), BAD-DATE fails, -1200 (AMAZON).
    // 1000 - 450 + 50000 - 1200 = 49350.
    const updated = await Account.findById(account._id);
    expect(updated!.currentBalance).toBe(49350);
  });

  it("runs categorization on successfully imported rows", async () => {
    const userId = "user-csv-categorize";
    const cookie = authCookie(userId);

    const { CategorizationRule } = await import("../../src/models/CategorizationRule.js");
    await CategorizationRule.create({
      userId,
      matchField: "merchant",
      matchType: "contains",
      matchValue: "SWIGGY",
      categoryId: "cat-dining",
      priority: 100,
    });

    const res = await request(app)
      .post("/transactions/import")
      .set("Cookie", cookie)
      .field("accountId", "acc-test-1")
      .attach("file", Buffer.from(CSV), "statement.csv");

    expect(res.status).toBe(200);
    // The stored merchant is the CLEANED "Swiggy", not the raw CSV
    // "SWIGGY ORDER" — see `cleanMerchantLabel` — but the rule (matchValue
    // "SWIGGY", case-insensitive `contains`) still matches it either way.
    const tx = await Transaction.findOne({ userId, merchant: "Swiggy" });
    expect(tx).not.toBeNull();
    expect(tx!.categoryId).toBe("cat-dining");
    expect(tx!.note).toBe("SWIGGY ORDER");
  });
});
