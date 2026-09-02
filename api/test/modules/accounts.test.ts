import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { computeNetWorth } from "../../src/modules/accounts/accounts.service.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("accounts", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/accounts");
    expect(res.status).toBe(401);
  });

  it("creates a bank account and a credit card, marking the card as a liability", async () => {
    const cookie = authCookie();
    const bankRes = await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 50000 });
    expect(bankRes.status).toBe(201);
    expect(bankRes.body.isLiability).toBe(false);

    const cardRes = await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "credit_card", institution: "ICICI", nickname: "Amazon Pay", currentBalance: 8000, dueDate: "2026-09-05" });
    expect(cardRes.status).toBe(201);
    expect(cardRes.body.isLiability).toBe(true);
  });

  it("marks isLiability true for credit_card even if client tries to pass isLiability: false explicitly", async () => {
    const cookie = authCookie();
    const cardRes = await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "credit_card", institution: "SBI", nickname: "SBI Card", currentBalance: 2000, isLiability: false });
    expect(cardRes.status).toBe(201);
    expect(cardRes.body.isLiability).toBe(true);
  });

  it("records a new balance and creates a snapshot", async () => {
    const cookie = authCookie();
    const createRes = await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "cash", institution: "Cash", nickname: "Wallet", currentBalance: 1000 });
    const accountId = createRes.body._id;

    const balanceRes = await request(app)
      .post(`/accounts/${accountId}/balance`)
      .set("Cookie", cookie)
      .send({ balance: 1500 });
    expect(balanceRes.status).toBe(200);
    expect(balanceRes.body.currentBalance).toBe(1500);

    const historyRes = await request(app).get(`/accounts/${accountId}/balance-history`).set("Cookie", cookie);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body).toHaveLength(1);
    expect(historyRes.body[0].balance).toBe(1500);
  });

  it("a manual balance update bumps balanceAsOf to now and records previousBalance/delta/source on the snapshot", async () => {
    const cookie = authCookie("user-manual-asof");
    const createRes = await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "cash", institution: "Cash", nickname: "Wallet", currentBalance: 1000 });
    const accountId = createRes.body._id;

    const before = Date.now();
    const balanceRes = await request(app)
      .post(`/accounts/${accountId}/balance`)
      .set("Cookie", cookie)
      .send({ balance: 1500 });
    expect(balanceRes.status).toBe(200);
    const after = Date.now();

    expect(new Date(balanceRes.body.balanceAsOf).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(balanceRes.body.balanceAsOf).getTime()).toBeLessThanOrEqual(after);

    const historyRes = await request(app).get(`/accounts/${accountId}/balance-history`).set("Cookie", cookie);
    expect(historyRes.body[0].source).toBe("manual");
    expect(historyRes.body[0].previousBalance).toBe(1000);
    expect(historyRes.body[0].delta).toBe(500);
  });

  // A manual correction is the person looking at their real bank app right now:
  // it must always win, unconditionally, over anything automated (no staleness
  // guard the way `reconcileBalance` has), AND must bump `balanceAsOf` so a LATER
  // automated reconciliation describing an EARLIER point in time (an old statement
  // processed after the fact, a delayed email) correctly loses to it instead of
  // silently clobbering the correction the person just made.
  it("a manual balance update always applies even when it would 'regress' a later-processed automated balanceAsOf", async () => {
    const { reconcileBalance } = await import("../../src/modules/accounts/balance.service.js");
    const cookie = authCookie("user-manual-wins");
    const createRes = await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 1000 });
    const accountId = createRes.body._id;

    // Simulate a statement reconciliation dated far in the future (later than "now").
    await reconcileBalance("user-manual-wins", accountId, 5000, new Date("2099-01-01"), "statement_closing_balance");

    const balanceRes = await request(app)
      .post(`/accounts/${accountId}/balance`)
      .set("Cookie", cookie)
      .send({ balance: 42 });
    expect(balanceRes.status).toBe(200);
    expect(balanceRes.body.currentBalance).toBe(42);

    const updated = await request(app).get("/accounts").set("Cookie", cookie);
    expect(updated.body.find((a: { _id: string }) => a._id === accountId).currentBalance).toBe(42);
  });

  it("does not let another user update an account's balance or read its history", async () => {
    const ownerCookie = authCookie("owner-1");
    const attackerCookie = authCookie("attacker-1");
    const createRes = await request(app)
      .post("/accounts")
      .set("Cookie", ownerCookie)
      .send({ type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 1000 });
    const accountId = createRes.body._id;

    const balanceRes = await request(app)
      .post(`/accounts/${accountId}/balance`)
      .set("Cookie", attackerCookie)
      .send({ balance: 999999 });
    expect(balanceRes.status).toBe(404);

    const historyRes = await request(app)
      .get(`/accounts/${accountId}/balance-history`)
      .set("Cookie", attackerCookie);
    expect(historyRes.status).toBe(404);

    // confirm the owner's account was NOT modified by the attacker's attempt
    const listRes = await request(app).get("/accounts").set("Cookie", ownerCookie);
    expect(listRes.body[0].currentBalance).toBe(1000);
  });

  it("returns balance-history snapshots sorted by date ascending", async () => {
    const cookie = authCookie("history-user");
    const createRes = await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 100 });
    const accountId = createRes.body._id;

    // Create snapshots out of chronological order by directly manipulating dates via multiple balance posts.
    await request(app).post(`/accounts/${accountId}/balance`).set("Cookie", cookie).send({ balance: 200 });
    await request(app).post(`/accounts/${accountId}/balance`).set("Cookie", cookie).send({ balance: 300 });
    await request(app).post(`/accounts/${accountId}/balance`).set("Cookie", cookie).send({ balance: 150 });

    const historyRes = await request(app).get(`/accounts/${accountId}/balance-history`).set("Cookie", cookie);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body).toHaveLength(3);
    const dates = historyRes.body.map((s: { date: string }) => new Date(s.date).getTime());
    expect(dates[0]).toBeLessThanOrEqual(dates[1]);
    expect(dates[1]).toBeLessThanOrEqual(dates[2]);
    expect(historyRes.body.map((s: { balance: number }) => s.balance)).toEqual([200, 300, 150]);
  });

  it("computes net worth as assets minus liabilities", async () => {
    const cookie = authCookie("user-net-worth");
    await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 100000 });
    await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "credit_card", institution: "ICICI", nickname: "Card", currentBalance: 15000 });

    const netWorth = await computeNetWorth("user-net-worth");
    expect(netWorth).toBe(85000);
  });

  it("computes net worth correctly across a mix of bank, credit_card, ppf, and cash accounts", async () => {
    const cookie = authCookie("user-mixed");
    await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 50000 });
    await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "credit_card", institution: "ICICI", nickname: "Card", currentBalance: 12000 });
    await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "ppf", institution: "SBI PPF", nickname: "PPF", currentBalance: 200000 });
    await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "cash", institution: "Cash", nickname: "Wallet", currentBalance: 3000 });

    // bank + ppf + cash (assets) - credit_card (liability) = 50000 + 200000 + 3000 - 12000
    const netWorth = await computeNetWorth("user-mixed");
    expect(netWorth).toBe(241000);
  });

  // The Accounts page's balance-update field is a plain freeform number input with
  // no sign coercion (web/app/accounts/page.tsx) and displays a credit card's stored
  // currentBalance as-is with a red "Liability" label. Nothing in the UI tells a
  // user which sign to type. A user who naturally types a negative number for a
  // credit card balance (matching how the UI then displays it back) must still get
  // a net worth that's REDUCED by the debt, not inflated by it.
  it("treats a credit card's currentBalance as debt regardless of whether it was stored as a positive or negative number", async () => {
    const cookie = authCookie("user-net-worth-signs");
    await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 100000 });
    await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "credit_card", institution: "ICICI", nickname: "Card", currentBalance: -15000 });

    const netWorth = await computeNetWorth("user-net-worth-signs");
    expect(netWorth).toBe(85000);
  });

  it("returns 0 net worth for a user with no accounts", async () => {
    const netWorth = await computeNetWorth("user-with-no-accounts");
    expect(netWorth).toBe(0);
  });

  it("scopes net worth per user (does not include another user's accounts)", async () => {
    const cookieA = authCookie("net-worth-user-a");
    const cookieB = authCookie("net-worth-user-b");
    await request(app)
      .post("/accounts")
      .set("Cookie", cookieA)
      .send({ type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 999999 });
    await request(app)
      .post("/accounts")
      .set("Cookie", cookieB)
      .send({ type: "bank", institution: "ICICI", nickname: "Savings", currentBalance: 500 });

    const netWorthB = await computeNetWorth("net-worth-user-b");
    expect(netWorthB).toBe(500);
  });

  it("lists only the requesting user's accounts", async () => {
    const cookieA = authCookie("list-user-a");
    const cookieB = authCookie("list-user-b");
    await request(app)
      .post("/accounts")
      .set("Cookie", cookieA)
      .send({ type: "bank", institution: "HDFC", nickname: "A's Account", currentBalance: 100 });
    await request(app)
      .post("/accounts")
      .set("Cookie", cookieB)
      .send({ type: "bank", institution: "ICICI", nickname: "B's Account", currentBalance: 200 });

    const listRes = await request(app).get("/accounts").set("Cookie", cookieA);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].nickname).toBe("A's Account");
  });

  it("updates an account via PATCH, scoped to the owner", async () => {
    const cookie = authCookie("patch-user");
    const createRes = await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 100 });
    const accountId = createRes.body._id;

    const patchRes = await request(app)
      .patch(`/accounts/${accountId}`)
      .set("Cookie", cookie)
      .send({ nickname: "Renamed" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.nickname).toBe("Renamed");
  });

  it("updates isLiability when PATCH changes an account's type", async () => {
    const cookie = authCookie("patch-type-user");
    const createRes = await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "bank", institution: "HDFC", nickname: "Savings", currentBalance: 100 });
    expect(createRes.body.isLiability).toBe(false);
    const accountId = createRes.body._id;

    const patchRes = await request(app)
      .patch(`/accounts/${accountId}`)
      .set("Cookie", cookie)
      .send({ type: "credit_card" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.type).toBe("credit_card");
    expect(patchRes.body.isLiability).toBe(true);
  });

  it("deletes an account, scoped to the owner", async () => {
    const cookie = authCookie("delete-user");
    const createRes = await request(app)
      .post("/accounts")
      .set("Cookie", cookie)
      .send({ type: "cash", institution: "Cash", nickname: "Wallet", currentBalance: 100 });
    const accountId = createRes.body._id;

    const deleteRes = await request(app).delete(`/accounts/${accountId}`).set("Cookie", cookie);
    expect(deleteRes.status).toBe(204);

    const listRes = await request(app).get("/accounts").set("Cookie", cookie);
    expect(listRes.body).toHaveLength(0);
  });
});
