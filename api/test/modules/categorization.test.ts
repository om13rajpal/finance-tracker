import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { CategorizationRule } from "../../src/models/CategorizationRule.js";
import { applyCategorizationRules } from "../../src/modules/categorization/categorization.engine.js";
import { app } from "../../src/app.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("categorization engine", () => {
  it("returns null when no rule matches", async () => {
    const result = await applyCategorizationRules("user-1", { merchant: "UNKNOWN MERCHANT" });
    expect(result).toBeNull();
  });

  it("matches a merchant-contains rule", async () => {
    await CategorizationRule.create({
      userId: "user-1",
      matchField: "merchant",
      matchType: "contains",
      matchValue: "SWIGGY",
      categoryId: "cat-dining",
      priority: 1,
    });

    const result = await applyCategorizationRules("user-1", { merchant: "SWIGGY*ORDER 4821" });
    expect(result).toBe("cat-dining");
  });

  it("respects priority order when multiple rules match", async () => {
    await CategorizationRule.create({
      userId: "user-1",
      matchField: "merchant",
      matchType: "contains",
      matchValue: "AMAZON",
      categoryId: "cat-shopping",
      priority: 2,
    });
    await CategorizationRule.create({
      userId: "user-1",
      matchField: "merchant",
      matchType: "contains",
      matchValue: "AMAZON PAY",
      categoryId: "cat-bills",
      priority: 1,
    });

    const result = await applyCategorizationRules("user-1", { merchant: "AMAZON PAY ELECTRICITY" });
    expect(result).toBe("cat-bills");
  });

  it("does not match another user's rules", async () => {
    await CategorizationRule.create({
      userId: "user-2",
      matchField: "merchant",
      matchType: "contains",
      matchValue: "SWIGGY",
      categoryId: "cat-other-user",
      priority: 1,
    });

    const result = await applyCategorizationRules("user-1", { merchant: "SWIGGY ORDER" });
    expect(result).toBeNull();
  });

  it("matches an exact match-type rule, and rejects a merely-containing value", async () => {
    await CategorizationRule.create({
      userId: "user-1",
      matchField: "merchant",
      matchType: "exact",
      matchValue: "SWIGGY",
      categoryId: "cat-dining",
      priority: 1,
    });

    const exactResult = await applyCategorizationRules("user-1", { merchant: "SWIGGY" });
    expect(exactResult).toBe("cat-dining");

    const partialResult = await applyCategorizationRules("user-1", { merchant: "SWIGGY*ORDER 4821" });
    expect(partialResult).toBeNull();
  });

  it("matches case-insensitively for both contains and exact match types", async () => {
    await CategorizationRule.create({
      userId: "user-1",
      matchField: "merchant",
      matchType: "contains",
      matchValue: "swiggy",
      categoryId: "cat-dining",
      priority: 1,
    });
    await CategorizationRule.create({
      userId: "user-1",
      matchField: "note",
      matchType: "exact",
      matchValue: "lunch",
      categoryId: "cat-food",
      priority: 1,
    });

    const containsResult = await applyCategorizationRules("user-1", { merchant: "Swiggy Order" });
    expect(containsResult).toBe("cat-dining");

    const exactResult = await applyCategorizationRules("user-1", { note: "LUNCH" });
    expect(exactResult).toBe("cat-food");
  });

  it("does not match or crash when the rule's matchField is absent from the transaction", async () => {
    await CategorizationRule.create({
      userId: "user-1",
      matchField: "note",
      matchType: "contains",
      matchValue: "REFUND",
      categoryId: "cat-refund",
      priority: 1,
    });

    // transaction has a merchant but no note at all — rule looks at "note"
    const result = await applyCategorizationRules("user-1", { merchant: "SOME MERCHANT" });
    expect(result).toBeNull();
  });

  it("does not match when the transaction has neither merchant nor note", async () => {
    await CategorizationRule.create({
      userId: "user-1",
      matchField: "merchant",
      matchType: "contains",
      matchValue: "SWIGGY",
      categoryId: "cat-dining",
      priority: 1,
    });

    const result = await applyCategorizationRules("user-1", {});
    expect(result).toBeNull();
  });
});

describe("categorization rules routes", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/categorization-rules");
    expect(res.status).toBe(401);
  });

  it("creates a rule and lists it back, sorted by priority", async () => {
    const cookie = authCookie("user-h");

    const createLow = await request(app)
      .post("/categorization-rules")
      .set("Cookie", cookie)
      .send({ matchField: "merchant", matchType: "contains", matchValue: "ZOMATO", categoryId: "cat-dining", priority: 5 });
    expect(createLow.status).toBe(201);
    expect(createLow.body.userId).toBe("user-h");

    const createHigh = await request(app)
      .post("/categorization-rules")
      .set("Cookie", cookie)
      .send({ matchField: "merchant", matchType: "contains", matchValue: "UBER", categoryId: "cat-transport", priority: 1 });
    expect(createHigh.status).toBe(201);

    const listRes = await request(app).get("/categorization-rules").set("Cookie", cookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(2);
    // priority 1 (UBER) must come before priority 5 (ZOMATO)
    expect(listRes.body[0].matchValue).toBe("UBER");
    expect(listRes.body[1].matchValue).toBe("ZOMATO");
  });

  it("rejects an invalid matchField/matchType with a validation error, not a 500", async () => {
    const res = await request(app)
      .post("/categorization-rules")
      .set("Cookie", authCookie("user-i"))
      .send({ matchField: "invalid-field", matchType: "contains", matchValue: "X", categoryId: "cat-x" });
    expect(res.status).toBe(400);
  });

  it("scopes rules per user on list and delete, and 404s deleting someone else's rule", async () => {
    const ownerCookie = authCookie("user-owner-rule");
    const createRes = await request(app)
      .post("/categorization-rules")
      .set("Cookie", ownerCookie)
      .send({ matchField: "merchant", matchType: "contains", matchValue: "NETFLIX", categoryId: "cat-subs" });
    const id = createRes.body._id;

    const otherList = await request(app).get("/categorization-rules").set("Cookie", authCookie("user-intruder-rule"));
    expect(otherList.body).toHaveLength(0);

    const otherDelete = await request(app)
      .delete(`/categorization-rules/${id}`)
      .set("Cookie", authCookie("user-intruder-rule"));
    expect(otherDelete.status).toBe(404);

    const ownDelete = await request(app).delete(`/categorization-rules/${id}`).set("Cookie", ownerCookie);
    expect(ownDelete.status).toBe(204);

    const finalList = await request(app).get("/categorization-rules").set("Cookie", ownerCookie);
    expect(finalList.body).toHaveLength(0);
  });
});
