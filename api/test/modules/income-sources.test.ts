import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("income sources", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/tax/income-sources?fy=2025-26");
    expect(res.status).toBe(401);
  });

  it("creates a salary income source with breakdown, lists it scoped by user+fy", async () => {
    const cookie = authCookie("user-inc-1");
    const createRes = await request(app)
      .post("/tax/income-sources")
      .set("Cookie", cookie)
      .send({
        type: "salary",
        financialYear: "2025-26",
        annualAmount: 1200000,
        breakdown: { basic: 600000, hra: 300000, allowances: 300000 },
      });
    expect(createRes.status).toBe(201);

    const listRes = await request(app).get("/tax/income-sources?fy=2025-26").set("Cookie", cookie);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].breakdown.hra).toBe(300000);
  });

  it("updates and deletes, scoped by user, 404 on someone else's id", async () => {
    const cookie = authCookie("user-inc-2");
    const createRes = await request(app)
      .post("/tax/income-sources")
      .set("Cookie", cookie)
      .send({ type: "other", financialYear: "2025-26", annualAmount: 50000 });
    const id = createRes.body._id;

    const patchRes = await request(app)
      .patch(`/tax/income-sources/${id}`)
      .set("Cookie", cookie)
      .send({ annualAmount: 60000 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.annualAmount).toBe(60000);

    const otherUserPatch = await request(app)
      .patch(`/tax/income-sources/${id}`)
      .set("Cookie", authCookie("someone-else"))
      .send({ annualAmount: 1 });
    expect(otherUserPatch.status).toBe(404);

    const deleteRes = await request(app).delete(`/tax/income-sources/${id}`).set("Cookie", cookie);
    expect(deleteRes.status).toBe(204);
  });

  it("lists all financial years for the user when ?fy= is omitted", async () => {
    const cookie = authCookie("user-inc-3");
    await request(app)
      .post("/tax/income-sources")
      .set("Cookie", cookie)
      .send({ type: "other", financialYear: "2024-25", annualAmount: 10000 });
    await request(app)
      .post("/tax/income-sources")
      .set("Cookie", cookie)
      .send({ type: "other", financialYear: "2025-26", annualAmount: 20000 });

    const listRes = await request(app).get("/tax/income-sources").set("Cookie", cookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(2);
  });
});
