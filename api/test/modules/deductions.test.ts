import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { HoldingLot } from "../../src/models/HoldingLot.js";
import { TaxDeduction } from "../../src/models/TaxDeduction.js";
import { syncAutoDeductions } from "../../src/modules/tax/deductions.service.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("deductions", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/tax/deductions?fy=2025-26");
    expect(res.status).toBe(401);
  });

  it("creates a manual deduction and lists it scoped by user+fy", async () => {
    const cookie = authCookie("user-ded-1");
    const createRes = await request(app)
      .post("/tax/deductions")
      .set("Cookie", cookie)
      .send({ section: "80C", amount: 20000, financialYear: "2025-26" });
    expect(createRes.status).toBe(201);
    expect(createRes.body.source).toBe("manual");

    const listRes = await request(app).get("/tax/deductions?fy=2025-26").set("Cookie", cookie);
    expect(listRes.body).toHaveLength(1);
  });

  it("cannot delete an auto-derived deduction", async () => {
    const userId = "user-ded-2";
    const auto = await TaxDeduction.create({ userId, section: "80C", amount: 10000, financialYear: "2025-26", source: "auto_elss" });
    const res = await request(app).delete(`/tax/deductions/${auto._id}`).set("Cookie", authCookie(userId));
    expect(res.status).toBe(400);
  });

  it("syncAutoDeductions sums ELSS-tagged lots bought within the FY into one auto_elss deduction", async () => {
    const userId = "user-ded-3";
    await HoldingLot.create({
      userId, symbol: "ELSSFUND", platform: "groww", instrumentType: "mutual_fund", isElss: true,
      buyDate: new Date("2025-06-01"), buyPrice: 100, units: 500, remainingUnits: 500, // 50000 contributed
    });
    await HoldingLot.create({
      userId, symbol: "NOTELSS", platform: "groww", instrumentType: "mutual_fund", isElss: false,
      buyDate: new Date("2025-06-01"), buyPrice: 100, units: 500, remainingUnits: 500, // not ELSS, excluded
    });
    await HoldingLot.create({
      userId, symbol: "ELSSFUND", platform: "groww", instrumentType: "mutual_fund", isElss: true,
      buyDate: new Date("2024-06-01"), buyPrice: 100, units: 100, remainingUnits: 100, // different FY, excluded
    });

    await syncAutoDeductions(userId, "2025-26");

    const stored = await TaxDeduction.findOne({ userId, source: "auto_elss", financialYear: "2025-26" });
    expect(stored?.amount).toBe(50000);
  });

  it("syncAutoDeductions re-running updates the existing document rather than duplicating it", async () => {
    const userId = "user-ded-4";
    await HoldingLot.create({
      userId, symbol: "ELSSFUND", platform: "groww", instrumentType: "mutual_fund", isElss: true,
      buyDate: new Date("2025-06-01"), buyPrice: 100, units: 100, remainingUnits: 100,
    });
    await syncAutoDeductions(userId, "2025-26");
    await HoldingLot.create({
      userId, symbol: "ELSSFUND", platform: "groww", instrumentType: "mutual_fund", isElss: true,
      buyDate: new Date("2025-07-01"), buyPrice: 100, units: 50, remainingUnits: 50,
    });
    await syncAutoDeductions(userId, "2025-26");

    const all = await TaxDeduction.find({ userId, source: "auto_elss", financialYear: "2025-26" });
    expect(all).toHaveLength(1);
    expect(all[0].amount).toBe(15000);
  });

  it("syncAutoDeductions removes the auto_elss row entirely when no ELSS lots remain in the FY", async () => {
    const userId = "user-ded-5";
    const lot = await HoldingLot.create({
      userId, symbol: "ELSSFUND", platform: "groww", instrumentType: "mutual_fund", isElss: true,
      buyDate: new Date("2025-06-01"), buyPrice: 100, units: 100, remainingUnits: 100,
    });
    await syncAutoDeductions(userId, "2025-26");
    expect(await TaxDeduction.countDocuments({ userId, source: "auto_elss" })).toBe(1);

    // With the tagged lot gone, the sync must delete the stale auto row rather than
    // leave a zero-amount one behind — an auto row can't be deleted through the API,
    // so a lingering Rs. 0 entry would be permanently stuck in the user's list.
    await HoldingLot.deleteOne({ _id: lot._id });
    await syncAutoDeductions(userId, "2025-26");
    expect(await TaxDeduction.countDocuments({ userId, source: "auto_elss" })).toBe(0);
  });

  it("GET /tax/deductions refreshes the auto_elss deduction from ELSS-tagged lots before listing", async () => {
    const userId = "user-ded-6";
    await HoldingLot.create({
      userId, symbol: "ELSSFUND", platform: "groww", instrumentType: "mutual_fund", isElss: true,
      buyDate: new Date("2025-06-01"), buyPrice: 100, units: 250, remainingUnits: 250, // 25000 contributed
    });

    const res = await request(app).get("/tax/deductions?fy=2025-26").set("Cookie", authCookie(userId));
    expect(res.status).toBe(200);
    const auto = (res.body as { source: string; amount: number; section: string }[]).find(
      (d) => d.source === "auto_elss"
    );
    expect(auto).toBeDefined();
    expect(auto?.amount).toBe(25000);
    expect(auto?.section).toBe("80C");
  });
});
