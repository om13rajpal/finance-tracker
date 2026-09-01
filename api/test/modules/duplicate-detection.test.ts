import { describe, it, expect } from "vitest";
import { Transaction } from "../../src/models/Transaction.js";
import { findLikelyDuplicate, findLikelyDuplicatesBatch } from "../../src/modules/transactions/duplicate-detection.js";

describe("findLikelyDuplicate", () => {
  it("flags an exact amount+account match within the date window", async () => {
    await Transaction.create({
      userId: "user-1",
      accountId: "acc-1",
      amount: -500,
      date: new Date("2026-08-10"),
      source: "manual",
    });

    const result = await findLikelyDuplicate("user-1", { accountId: "acc-1", amount: -500, date: new Date("2026-08-11") });
    expect(result).not.toBeNull();
  });

  it("does not flag a transaction more than 2 days apart", async () => {
    await Transaction.create({
      userId: "user-1",
      accountId: "acc-1",
      amount: -500,
      date: new Date("2026-08-10"),
      source: "manual",
    });

    const result = await findLikelyDuplicate("user-1", { accountId: "acc-1", amount: -500, date: new Date("2026-08-14") });
    expect(result).toBeNull();
  });

  it("does not flag a transaction on a different account", async () => {
    await Transaction.create({
      userId: "user-1",
      accountId: "acc-1",
      amount: -500,
      date: new Date("2026-08-10"),
      source: "manual",
    });

    const result = await findLikelyDuplicate("user-1", { accountId: "acc-2", amount: -500, date: new Date("2026-08-10") });
    expect(result).toBeNull();
  });

  it("flags a transaction exactly 2 days after (inclusive boundary)", async () => {
    await Transaction.create({
      userId: "user-1",
      accountId: "acc-1",
      amount: -500,
      date: new Date("2026-08-10T00:00:00.000Z"),
      source: "manual",
    });

    const result = await findLikelyDuplicate("user-1", {
      accountId: "acc-1",
      amount: -500,
      date: new Date("2026-08-12T00:00:00.000Z"),
    });
    expect(result).not.toBeNull();
  });

  it("flags a transaction exactly 2 days before (inclusive boundary, symmetric)", async () => {
    await Transaction.create({
      userId: "user-1",
      accountId: "acc-1",
      amount: -500,
      date: new Date("2026-08-10T00:00:00.000Z"),
      source: "manual",
    });

    const result = await findLikelyDuplicate("user-1", {
      accountId: "acc-1",
      amount: -500,
      date: new Date("2026-08-08T00:00:00.000Z"),
    });
    expect(result).not.toBeNull();
  });

  it("does not flag a transaction exactly 3 days after", async () => {
    await Transaction.create({
      userId: "user-1",
      accountId: "acc-1",
      amount: -500,
      date: new Date("2026-08-10T00:00:00.000Z"),
      source: "manual",
    });

    const result = await findLikelyDuplicate("user-1", {
      accountId: "acc-1",
      amount: -500,
      date: new Date("2026-08-13T00:00:00.000Z"),
    });
    expect(result).toBeNull();
  });

  it("does not flag a transaction exactly 3 days before (symmetric)", async () => {
    await Transaction.create({
      userId: "user-1",
      accountId: "acc-1",
      amount: -500,
      date: new Date("2026-08-10T00:00:00.000Z"),
      source: "manual",
    });

    const result = await findLikelyDuplicate("user-1", {
      accountId: "acc-1",
      amount: -500,
      date: new Date("2026-08-07T00:00:00.000Z"),
    });
    expect(result).toBeNull();
  });

  it("does not flag a different amount on the same account within the window", async () => {
    await Transaction.create({
      userId: "user-1",
      accountId: "acc-1",
      amount: -500,
      date: new Date("2026-08-10"),
      source: "manual",
    });

    const result = await findLikelyDuplicate("user-1", { accountId: "acc-1", amount: -501, date: new Date("2026-08-10") });
    expect(result).toBeNull();
  });

  it("does not flag another user's matching transaction (scoped by userId)", async () => {
    await Transaction.create({
      userId: "user-other",
      accountId: "acc-1",
      amount: -500,
      date: new Date("2026-08-10"),
      source: "manual",
    });

    const result = await findLikelyDuplicate("user-1", { accountId: "acc-1", amount: -500, date: new Date("2026-08-10") });
    expect(result).toBeNull();
  });
});

describe("findLikelyDuplicatesBatch", () => {
  it("flags the same candidates a per-item findLikelyDuplicate call would, across multiple accounts", async () => {
    const userId = "user-batch-dup";
    await Transaction.create({
      userId,
      accountId: "acc-a",
      amount: -500,
      date: new Date("2026-08-10"),
      source: "manual",
    });
    await Transaction.create({
      userId,
      accountId: "acc-b",
      amount: -900,
      date: new Date("2026-08-20"),
      source: "manual",
    });

    const items = [
      { accountId: "acc-a", amount: -500, date: new Date("2026-08-11") }, // duplicate (1 day apart)
      { accountId: "acc-a", amount: -500, date: new Date("2026-08-20") }, // not — outside window
      { accountId: "acc-b", amount: -900, date: new Date("2026-08-20") }, // duplicate (exact)
      { accountId: "acc-b", amount: -901, date: new Date("2026-08-20") }, // not — different amount
    ];

    const result = await findLikelyDuplicatesBatch(userId, items);
    expect(result).toEqual(new Set([0, 2]));
  });

  it("returns an empty set for an empty batch", async () => {
    expect(await findLikelyDuplicatesBatch("user-batch-dup-empty", [])).toEqual(new Set());
  });

  it("scopes to the given userId only", async () => {
    await Transaction.create({
      userId: "user-batch-dup-other",
      accountId: "acc-a",
      amount: -500,
      date: new Date("2026-08-10"),
      source: "manual",
    });
    const result = await findLikelyDuplicatesBatch("user-batch-dup-not-other", [
      { accountId: "acc-a", amount: -500, date: new Date("2026-08-10") },
    ]);
    expect(result).toEqual(new Set());
  });
});
