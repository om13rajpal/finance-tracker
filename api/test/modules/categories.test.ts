import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("categories", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/categories");
    expect(res.status).toBe(401);
  });

  it("creates a top-level category and a sub-category", async () => {
    const cookie = authCookie();
    const parentRes = await request(app)
      .post("/categories")
      .set("Cookie", cookie)
      .send({ name: "Food", type: "expense", bucket: "guilt_free", budgetLimit: 8000 });
    expect(parentRes.status).toBe(201);
    const parentId = parentRes.body._id;

    const childRes = await request(app)
      .post("/categories")
      .set("Cookie", cookie)
      .send({ name: "Dining Out", type: "expense", bucket: "guilt_free", parentCategoryId: parentId, budgetLimit: 4000 });
    expect(childRes.status).toBe(201);

    const listRes = await request(app).get("/categories").set("Cookie", cookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].children).toHaveLength(1);
    expect(listRes.body[0].children[0].name).toBe("Dining Out");
  });

  it("scopes categories per user", async () => {
    await request(app)
      .post("/categories")
      .set("Cookie", authCookie("user-a"))
      .send({ name: "Rent", type: "expense", bucket: "fixed_costs", budgetLimit: 20000 });

    const listRes = await request(app).get("/categories").set("Cookie", authCookie("user-b"));
    expect(listRes.body).toHaveLength(0);
  });

  it("updates a category's own fields", async () => {
    const cookie = authCookie("user-c");
    const createRes = await request(app)
      .post("/categories")
      .set("Cookie", cookie)
      .send({ name: "Groceries", type: "expense", bucket: "fixed_costs", budgetLimit: 5000 });
    const id = createRes.body._id;

    const patchRes = await request(app)
      .patch(`/categories/${id}`)
      .set("Cookie", cookie)
      .send({ budgetLimit: 6000 });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.budgetLimit).toBe(6000);
    expect(patchRes.body.name).toBe("Groceries");
  });

  it("returns 404 patching a category that doesn't belong to the caller", async () => {
    const ownerCookie = authCookie("user-owner");
    const createRes = await request(app)
      .post("/categories")
      .set("Cookie", ownerCookie)
      .send({ name: "Utilities", type: "expense", bucket: "fixed_costs", budgetLimit: 3000 });
    const id = createRes.body._id;

    const patchRes = await request(app)
      .patch(`/categories/${id}`)
      .set("Cookie", authCookie("user-intruder"))
      .send({ budgetLimit: 1 });
    expect(patchRes.status).toBe(404);

    // untouched when read back by the real owner
    const listRes = await request(app).get("/categories").set("Cookie", ownerCookie);
    expect(listRes.body[0].budgetLimit).toBe(3000);
  });

  it("returns 404 patching a nonexistent category id", async () => {
    const res = await request(app)
      .patch("/categories/64b6f0f0f0f0f0f0f0f0f0f0")
      .set("Cookie", authCookie())
      .send({ budgetLimit: 1 });
    expect(res.status).toBe(404);
  });

  it("rejects a category being set as its own parent", async () => {
    const cookie = authCookie("user-d");
    const createRes = await request(app)
      .post("/categories")
      .set("Cookie", cookie)
      .send({ name: "Loop", type: "expense", bucket: "fixed_costs", budgetLimit: 100 });
    const id = createRes.body._id;

    const patchRes = await request(app)
      .patch(`/categories/${id}`)
      .set("Cookie", cookie)
      .send({ parentCategoryId: id });
    expect(patchRes.status).toBe(400);
  });

  it("deletes a category the caller owns, and returns 404 for others'", async () => {
    const cookie = authCookie("user-e");
    const createRes = await request(app)
      .post("/categories")
      .set("Cookie", cookie)
      .send({ name: "Subscriptions", type: "expense", bucket: "fixed_costs", budgetLimit: 500 });
    const id = createRes.body._id;

    const otherDeleteRes = await request(app)
      .delete(`/categories/${id}`)
      .set("Cookie", authCookie("user-f"));
    expect(otherDeleteRes.status).toBe(404);

    const deleteRes = await request(app).delete(`/categories/${id}`).set("Cookie", cookie);
    expect(deleteRes.status).toBe(204);

    const listRes = await request(app).get("/categories").set("Cookie", cookie);
    expect(listRes.body).toHaveLength(0);
  });

  it("does not lose a category whose parent was deleted (orphan surfaces as top-level)", async () => {
    const cookie = authCookie("user-g");
    const parentRes = await request(app)
      .post("/categories")
      .set("Cookie", cookie)
      .send({ name: "Travel", type: "expense", bucket: "guilt_free", budgetLimit: 1000 });
    const parentId = parentRes.body._id;

    const childRes = await request(app)
      .post("/categories")
      .set("Cookie", cookie)
      .send({ name: "Flights", type: "expense", bucket: "guilt_free", parentCategoryId: parentId, budgetLimit: 500 });
    const childId = childRes.body._id;

    await request(app).delete(`/categories/${parentId}`).set("Cookie", cookie);

    const listRes = await request(app).get("/categories").set("Cookie", cookie);
    expect(listRes.status).toBe(200);
    // the orphaned child must still be present (as a top-level entry), not silently dropped
    const ids = listRes.body.map((c: { _id: string }) => c._id);
    expect(ids).toContain(childId);
  });
});
