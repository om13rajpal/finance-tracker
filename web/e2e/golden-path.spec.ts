import { test, expect, type BrowserContext } from "@playwright/test";
import { MongoClient, ObjectId } from "mongodb";
import jwt from "jsonwebtoken";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// Reads MONGO_URI and JWT_SECRET from the API's own .env, the same file the running
// dev API is using, so this test's login bypass and the API's own JWT verification
// are always working from the same secret.
loadEnv({ path: resolve(__dirname, "../../api/.env") });

const TEST_EMAIL = "e2e-golden-path@example.com";
// Fixed, not regenerated per run, so repeated runs upsert the same user rather than
// growing the users collection, matching this suite's existing repeatable-run design
// (see the afterEach cleanup below for the same reasoning applied to the data it creates).
const TEST_USER_ID = new ObjectId("000000000000000000000001");

// Logs the browser context in as TEST_USER_ID without going through the OTP email
// flow: upserts a matching User document directly in Mongo, signs a session JWT
// with the API's own JWT_SECRET (the exact same way auth.service.ts's verifyOtp
// does), and sets it as the session cookie. This is the same technique used
// throughout this project's manual Playwright verification during development;
// it does not require, and this app no longer has, any test-only backend endpoint.
async function loginAsTestUser(context: BrowserContext): Promise<void> {
  const mongoUri = process.env.MONGO_URI;
  const jwtSecret = process.env.JWT_SECRET;
  if (!mongoUri || !jwtSecret) {
    throw new Error(
      "MONGO_URI and JWT_SECRET must be set (read from api/.env) to run this test."
    );
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
    {
      name: "token",
      value: token,
      url: "http://localhost:3000",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

// This suite is silent on cleanup, but the app only supports a single fixed
// ALLOWED_LOGIN_EMAIL user (auth.service.ts's requestOtp rejects any other
// email), so every run of this test logs in as the exact same user against
// the dev database (docker-compose's mongo-data volume persists across
// restarts). Without cleanup, a second run would find "Main Savings" /
// "Dining Out" already present, breaking the getByText/getByLabel strict-mode
// assertions below and inflating net worth. This best-effort afterEach deletes
// what the test created via the same authenticated browser-context requests
// the page itself makes, so the golden path can be re-run repeatedly.
test.afterEach(async ({ page }) => {
  try {
    const accounts = await page.request.get("/api/accounts").then((r) => r.json());
    for (const a of accounts.filter((a: { nickname: string }) => a.nickname === "Main Savings")) {
      await page.request.delete(`/api/accounts/${a._id}`);
    }
  } catch {
    // best-effort: don't fail the test run over cleanup
  }

  try {
    const categories = await page.request.get("/api/categories").then((r) => r.json());
    for (const c of categories.filter((c: { name: string }) => c.name === "Dining Out")) {
      await page.request.delete(`/api/categories/${c._id}`);
    }
  } catch {
    // best-effort
  }

  try {
    const txPage = await page.request.get("/api/transactions").then((r) => r.json());
    for (const t of (txPage.items ?? []).filter(
      (t: { merchant?: string }) => t.merchant === "Test Cafe"
    )) {
      await page.request.delete(`/api/transactions/${t._id}`);
    }
  } catch {
    // best-effort
  }
});

test("an unauthenticated visitor is redirected to /login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("golden path: login, add account, add category, add transaction, see net worth", async ({ page }) => {
  await loginAsTestUser(page.context());

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/accounts");
  await page.getByLabel("Institution").fill("Test Bank");
  await page.getByLabel("Nickname").fill("Main Savings");
  await page.getByLabel("Starting Balance").fill("10000");
  await page.getByRole("button", { name: "Add Account" }).click();
  // exact: true, since the accounts list also renders an sr-only label "Update
  // balance for Main Savings" on the same row, which a substring match on
  // "Main Savings" would also match, tripping Playwright's strict mode.
  await expect(page.getByText("Main Savings", { exact: true })).toBeVisible();

  await page.goto("/budgets");
  await page.getByLabel("Name").fill("Dining Out");
  await page.getByLabel(/Bucket/).selectOption("guilt_free");
  await page.getByLabel("Monthly Budget").fill("5000");
  await page.getByRole("button", { name: "Add Category" }).click();
  // Scoped to the category-list row's <span>: a plain getByText("Dining Out")
  // also matches the newly created category's own <option> in the "Parent
  // Category" select on this same page, tripping Playwright's strict mode.
  await expect(page.locator("span.font-medium", { hasText: "Dining Out" })).toBeVisible();

  await page.goto("/transactions");
  // id-based, not getByLabel: the <select> is nested inside its <label> (as
  // are all form selects on this page), so its computed accessible name is
  // "<label text><concatenated option text>", e.g. tx-account's name becomes
  // "AccountSelect accountTest Bank · Main Savings" once an option is
  // present. The page also has a second, differently-labeled "Import
  // Account" select for CSV import, whose computed name likewise contains
  // the substring "Account". getByLabel("Account") therefore always resolves
  // to both selects here, a real DOM property of this page rather than a
  // naming choice this test can route around, so these two fields are
  // targeted by their stable ids.
  await page.locator("#tx-account").selectOption({ label: "Test Bank · Main Savings" });
  await page.locator("#tx-category").selectOption({ label: "Dining Out" });
  await page.getByLabel(/Amount/).fill("-500");
  await page.getByLabel("Merchant").fill("Test Cafe");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Test Cafe")).toBeVisible();

  await page.goto("/dashboard");
  // Scoped to the Net Worth figure itself. The panel now also prints what net
  // worth is made of ("in accounts", "in holdings", "owed on cards"), so with a
  // single account the same string could legitimately appear twice on the
  // screen and an unscoped getByText trips strict mode. The assertion this
  // step is actually making is about the total.
  //
  // ₹9,500, not ₹10,000: creating a transaction now applies its amount as a
  // delta to the linked account's stored balance (₹10,000 starting balance -
  // ₹500 expense above), so it's correctly reflected here instead of silently
  // drifting from reality the way it used to before that balance-delta wiring
  // existed. A stale ₹10,000 expectation here would mean this golden path was
  // still exercising the exact double-counting/drift bug that fix corrects.
  await expect(page.locator("#net-worth-figure")).toHaveText(/₹9,500|₹9500/);
});
