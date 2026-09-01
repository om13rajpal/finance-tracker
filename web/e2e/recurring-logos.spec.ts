import { test, expect, type BrowserContext } from "@playwright/test";
import { MongoClient, ObjectId } from "mongodb";
import jwt from "jsonwebtoken";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// Same login-bypass technique as golden-path.spec.ts — see that file's comment
// for why this reads api/.env rather than assuming a debug endpoint exists.
loadEnv({ path: resolve(__dirname, "../../api/.env") });

const TEST_EMAIL = "e2e-recurring-logos@example.com";
const TEST_USER_ID = new ObjectId("000000000000000000000002");

async function loginAsTestUser(context: BrowserContext): Promise<void> {
  const mongoUri = process.env.MONGO_URI;
  const jwtSecret = process.env.JWT_SECRET;
  if (!mongoUri || !jwtSecret) {
    throw new Error("MONGO_URI and JWT_SECRET must be set (read from api/.env) to run this test.");
  }

  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    await client
      .db()
      .collection("users")
      .updateOne(
        { _id: TEST_USER_ID },
        { $set: { email: TEST_EMAIL, createdAt: new Date() } },
        { upsert: true }
      );
  } finally {
    await client.close();
  }

  const token = jwt.sign({ userId: TEST_USER_ID.toString() }, jwtSecret);
  await context.addCookies([
    { name: "token", value: token, url: "http://localhost:3000", httpOnly: true, sameSite: "Lax" },
  ]);
}

test.describe("recurring · merchant logos", () => {
  test.afterEach(async ({ page }) => {
    try {
      const items = await page.request.get("/api/recurring").then((r) => r.json());
      for (const i of items.filter((i: { name: string }) =>
        ["Netflix", "Some Totally Unknown Merchant Co"].includes(i.name)
      )) {
        await page.request.delete(`/api/recurring/${i._id}`);
      }
    } catch {
      // best-effort
    }
    try {
      const accounts = await page.request.get("/api/accounts").then((r) => r.json());
      for (const a of accounts.filter((a: { nickname: string }) => a.nickname === "Logo Test Acct")) {
        await page.request.delete(`/api/accounts/${a._id}`);
      }
    } catch {
      // best-effort
    }
    try {
      const categories = await page.request.get("/api/categories").then((r) => r.json());
      for (const c of categories.filter((c: { name: string }) => c.name === "Logo Test Category")) {
        await page.request.delete(`/api/categories/${c._id}`);
      }
    } catch {
      // best-effort
    }
  });

  test("a recognised merchant name renders a real logo image, and an unrecognised one keeps the bucket glyph", async ({
    page,
  }) => {
    await loginAsTestUser(page.context());

    await page.goto("/accounts");
    await page.getByLabel("Institution").fill("Test Bank");
    await page.getByLabel("Nickname").fill("Logo Test Acct");
    await page.getByLabel("Starting Balance").fill("10000");
    await page.getByRole("button", { name: "Add Account" }).click();
    await expect(page.getByText("Logo Test Acct", { exact: true })).toBeVisible();

    await page.goto("/budgets");
    await page.getByLabel("Name").fill("Logo Test Category");
    await page.getByLabel(/Bucket/).selectOption("guilt_free");
    await page.getByLabel("Monthly Budget").fill("5000");
    await page.getByRole("button", { name: "Add Category" }).click();
    await expect(page.locator("span.font-medium", { hasText: "Logo Test Category" })).toBeVisible();

    await page.goto("/recurring");

    // A name the hardcoded table confidently matches.
    await page.getByLabel("Name").fill("Netflix");
    await page.getByLabel("Amount", { exact: false }).fill("649");
    await page.locator("#rec-account").selectOption({ label: "Test Bank · Logo Test Acct" });
    await page.locator("#rec-category").selectOption({ label: "Logo Test Category" });
    await page.getByRole("button", { name: "Add" }).click();

    // Scoped to `div.py-12` — the exact wrapper class RecurringRow renders
    // for one row (see recurring/page.tsx) — rather than a bare `div` filter,
    // which would just as happily match a large ancestor container (e.g. the
    // whole page body) whose FIRST descendant <img>/<svg> has nothing to do
    // with this specific row.
    const netflixRow = page.locator("div.py-12", { hasText: "Netflix" }).first();
    await expect(netflixRow.locator("img")).toBeVisible();

    // A name nothing in the table matches — the plain bucket glyph (svg icon,
    // no <img>) must still render, never a broken image.
    await page.getByLabel("Name").fill("Some Totally Unknown Merchant Co");
    await page.getByLabel("Amount", { exact: false }).fill("199");
    await page.locator("#rec-account").selectOption({ label: "Test Bank · Logo Test Acct" });
    await page.locator("#rec-category").selectOption({ label: "Logo Test Category" });
    await page.getByRole("button", { name: "Add" }).click();

    const unknownRow = page.locator("div.py-12", { hasText: "Some Totally Unknown Merchant Co" }).first();
    await expect(unknownRow.locator("svg").first()).toBeVisible();
    await expect(unknownRow.locator("img")).toHaveCount(0);
  });
});
