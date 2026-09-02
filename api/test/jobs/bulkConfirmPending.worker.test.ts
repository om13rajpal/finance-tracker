import { describe, it, expect } from "vitest";
import { PendingTransaction } from "../../src/models/PendingTransaction.js";
import { Transaction } from "../../src/models/Transaction.js";
import { BulkConfirmBatch } from "../../src/models/BulkConfirmBatch.js";
import { processBulkConfirm } from "../../src/jobs/workers/bulkConfirmPending.worker.js";

describe("processBulkConfirm", () => {
  it("confirms every listed id and marks the batch completed", async () => {
    const userId = "user-worker-basic";
    const a = await PendingTransaction.create({
      userId,
      accountId: "acc-1",
      amount: -100,
      date: new Date("2026-08-16"),
      merchant: "A",
      source: "email_parsed",
    });
    const b = await PendingTransaction.create({
      userId,
      accountId: "acc-1",
      amount: -200,
      date: new Date("2026-08-16"),
      merchant: "B",
      source: "email_parsed",
    });
    const batch = await BulkConfirmBatch.create({ userId, status: "processing", total: 2, results: [] });

    await processBulkConfirm({ batchId: batch._id.toString(), userId, ids: [a._id.toString(), b._id.toString()] });

    const finished = await BulkConfirmBatch.findById(batch._id);
    expect(finished!.status).toBe("completed");
    expect(finished!.results).toHaveLength(2);
    expect(finished!.results.every((r) => r.status === "success")).toBe(true);
    expect(await PendingTransaction.countDocuments({ userId })).toBe(0);
    expect(await Transaction.countDocuments({ userId })).toBe(2);
  });

  // Regression-shaped: mirrors `statementProcess.worker.ts`'s resume-not-restart
  // guarantee for the same reason: a BullMQ retry after a mid-batch failure
  // (a transient DB error, a crash) re-invokes this function with the SAME
  // full `ids` array. Without resuming from `results.length`, a retry would
  // re-confirm items a prior attempt already finished. That's impossible here since
  // a confirmed item's `PendingTransaction` is already gone (so it'd just log
  // "not_found" instead), but it WOULD append duplicate result entries and
  // silently corrupt the batch's own accounting of what happened.
  it("resumes from where a prior partial attempt left off, rather than reprocessing already-recorded ids", async () => {
    const userId = "user-worker-resume";
    const a = await PendingTransaction.create({
      userId,
      accountId: "acc-1",
      amount: -100,
      date: new Date("2026-08-16"),
      merchant: "A",
      source: "email_parsed",
    });
    // Confirmed by a simulated PRIOR partial attempt: its PendingTransaction
    // is already gone and a matching result already recorded on the batch.
    const alreadyConfirmedTransaction = await Transaction.create({
      userId,
      accountId: "acc-1",
      amount: -50,
      date: new Date("2026-08-15"),
      merchant: "ALREADY DONE",
      source: "email_parsed",
      status: "confirmed",
    });
    const stillPending = await PendingTransaction.create({
      userId,
      accountId: "acc-1",
      amount: -300,
      date: new Date("2026-08-17"),
      merchant: "STILL PENDING",
      source: "email_parsed",
    });

    const batch = await BulkConfirmBatch.create({
      userId,
      status: "processing",
      total: 2,
      results: [{ id: "prior-item-id", status: "success", transactionId: alreadyConfirmedTransaction._id.toString() }],
    });

    // Same ordering a real retry would use: the prior item first, then the
    // one that never got processed.
    await processBulkConfirm({
      batchId: batch._id.toString(),
      userId,
      ids: ["prior-item-id", stillPending._id.toString()],
    });

    const finished = await BulkConfirmBatch.findById(batch._id);
    // Exactly 2 results total, not 3: "prior-item-id" was NOT reprocessed.
    expect(finished!.results).toHaveLength(2);
    expect(finished!.results[0].id).toBe("prior-item-id");
    expect(finished!.results[1].id).toBe(stillPending._id.toString());
    expect(finished!.results[1].status).toBe("success");
    expect(finished!.status).toBe("completed");

    // `a` was never part of this batch's ids at all: untouched.
    expect(await PendingTransaction.findById(a._id)).not.toBeNull();
    expect(await PendingTransaction.findById(stillPending._id)).toBeNull();
  });

  it("skips an id whose PendingTransaction has no accountId, without failing the rest of the batch", async () => {
    const userId = "user-worker-skip";
    const needsAccount = await PendingTransaction.create({
      userId,
      accountId: null,
      amount: -500,
      date: new Date("2026-08-16"),
      merchant: "NO ACCOUNT",
      source: "email_parsed",
    });
    const fine = await PendingTransaction.create({
      userId,
      accountId: "acc-1",
      amount: -50,
      date: new Date("2026-08-16"),
      merchant: "FINE",
      source: "email_parsed",
    });
    const batch = await BulkConfirmBatch.create({ userId, status: "processing", total: 2, results: [] });

    await processBulkConfirm({
      batchId: batch._id.toString(),
      userId,
      ids: [needsAccount._id.toString(), fine._id.toString()],
    });

    const finished = await BulkConfirmBatch.findById(batch._id);
    const byId = Object.fromEntries(finished!.results.map((r) => [r.id, r]));
    expect(byId[needsAccount._id.toString()].status).toBe("skipped");
    expect(byId[needsAccount._id.toString()].reason).toBe("account_required");
    expect(byId[fine._id.toString()].status).toBe("success");
    expect(finished!.status).toBe("completed");
  });
});
