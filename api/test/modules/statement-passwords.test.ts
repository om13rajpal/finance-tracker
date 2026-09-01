import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { StatementPassword } from "../../src/models/StatementPassword.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("statement passwords routes", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/statement-passwords");
    expect(res.status).toBe(401);
  });

  it("creates a password, encrypting it at rest, and never returns the plaintext or ciphertext on create", async () => {
    const cookie = authCookie("user-sp-1");

    const res = await request(app)
      .post("/statement-passwords")
      .set("Cookie", cookie)
      .send({ label: "SBI statement", password: "my-real-bank-password" });

    expect(res.status).toBe(201);
    expect(res.body.label).toBe("SBI statement");
    expect(res.body.password).toBeUndefined();
    expect(res.body.passwordEncrypted).toBeUndefined();

    const stored = await StatementPassword.findById(res.body._id);
    expect(stored).not.toBeNull();
    expect(stored!.passwordEncrypted).not.toBe("my-real-bank-password");
    // iv:tag:data hex format, same as encryption.ts's own round-trip format.
    expect(stored!.passwordEncrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("defaults label to an empty string when omitted", async () => {
    const res = await request(app)
      .post("/statement-passwords")
      .set("Cookie", authCookie("user-sp-nolabel"))
      .send({ password: "some-password" });
    expect(res.status).toBe(201);
    expect(res.body.label).toBe("");
  });

  it("rejects a create with no password", async () => {
    const res = await request(app)
      .post("/statement-passwords")
      .set("Cookie", authCookie("user-sp-2"))
      .send({ label: "no password" });
    expect(res.status).toBe(400);
  });

  it("lists only {_id, label, createdAt} — never leaks the password in any form", async () => {
    const userId = "user-sp-list";
    const cookie = authCookie(userId);
    await request(app)
      .post("/statement-passwords")
      .set("Cookie", cookie)
      .send({ label: "one", password: "secret-one" });
    await request(app)
      .post("/statement-passwords")
      .set("Cookie", cookie)
      .send({ label: "two", password: "secret-two" });

    const res = await request(app).get("/statement-passwords").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    for (const entry of res.body) {
      expect(Object.keys(entry).sort()).toEqual(["_id", "createdAt", "label"].sort());
    }
  });

  it("scopes the list per user", async () => {
    await request(app)
      .post("/statement-passwords")
      .set("Cookie", authCookie("user-sp-owner"))
      .send({ label: "owner's", password: "owner-secret" });

    const res = await request(app)
      .get("/statement-passwords")
      .set("Cookie", authCookie("user-sp-intruder"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("deletes a password, scoped to the owner — 404s for another user's password", async () => {
    const ownerCookie = authCookie("user-sp-delete-owner");
    const createRes = await request(app)
      .post("/statement-passwords")
      .set("Cookie", ownerCookie)
      .send({ label: "to delete", password: "delete-me" });
    const id = createRes.body._id;

    const intruderDelete = await request(app)
      .delete(`/statement-passwords/${id}`)
      .set("Cookie", authCookie("user-sp-delete-intruder"));
    expect(intruderDelete.status).toBe(404);

    const stillThere = await StatementPassword.findById(id);
    expect(stillThere).not.toBeNull();

    const ownDelete = await request(app).delete(`/statement-passwords/${id}`).set("Cookie", ownerCookie);
    expect(ownDelete.status).toBe(204);

    const gone = await StatementPassword.findById(id);
    expect(gone).toBeNull();
  });

  it("returns 404 deleting a nonexistent password", async () => {
    const res = await request(app)
      .delete("/statement-passwords/64b000000000000000000000")
      .set("Cookie", authCookie("user-sp-nonexistent"));
    expect(res.status).toBe(404);
  });
});
