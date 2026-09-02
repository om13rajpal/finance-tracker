import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../src/app.js";
import { EmailSource } from "../../src/models/EmailSource.js";

function authCookie(userId = "user-1") {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET as string);
  return `token=${token}`;
}

describe("email sources routes", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/email-sources");
    expect(res.status).toBe(401);
  });

  it("creates a trusted sender, lower-cased and trimmed, with a derived parserKey", async () => {
    const cookie = authCookie("user-es-1");

    const res = await request(app)
      .post("/email-sources")
      .set("Cookie", cookie)
      .send({ senderPattern: "  Alerts@SBI.co.in  ", institution: "State Bank of India" });

    expect(res.status).toBe(201);
    expect(res.body.senderPattern).toBe("alerts@sbi.co.in");
    expect(res.body.institution).toBe("State Bank of India");

    const stored = await EmailSource.findById(res.body._id);
    expect(stored).not.toBeNull();
    expect(stored!.senderPattern).toBe("alerts@sbi.co.in");
  });

  // Regression-shaped: SBI has no registered email-BODY parser
  // (parsers/registry.ts only has hdfc_debit_alert today), but that must
  // never block trusting the sender at all — PDF-statement attachment
  // processing reads `institution` directly and isn't gated by parserKey.
  it("still creates a source for an institution with no registered email-body parser", async () => {
    const res = await request(app)
      .post("/email-sources")
      .set("Cookie", authCookie("user-es-nobodyparser"))
      .send({ senderPattern: "estatements@sbi.co.in", institution: "State Bank of India" });

    expect(res.status).toBe(201);

    const stored = await EmailSource.findById(res.body._id);
    expect(stored!.parserKey).toBeTruthy(); // schema requires a non-empty string
  });

  it("derives the hdfc_debit_alert parserKey for an HDFC institution", async () => {
    const res = await request(app)
      .post("/email-sources")
      .set("Cookie", authCookie("user-es-hdfc"))
      .send({ senderPattern: "alerts@hdfcbank.net", institution: "HDFC Bank" });

    expect(res.status).toBe(201);
    const stored = await EmailSource.findById(res.body._id);
    expect(stored!.parserKey).toBe("hdfc_debit_alert");
  });

  it("rejects a create with an invalid email address", async () => {
    const res = await request(app)
      .post("/email-sources")
      .set("Cookie", authCookie("user-es-2"))
      .send({ senderPattern: "not-an-email", institution: "Some Bank" });
    expect(res.status).toBe(400);
  });

  it("rejects a create with no institution", async () => {
    const res = await request(app)
      .post("/email-sources")
      .set("Cookie", authCookie("user-es-3"))
      .send({ senderPattern: "alerts@somebank.com" });
    expect(res.status).toBe(400);
  });

  it("lists this user's sources, flagging whether an email-body parser is actually registered for each", async () => {
    const userId = "user-es-list";
    const cookie = authCookie(userId);
    await request(app)
      .post("/email-sources")
      .set("Cookie", cookie)
      .send({ senderPattern: "alerts@hdfcbank.net", institution: "HDFC Bank" });
    await request(app)
      .post("/email-sources")
      .set("Cookie", cookie)
      .send({ senderPattern: "alerts@sbi.co.in", institution: "State Bank of India" });

    const res = await request(app).get("/email-sources").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const byInstitution = Object.fromEntries(
      (res.body as { institution: string }[]).map((s) => [s.institution, s])
    );
    expect(byInstitution["HDFC Bank"].hasEmailBodyParser).toBe(true);
    expect(byInstitution["State Bank of India"].hasEmailBodyParser).toBe(false);
  });

  it("does not list another user's sources", async () => {
    await request(app)
      .post("/email-sources")
      .set("Cookie", authCookie("scope-user-a"))
      .send({ senderPattern: "alerts@a-bank.com", institution: "A Bank" });
    await request(app)
      .post("/email-sources")
      .set("Cookie", authCookie("scope-user-b"))
      .send({ senderPattern: "alerts@b-bank.com", institution: "B Bank" });

    const res = await request(app).get("/email-sources").set("Cookie", authCookie("scope-user-a"));
    expect(res.body).toHaveLength(1);
    expect(res.body[0].institution).toBe("A Bank");
  });

  it("deletes a source scoped to the owner", async () => {
    const ownerCookie = authCookie("es-delete-owner");
    const createRes = await request(app)
      .post("/email-sources")
      .set("Cookie", ownerCookie)
      .send({ senderPattern: "alerts@somebank.com", institution: "Some Bank" });

    const attackerDel = await request(app)
      .delete(`/email-sources/${createRes.body._id}`)
      .set("Cookie", authCookie("es-delete-attacker"));
    expect(attackerDel.status).toBe(404);

    const ownerDel = await request(app)
      .delete(`/email-sources/${createRes.body._id}`)
      .set("Cookie", ownerCookie);
    expect(ownerDel.status).toBe(204);

    expect(await EmailSource.findById(createRes.body._id)).toBeNull();
  });

  it("returns 404 deleting a nonexistent source", async () => {
    const res = await request(app)
      .delete("/email-sources/000000000000000000000000")
      .set("Cookie", authCookie("es-delete-404"));
    expect(res.status).toBe(404);
  });
});
