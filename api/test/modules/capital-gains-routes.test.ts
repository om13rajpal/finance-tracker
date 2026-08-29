import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { SellEvent } from "../../src/models/SellEvent.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("GET /tax/capital-gains", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/tax/capital-gains?fy=2025-26");
    expect(res.status).toBe(401);
  });

  it("requires the fy query param", async () => {
    const res = await request(app).get("/tax/capital-gains").set("Cookie", authCookie());
    expect(res.status).toBe(400);
  });

  it("returns events and correct STCG/LTCG totals for the given FY, scoped to the user", async () => {
    const userId = "user-cg-route";
    await SellEvent.create([
      { userId, symbol: "A", lotId: "l1", sellDate: new Date(), buyDate: new Date("2024-01-01"), sellPrice: 100, unitsSold: 10, costBasis: 500, gainAmount: 500, classification: "LTCG", financialYear: "2025-26" },
      { userId, symbol: "B", lotId: "l2", sellDate: new Date(), buyDate: new Date("2025-05-01"), sellPrice: 50, unitsSold: 5, costBasis: 200, gainAmount: 50, classification: "STCG", financialYear: "2025-26" },
      { userId, symbol: "C", lotId: "l3", sellDate: new Date(), buyDate: new Date("2023-01-01"), sellPrice: 10, unitsSold: 1, costBasis: 5, gainAmount: 5, classification: "LTCG", financialYear: "2024-25" }, // different FY, excluded
      { userId: "other-user", symbol: "D", lotId: "l4", sellDate: new Date(), buyDate: new Date(), sellPrice: 1, unitsSold: 1, costBasis: 1, gainAmount: 100, classification: "STCG", financialYear: "2025-26" }, // different user, excluded
    ]);

    const res = await request(app).get("/tax/capital-gains?fy=2025-26").set("Cookie", authCookie(userId));
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    expect(res.body.totals).toEqual({ stcg: 50, ltcg: 500, stcgCount: 1, ltcgCount: 1 });
  });
});
