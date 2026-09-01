import { Account } from "../../models/Account.js";
import { BalanceSnapshot } from "../../models/BalanceSnapshot.js";

/** Mongoose's `CastError` — thrown synchronously (as a rejected promise here) when
 * `accountId` doesn't even look like a valid ObjectId, distinct from a query that
 * runs fine but matches nothing. */
function isCastError(err: unknown): boolean {
  return (err as { name?: string } | undefined)?.name === "CastError";
}

/**
 * Applies an incremental delta to an account's stored `currentBalance` — the shared
 * helper every transaction-creating (and transaction-reversing) code path uses so
 * this logic exists exactly once, rather than four-plus separate ad-hoc `$inc`
 * calls: manual creation, CSV import, a recurring item firing, a pending
 * transaction being confirmed (when it carries no better signal — see
 * `reconcileBalance` below for when it does), and a transaction later being edited
 * or deleted (`transactions.routes.ts`).
 *
 * `delta` is this app's existing signed-amount convention (negative = expense,
 * positive = income) applied AS-IS for a plain asset account (bank/ppf/cash):
 * `currentBalance += delta`. A CREDIT CARD is a liability, not an asset, so the
 * same expense must move its `currentBalance` the OPPOSITE direction — swiping the
 * card (a negative delta) INCREASES what's owed, it doesn't decrease a balance the
 * way a bank debit would. Keyed off `type === "credit_card"` specifically, not the
 * stored `isLiability` convenience flag, mirroring `computeNetWorth`'s own
 * authoritative-vs-derived-field reasoning (accounts.service.ts) — this stays
 * correct even if `isLiability` were ever wrong or out of sync.
 *
 * ATOMICITY: this is a single MongoDB aggregation-pipeline update
 * (`findOneAndUpdate` with a pipeline, not a plain object), computed and applied
 * entirely server-side in one atomic operation — deliberately NOT a
 * read-`currentBalance`-then-write-new-value round trip, which would race under
 * concurrent callers (e.g. two BullMQ workers touching the same account close
 * together) and could silently lose one side's update. The credit-card-sign
 * decision reads `$type` from the very same document the update is applied to, in
 * the same atomic step, so there's no separate "read the account first" step at
 * all here.
 *
 * Also rounds the resulting `currentBalance` to 2 decimal places (INR paise),
 * server-side, every time — thousands of incremental floating-point additions over
 * an account's lifetime would otherwise accumulate visible rounding drift (e.g.
 * 0.1 + 0.2 + 0.1 landing on 0.30000000000000004 instead of 0.3).
 *
 * Deliberately unconditional on the account still existing: a silent no-op (via
 * `findOneAndUpdate` matching nothing) for a deleted/foreign account, same as every
 * other ownership-scoped write in this app. Also silently no-ops for an `accountId`
 * that isn't even a well-formed id at all (a Mongoose `CastError`, not just a
 * "not found" result) — this app's `Transaction.accountId` is a plain unvalidated
 * string, not a real foreign-key reference, so a malformed/foreign value reaching
 * here is possible; failing an entire request (one whose real work, e.g. creating
 * the `Transaction` itself, already succeeded) over this side effect's id shape
 * would be a worse outcome than just skipping the balance update.
 *
 * Never touches `balanceAsOf` and never writes a `BalanceSnapshot` — this is a
 * plain incremental ledger update, not a reconciliation event. Snapshots exist for
 * "the balance was independently verified/corrected to X," not for every one of
 * potentially thousands of individual transactions (see `reconcileBalance`).
 */
export async function applyBalanceDelta(userId: string, accountId: string, delta: number): Promise<void> {
  if (delta === 0) return;

  try {
    await Account.findOneAndUpdate({ _id: accountId, userId }, [
      {
        $set: {
          currentBalance: {
            $round: [
              {
                $add: ["$currentBalance", { $cond: [{ $eq: ["$type", "credit_card"] }, -delta, delta] }],
              },
              2,
            ],
          },
          lastUpdated: new Date(),
        },
      },
    ]);
  } catch (err) {
    if (isCastError(err)) return;
    throw err;
  }
}

export type BalanceReconciliationSource = "statement_closing_balance" | "email_balance";

/**
 * Staleness-guarded reconciliation: overwrites `currentBalance` to `balance` —
 * an authoritative figure from an external source (a statement's own printed
 * closing balance, or an email alert's embedded "Avl Bal") — but ONLY if `asOf`
 * (that source's own as-of date) is STRICTLY newer than the account's stored
 * `balanceAsOf`. An equal or older `asOf` is a no-op: this prevents an
 * out-of-order statement/email (uploaded or processed later, but describing an
 * earlier point in time) from regressing a balance that a more current source
 * already established. Ties (an equal `asOf`, e.g. two sources both dated the
 * same day) are deliberately also rejected, not nondeterministically applied —
 * "keep what's already there" is the one predictable outcome.
 *
 * `asOf === null` means this call has no reliable date to compare (a statement
 * that established a closing balance with zero dateable transaction rows — see
 * `statementProcess.worker.ts`) — applies unconditionally in that case, preserving
 * this app's pre-existing behavior for that edge case rather than refusing to
 * reconcile at all just because there's nothing to guard against. It also leaves
 * the account's `balanceAsOf` completely untouched (an unknown-date reconciliation
 * can't advance the freshness marker for anything that comes after it).
 *
 * ATOMICITY: the guard check and the write are ONE `findOneAndUpdate` call — the
 * `asOf` comparison is expressed directly in the filter (`$or:
 * [{balanceAsOf:null},{balanceAsOf:{$lt:asOf}}]`), not a separate
 * read-then-decide-then-write, so two concurrent reconciliation attempts can't
 * race each other into an inconsistent state. `findOneAndUpdate`'s default
 * (pre-update) return document is used both as the "did this match/apply?" signal
 * (`null` means either no such account or the guard rejected it) and as the
 * snapshot's `previousBalance`, without a second read.
 *
 * Every APPLIED reconciliation writes a `BalanceSnapshot` recording not just the
 * new balance but WHY it changed: `source`, `previousBalance`, `delta`, and the
 * source's own `asOf` — a rejected (stale) attempt writes nothing, so the
 * snapshot history only ever contains changes that actually happened.
 */
export async function reconcileBalance(
  userId: string,
  accountId: string,
  balance: number,
  asOf: Date | null,
  source: BalanceReconciliationSource
): Promise<boolean> {
  const roundedBalance = Math.round(balance * 100) / 100;

  const filter: Record<string, unknown> = { _id: accountId, userId };
  if (asOf !== null) {
    filter.$or = [{ balanceAsOf: null }, { balanceAsOf: { $lt: asOf } }];
  }

  const update: Record<string, unknown> = { currentBalance: roundedBalance, lastUpdated: new Date() };
  if (asOf !== null) update.balanceAsOf = asOf;

  // Default options return the PRE-update document — exactly what's needed both to
  // detect a match (null means "no such account" or "guard rejected it") and to
  // populate the snapshot's previousBalance, in this one atomic round trip.
  const previous = await Account.findOneAndUpdate(filter, update);
  if (!previous) return false;

  await BalanceSnapshot.create({
    accountId,
    balance: roundedBalance,
    date: new Date(),
    source,
    previousBalance: previous.currentBalance,
    delta: Math.round((roundedBalance - previous.currentBalance) * 100) / 100,
    asOf,
  });

  return true;
}

/**
 * The one balance-side-effect decision a pending transaction's confirm route
 * (`pending.routes.ts`, both the single and bulk confirm handlers) needs, shared
 * so it exists exactly once rather than duplicated between them:
 *
 *  - When `alreadyReconciledAtImport` is true (this row's own
 *    `PendingTransaction.balanceReconciledAtImport`, passed through by the
 *    caller — see that field's doc comment), this transaction's effect on the
 *    balance was already captured by its import's statement-level
 *    closing-balance reconciliation, potentially long before anyone reviewed
 *    this specific row. Applying its `amount` as a delta on top now would
 *    double-count it, so this is a deliberate, immediate no-op — nothing left
 *    to apply.
 *  - Otherwise, when this transaction carries an `emailBalance` (currently only
 *    an HDFC "Avl Bal" alert — see `PendingTransaction.emailBalance`), that
 *    figure is the bank's OWN stated truth at `asOf` (the transaction's own
 *    date) — reconcile the account to it directly via `reconcileBalance`,
 *    staleness-guarded as usual. Deliberately does NOT also apply the
 *    transaction's own `amount` as a plain delta on top, whether the
 *    reconciliation applies OR is rejected as stale: if it applies, the new
 *    figure already includes this transaction's effect (adding the delta too
 *    would double-count it); if it's rejected as stale, that means a
 *    chronologically LATER reconciliation already exists — and since that
 *    later figure reflects reality at a point in time AFTER this transaction,
 *    it necessarily already accounts for this transaction too (the bank's own
 *    ledger is authoritative and complete), so there is nothing left to apply
 *    either way.
 *  - Otherwise (no prior reconciliation, no `emailBalance` — everything except
 *    HDFC alert emails, e.g. a plain email-parsed transaction with no balance
 *    figure, or an SBI one, which doesn't reliably send one at all), falls
 *    back to the existing plain-delta path via `applyBalanceDelta`.
 *
 * Tolerates a malformed/foreign `accountId` (a Mongoose `CastError` from
 * `reconcileBalance`, which does not swallow it itself — `statementProcess.worker.ts`
 * deliberately relies on that throwing behavior to fail an async job on a genuine
 * accountId typo) the same way `applyBalanceDelta` already does: this runs inside a
 * synchronous, user-facing confirm request that has already created the real
 * `Transaction`, so failing the whole request over this side effect would be worse
 * than silently skipping it.
 *
 * Returns whether an incremental DELTA was applied (the third bullet above) as
 * opposed to a reconciliation or nothing at all — the caller stamps this onto
 * the new `Transaction`'s own `balanceDeltaApplied` field, so a later
 * delete/amount-edit of that same transaction knows whether reversing/
 * adjusting the balance by its `amount` is even correct.
 */
export async function applyConfirmedTransactionBalanceEffect(
  userId: string,
  accountId: string,
  amount: number,
  emailBalance: number | null,
  asOf: Date,
  alreadyReconciledAtImport = false
): Promise<boolean> {
  if (alreadyReconciledAtImport) return false;

  if (emailBalance === null) {
    await applyBalanceDelta(userId, accountId, amount);
    return true;
  }

  try {
    await reconcileBalance(userId, accountId, emailBalance, asOf, "email_balance");
  } catch (err) {
    if (!isCastError(err)) throw err;
  }
  return false;
}
