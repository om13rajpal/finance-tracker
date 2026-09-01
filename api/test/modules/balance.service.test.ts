import { describe, it, expect } from "vitest";
import { Account } from "../../src/models/Account.js";
import { BalanceSnapshot } from "../../src/models/BalanceSnapshot.js";
import {
  applyBalanceDelta,
  reconcileBalance,
  applyConfirmedTransactionBalanceEffect,
} from "../../src/modules/accounts/balance.service.js";

async function createAccount(userId: string, type: "bank" | "credit_card" | "ppf" | "cash", currentBalance: number) {
  return Account.create({ userId, type, institution: "Test Bank", nickname: "Test", currentBalance });
}

describe("applyBalanceDelta", () => {
  it("adds a positive delta (income) to a bank account's currentBalance", async () => {
    const account = await createAccount("user-delta-1", "bank", 1000);
    await applyBalanceDelta("user-delta-1", account._id.toString(), 500);
    const updated = await Account.findById(account._id);
    expect(updated!.currentBalance).toBe(1500);
  });

  it("adds a negative delta (expense) to a bank account's currentBalance", async () => {
    const account = await createAccount("user-delta-2", "bank", 1000);
    await applyBalanceDelta("user-delta-2", account._id.toString(), -300);
    const updated = await Account.findById(account._id);
    expect(updated!.currentBalance).toBe(700);
  });

  it("is a no-op for a delta of exactly 0 (no write at all)", async () => {
    const account = await createAccount("user-delta-zero", "bank", 1000);
    const before = await Account.findById(account._id);
    await applyBalanceDelta("user-delta-zero", account._id.toString(), 0);
    const after = await Account.findById(account._id);
    expect(after!.lastUpdated.getTime()).toBe(before!.lastUpdated.getTime());
    expect(after!.currentBalance).toBe(1000);
  });

  it("silently no-ops for an account that doesn't exist or isn't this user's, rather than throwing", async () => {
    const owner = await createAccount("owner-delta", "bank", 1000);
    await expect(applyBalanceDelta("someone-else", owner._id.toString(), 500)).resolves.toBeUndefined();
    const untouched = await Account.findById(owner._id);
    expect(untouched!.currentBalance).toBe(1000);
  });

  // A credit card is a LIABILITY: an expense (a negative delta, e.g. -500 from
  // swiping the card) must INCREASE what's owed, the opposite direction of the
  // same expense applied to a bank account. Keyed off `type`, mirroring
  // `computeNetWorth`'s own authoritative-vs-`isLiability`-flag reasoning.
  it("INCREASES a credit card's currentBalance for an expense (negative delta) instead of decreasing it", async () => {
    const card = await createAccount("user-cc-expense", "credit_card", 2000);
    await applyBalanceDelta("user-cc-expense", card._id.toString(), -500);
    const updated = await Account.findById(card._id);
    expect(updated!.currentBalance).toBe(2500);
  });

  it("DECREASES a credit card's currentBalance for a payment/credit (positive delta)", async () => {
    const card = await createAccount("user-cc-payment", "credit_card", 2000);
    await applyBalanceDelta("user-cc-payment", card._id.toString(), 800);
    const updated = await Account.findById(card._id);
    expect(updated!.currentBalance).toBe(1200);
  });

  it("rounds the resulting balance to 2 decimal places to bound floating-point drift across many increments", async () => {
    const account = await createAccount("user-drift", "bank", 0);
    // 0.1 + 0.2 !== 0.3 in floating point; three of these should still land on
    // a clean 0.3, not 0.30000000000000004.
    await applyBalanceDelta("user-drift", account._id.toString(), 0.1);
    await applyBalanceDelta("user-drift", account._id.toString(), 0.1);
    await applyBalanceDelta("user-drift", account._id.toString(), 0.1);
    const updated = await Account.findById(account._id);
    expect(updated!.currentBalance).toBe(0.3);
  });

  it("never touches balanceAsOf — a plain delta is not a reconciliation event", async () => {
    const account = await createAccount("user-delta-asof", "bank", 1000);
    await applyBalanceDelta("user-delta-asof", account._id.toString(), -50);
    const updated = await Account.findById(account._id);
    expect(updated!.balanceAsOf).toBeNull();
  });

  it("does not create a BalanceSnapshot — per-transaction deltas are not individually audited", async () => {
    const account = await createAccount("user-delta-nosnap", "bank", 1000);
    await applyBalanceDelta("user-delta-nosnap", account._id.toString(), -50);
    expect(await BalanceSnapshot.countDocuments({ accountId: account._id.toString() })).toBe(0);
  });

  // This app's `Transaction.accountId` is a plain unvalidated string, not a real
  // foreign-key reference — much of the existing test suite (and, in principle,
  // real bad data) uses placeholder ids that aren't valid ObjectIds at all. A
  // malformed id must not crash a request whose real work (creating the
  // Transaction) already succeeded.
  it("silently no-ops (does not throw) for an accountId that isn't a well-formed ObjectId at all", async () => {
    await expect(applyBalanceDelta("some-user", "not-a-valid-object-id", 500)).resolves.toBeUndefined();
  });
});

describe("reconcileBalance", () => {
  it("sets currentBalance and balanceAsOf when there is no prior balanceAsOf at all", async () => {
    const account = await createAccount("user-reconcile-1", "bank", 100);
    const asOf = new Date("2026-08-15");
    const applied = await reconcileBalance("user-reconcile-1", account._id.toString(), 8000, asOf, "statement_closing_balance");
    expect(applied).toBe(true);

    const updated = await Account.findById(account._id);
    expect(updated!.currentBalance).toBe(8000);
    expect(updated!.balanceAsOf!.toISOString()).toBe(asOf.toISOString());
  });

  it("applies when the new as-of date is strictly newer than the stored one", async () => {
    const account = await createAccount("user-reconcile-2", "bank", 100);
    await reconcileBalance("user-reconcile-2", account._id.toString(), 5000, new Date("2026-08-01"), "statement_closing_balance");
    const applied = await reconcileBalance("user-reconcile-2", account._id.toString(), 6000, new Date("2026-08-15"), "statement_closing_balance");
    expect(applied).toBe(true);
    const updated = await Account.findById(account._id);
    expect(updated!.currentBalance).toBe(6000);
  });

  it("REJECTS (no-ops) an older as-of date, leaving the newer figure untouched", async () => {
    const account = await createAccount("user-reconcile-3", "bank", 100);
    await reconcileBalance("user-reconcile-3", account._id.toString(), 6000, new Date("2026-08-15"), "statement_closing_balance");
    const applied = await reconcileBalance("user-reconcile-3", account._id.toString(), 5000, new Date("2026-08-01"), "email_balance");
    expect(applied).toBe(false);
    const updated = await Account.findById(account._id);
    expect(updated!.currentBalance).toBe(6000);
    expect(updated!.balanceAsOf!.toISOString()).toBe(new Date("2026-08-15").toISOString());
  });

  it("REJECTS an equal as-of date (tiebreak: keep the existing figure, never nondeterministically overwrite)", async () => {
    const account = await createAccount("user-reconcile-tie", "bank", 100);
    const sameDate = new Date("2026-08-15T10:00:00.000Z");
    await reconcileBalance("user-reconcile-tie", account._id.toString(), 6000, sameDate, "statement_closing_balance");
    const applied = await reconcileBalance("user-reconcile-tie", account._id.toString(), 9999, sameDate, "email_balance");
    expect(applied).toBe(false);
    const updated = await Account.findById(account._id);
    expect(updated!.currentBalance).toBe(6000);
  });

  it("applies unconditionally when asOf is null (no dateable signal), same as legacy behavior", async () => {
    const account = await createAccount("user-reconcile-null", "bank", 100);
    await reconcileBalance("user-reconcile-null", account._id.toString(), 6000, new Date("2026-08-15"), "statement_closing_balance");
    const applied = await reconcileBalance("user-reconcile-null", account._id.toString(), 7000, null, "statement_closing_balance");
    expect(applied).toBe(true);
    const updated = await Account.findById(account._id);
    expect(updated!.currentBalance).toBe(7000);
    // balanceAsOf is left exactly as it was — an unknown-date reconciliation
    // can't advance the freshness marker.
    expect(updated!.balanceAsOf!.toISOString()).toBe(new Date("2026-08-15").toISOString());
  });

  it("records a BalanceSnapshot with source, previousBalance, delta and asOf on every applied reconciliation", async () => {
    const account = await createAccount("user-reconcile-snap", "bank", 100);
    const asOf = new Date("2026-08-15");
    await reconcileBalance("user-reconcile-snap", account._id.toString(), 8000, asOf, "statement_closing_balance");

    const snapshot = await BalanceSnapshot.findOne({ accountId: account._id.toString() });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.balance).toBe(8000);
    expect(snapshot!.previousBalance).toBe(100);
    expect(snapshot!.delta).toBe(7900);
    expect(snapshot!.source).toBe("statement_closing_balance");
    expect(snapshot!.asOf!.toISOString()).toBe(asOf.toISOString());
  });

  it("does not create a BalanceSnapshot when the reconciliation is rejected as stale", async () => {
    const account = await createAccount("user-reconcile-nosnap", "bank", 100);
    await reconcileBalance("user-reconcile-nosnap", account._id.toString(), 6000, new Date("2026-08-15"), "statement_closing_balance");
    await reconcileBalance("user-reconcile-nosnap", account._id.toString(), 5000, new Date("2026-08-01"), "email_balance");
    expect(await BalanceSnapshot.countDocuments({ accountId: account._id.toString() })).toBe(1);
  });

  it("returns false and does nothing for an account that doesn't exist or isn't this user's", async () => {
    const owner = await createAccount("owner-reconcile", "bank", 100);
    const applied = await reconcileBalance("someone-else", owner._id.toString(), 9999, new Date(), "statement_closing_balance");
    expect(applied).toBe(false);
    const untouched = await Account.findById(owner._id);
    expect(untouched!.currentBalance).toBe(100);
  });

  // Deliberately DOES throw (unlike applyBalanceDelta) for a malformed accountId —
  // statementProcess.worker.ts relies on exactly this to fail an async job on a
  // genuine accountId typo. Callers that need tolerance (pending.routes.ts, a
  // synchronous user-facing request) get it via applyConfirmedTransactionBalanceEffect
  // below, not by softening this function itself.
  it("throws (does not silently swallow) a CastError from a malformed accountId", async () => {
    await expect(
      reconcileBalance("some-user", "not-a-valid-object-id", 9999, new Date(), "statement_closing_balance")
    ).rejects.toThrow();
  });
});

describe("applyConfirmedTransactionBalanceEffect", () => {
  it("applies a plain delta when there is no emailBalance", async () => {
    const account = await createAccount("user-effect-delta", "bank", 1000);
    await applyConfirmedTransactionBalanceEffect(
      "user-effect-delta",
      account._id.toString(),
      -300,
      null,
      new Date("2026-08-16")
    );
    expect((await Account.findById(account._id))!.currentBalance).toBe(700);
  });

  it("reconciles (SET, staleness-guarded) instead of applying a delta when emailBalance is present", async () => {
    const account = await createAccount("user-effect-reconcile", "bank", 1000);
    // If this were (incorrectly) treated as a plain delta, the result would be
    // 1000 + (-300) = 700, not the reconciled figure below.
    await applyConfirmedTransactionBalanceEffect(
      "user-effect-reconcile",
      account._id.toString(),
      -300,
      9500,
      new Date("2026-08-16")
    );
    expect((await Account.findById(account._id))!.currentBalance).toBe(9500);
  });

  it("does NOT fall back to a plain delta when the emailBalance reconciliation is rejected as stale", async () => {
    const account = await createAccount("user-effect-stale", "bank", 1000);
    await reconcileBalance("user-effect-stale", account._id.toString(), 9500, new Date("2026-08-20"), "statement_closing_balance");

    await applyConfirmedTransactionBalanceEffect(
      "user-effect-stale",
      account._id.toString(),
      -300,
      8000,
      new Date("2026-08-16") // older than the already-applied 2026-08-20
    );
    // Must remain exactly 9500 — not 9500-300=9200 (a fallback delta) and not 8000
    // (the stale reconciliation).
    expect((await Account.findById(account._id))!.currentBalance).toBe(9500);
  });

  it("tolerates a malformed accountId without throwing, even on the emailBalance path", async () => {
    await expect(
      applyConfirmedTransactionBalanceEffect("some-user", "not-a-valid-object-id", -300, 8000, new Date())
    ).resolves.toBeUndefined();
  });
});
