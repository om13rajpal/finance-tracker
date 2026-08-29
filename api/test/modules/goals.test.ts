import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("goals", () => {
  it("creates, lists, updates progress, and deletes a goal", async () => {
    const cookie = authCookie("user-goals");

    const createRes = await request(app)
      .post("/goals")
      .set("Cookie", cookie)
      .send({ name: "Emergency Fund", targetAmount: 500000, currentAmount: 0, targetDate: "2027-01-01" });
    expect(createRes.status).toBe(201);
    const goalId = createRes.body._id;

    const listRes = await request(app).get("/goals").set("Cookie", cookie);
    expect(listRes.body).toHaveLength(1);

    const patchRes = await request(app).patch(`/goals/${goalId}`).set("Cookie", cookie).send({ currentAmount: 50000 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.currentAmount).toBe(50000);

    const delRes = await request(app).delete(`/goals/${goalId}`).set("Cookie", cookie);
    expect(delRes.status).toBe(204);

    const finalList = await request(app).get("/goals").set("Cookie", cookie);
    expect(finalList.body).toHaveLength(0);
  });

  it("creates a goal without a targetDate", async () => {
    const cookie = authCookie("user-goals-no-date");

    const createRes = await request(app)
      .post("/goals")
      .set("Cookie", cookie)
      .send({ name: "New Car", targetAmount: 1000000 });
    expect(createRes.status).toBe(201);
    expect(createRes.body.targetDate).toBeNull();
    expect(createRes.body.currentAmount).toBe(0);
  });

  it("returns 404 patching a nonexistent goal", async () => {
    const cookie = authCookie("user-goals-404");
    const res = await request(app)
      .patch("/goals/000000000000000000000000")
      .set("Cookie", cookie)
      .send({ currentAmount: 100 });
    expect(res.status).toBe(404);
  });

  it("returns 404 deleting a nonexistent goal", async () => {
    const cookie = authCookie("user-goals-404-del");
    const res = await request(app).delete("/goals/000000000000000000000000").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/goals");
    expect(res.status).toBe(401);
  });

  it("isolates goals between users - cannot see, patch, or delete another user's goal", async () => {
    const ownerCookie = authCookie("user-goals-owner");
    const otherCookie = authCookie("user-goals-other");

    const createRes = await request(app)
      .post("/goals")
      .set("Cookie", ownerCookie)
      .send({ name: "Vacation Fund", targetAmount: 200000 });
    expect(createRes.status).toBe(201);
    const goalId = createRes.body._id;

    // other user's list does not include owner's goal
    const otherList = await request(app).get("/goals").set("Cookie", otherCookie);
    expect(otherList.body).toHaveLength(0);

    // other user cannot patch owner's goal
    const patchRes = await request(app)
      .patch(`/goals/${goalId}`)
      .set("Cookie", otherCookie)
      .send({ currentAmount: 999 });
    expect(patchRes.status).toBe(404);

    // other user cannot delete owner's goal
    const delRes = await request(app).delete(`/goals/${goalId}`).set("Cookie", otherCookie);
    expect(delRes.status).toBe(404);

    // owner's goal is untouched
    const ownerList = await request(app).get("/goals").set("Cookie", ownerCookie);
    expect(ownerList.body).toHaveLength(1);
    expect(ownerList.body[0].currentAmount).toBe(0);
  });
});
