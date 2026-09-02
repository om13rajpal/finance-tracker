import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { MongoClient, ObjectId } from "mongodb";
import jwt from "jsonwebtoken";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

/**
 * The nine authenticated screens.
 *
 * These lock the things that are easy to break silently and impossible to see
 * in a diff: the taxonomy discipline ("chips never guess"), the rule that an
 * unknown figure renders as a dash rather than a fabricated ₹0, the empty
 * states, the per-panel error degradation, and the mobile sheet.
 *
 * Fixtures are created through the REAL API as a dedicated user, so they obey
 * the same validation and side effects the UI does, and are torn down at the
 * end, so this file can be run repeatedly against the dev database.
 */

loadEnv({ path: resolve(__dirname, "../../api/.env") });

const USER_ID = new ObjectId("00000000000000000000fe01");
const EMPTY_USER_ID = new ObjectId("00000000000000000000fe02");
const EMAIL = "e2e-app-screens@example.com";
const EMPTY_EMAIL = "e2e-app-screens-empty@example.com";

const COLLECTIONS = [
  "accounts",
  "categories",
  "transactions",
  "pendingtransactions",
  "recurringtransactions",
  "goals",
  "categorizationrules",
  "balancesnapshots",
];

function requireEnv(): { mongoUri: string; jwtSecret: string } {
  const mongoUri = process.env.MONGO_URI;
  const jwtSecret = process.env.JWT_SECRET;
  if (!mongoUri || !jwtSecret) {
    throw new Error("MONGO_URI and JWT_SECRET must be set (read from api/.env).");
  }
  return { mongoUri, jwtSecret };
}

async function withMongo<T>(fn: (client: MongoClient) => Promise<T>): Promise<T> {
  const { mongoUri } = requireEnv();
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.close();
  }
}

/**
 * Signs a session cookie directly, the same way `verifyOtp` does. The app has
 * no test-only endpoint and should not grow one.
 */
async function signIn(context: BrowserContext, userId: ObjectId, email: string): Promise<void> {
  const { jwtSecret } = requireEnv();
  await withMongo(async (client) => {
    await client
      .db()
      .collection("users")
      .updateOne({ _id: userId }, { $set: { email, createdAt: new Date() } }, { upsert: true });
  });
  await context.addCookies([
    {
      name: "token",
      value: jwt.sign({ userId: userId.toString() }, jwtSecret),
      url: "http://localhost:3000",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

/** The API's month is a UTC month: build fixture dates inside the same one. */
function dayInApiMonth(day: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 10)).toISOString();
}

function dayNextMonth(day: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day, 10)).toISOString();
}

interface Fixture {
  accountId: string;
  guiltFreeCategoryId: string;
  fixedCategoryId: string;
}

async function seed(page: Page): Promise<Fixture> {
  const post = async (path: string, body: unknown) => {
    const res = await page.request.post(`/api${path}`, { data: body });
    expect(res.ok(), `${path} -> ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  };

  const account = await post("/accounts", {
    type: "bank",
    institution: "HDFC Bank",
    nickname: "E2E Salary",
    currentBalance: 100000,
  });

  // A guilt-free category deliberately budgeted BELOW what gets spent, so the
  // over-budget row (bar clamped to 100%, ink wall, overage named in words)
  // is exercised rather than assumed.
  const guiltFree = await post("/categories", {
    name: "E2E Eating out",
    type: "expense",
    bucket: "guilt_free",
    budgetLimit: 1000,
  });
  const fixed = await post("/categories", {
    name: "E2E Rent",
    type: "expense",
    bucket: "fixed_costs",
    budgetLimit: 20000,
  });

  await post("/transactions", {
    accountId: account._id,
    categoryId: guiltFree._id,
    amount: -1500,
    date: dayInApiMonth(2),
    merchant: "E2E Cafe",
    force: true,
  });
  await post("/transactions", {
    accountId: account._id,
    categoryId: fixed._id,
    amount: -12000,
    date: dayInApiMonth(3),
    merchant: "E2E Landlord",
    force: true,
  });
  // Uncategorised on purpose: this is the parser's normal output and the state
  // the hollow dashed chip exists for.
  await post("/transactions", {
    accountId: account._id,
    amount: -640,
    date: dayInApiMonth(4),
    merchant: "E2E Unknown Merchant",
    force: true,
  });

  await post("/recurring", {
    name: "E2E Rent standing order",
    type: "expense",
    amount: 12000,
    frequency: "monthly",
    nextDueDate: dayNextMonth(1),
    accountId: account._id,
    categoryId: fixed._id,
  });

  await post("/goals", { name: "E2E Emergency fund", targetAmount: 100000, currentAmount: 25000 });

  await post("/categorization-rules", {
    matchField: "merchant",
    matchType: "contains",
    matchValue: "E2E Cafe",
    categoryId: guiltFree._id,
  });

  return {
    accountId: account._id,
    guiltFreeCategoryId: guiltFree._id,
    fixedCategoryId: fixed._id,
  };
}

test.describe("the authenticated app", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page.context(), USER_ID, EMAIL);
  });

  test.afterAll(async () => {
    await withMongo(async (client) => {
      for (const name of COLLECTIONS) {
        await client.db().collection(name).deleteMany({ userId: USER_ID.toString() });
        await client.db().collection(name).deleteMany({ userId: EMPTY_USER_ID.toString() });
      }
    });
  });

  test("every route renders its own screen inside the shell", async ({ page }) => {
    const routes: [string, string][] = [
      ["/dashboard", "Overview"],
      ["/transactions", "Transactions"],
      ["/accounts", "Accounts"],
      ["/budgets", "Budgets"],
      ["/recurring", "Recurring"],
      ["/investments", "Investments"],
      ["/goals", "Goals"],
      ["/tax", "Tax"],
      ["/settings", "Settings"],
    ];

    for (const [route, navLabel] of routes) {
      await page.goto(route);
      // The rail is present on every screen and marks where you are.
      const current = page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
        name: navLabel,
        exact: true,
      });
      await expect(current).toHaveAttribute("aria-current", "page");
      // And the taxonomy legend is furniture: stated once, everywhere.
      await expect(page.getByText("§ Sorted into").first()).toBeVisible();
    }
  });

  test("chips never guess: an uncategorised row is an action, not a colour", async ({ page }) => {
    await seed(page);
    await page.goto("/transactions");

    const row = page
      .locator("div")
      .filter({ hasText: /^E2E Unknown Merchant/ })
      .first();
    await expect(row).toBeVisible();

    // The chip announces itself as not-yet-known rather than picking a bucket.
    await expect(page.getByRole("img", { name: "Not categorised yet" }).first()).toBeVisible();
    // And the category slot is the affordance that fixes it.
    await expect(page.getByRole("button", { name: "Categorise" }).first()).toBeVisible();

    // A categorised row gets its bucket, resolved from the category tree.
    await expect(page.getByRole("img", { name: "Guilt-free" }).first()).toBeVisible();
    await expect(page.getByRole("img", { name: "Fixed costs" }).first()).toBeVisible();
  });

  test("an over-budget row names the overage in words", async ({ page }) => {
    await seed(page);
    await page.goto("/dashboard");
    // ₹1,500 spent against a ₹1,000 limit.
    await expect(page.getByText(/Over by ₹500/).first()).toBeVisible();
    // The bar cannot say how far past, so it is labelled instead.
    await expect(
      page.getByRole("img", { name: /E2E Eating out.*over by ₹500/i }).first()
    ).toBeVisible();
  });

  test("an unknown figure is a dash, never a fabricated zero", async ({ page }) => {
    await seed(page);
    // Only the dashboard read fails; the shell and every other panel are fine.
    await page.route("**/api/dashboard**", (r) => r.abort("failed"));
    await page.goto("/dashboard");

    await expect(page.getByText("Could not load dashboard data.")).toBeVisible({ timeout: 20000 });
    // The figure a person makes decisions on must not be invented.
    await expect(page.locator("#net-worth-figure")).toHaveText("–");
    await expect(page.locator("#net-worth-figure")).not.toHaveText(/₹0/);
    // And "no budgets set yet" would be a lie, not an empty state.
    await expect(page.getByText("No budgets set yet.")).toHaveCount(0);
  });

  test("a screen with nothing on it explains what to do next", async ({ page, context }) => {
    await signIn(context, EMPTY_USER_ID, EMPTY_EMAIL);
    await page.goto("/dashboard");
    await expect(page.getByText("No budgets set yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Set a budget" })).toBeVisible();

    await page.goto("/accounts");
    await expect(page.getByText("No accounts yet.")).toBeVisible();

    await page.goto("/goals");
    await expect(page.getByText("No goals yet.")).toBeVisible();

    await page.goto("/investments");
    await expect(page.getByText("No open holdings.")).toBeVisible();
  });

  test("a failed read degrades panel by panel, never the whole screen", async ({ page }) => {
    await page.route("**/api/categorization-rules**", (r) => r.abort("failed"));
    await page.goto("/settings");

    await expect(page.getByText("Could not load your filing rules.")).toBeVisible({
      timeout: 20000,
    });
    // The rest of the screen is untouched.
    await expect(page.getByText("§ Your inbox")).toBeVisible();
    await expect(page.getByText("§ Your data")).toBeVisible();
  });

  test("on a phone the rail becomes a sheet, and Escape closes it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");

    const sheet = page.locator("#app-nav-sheet");
    // Present in the DOM but off-canvas, so no focus trap and no layout shift.
    await expect(sheet).toHaveClass(/-translate-x-full/);

    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(sheet).toHaveClass(/translate-x-0/);
    await expect(sheet.getByRole("link", { name: "Transactions", exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveClass(/-translate-x-full/);
    // Focus returns to the control that opened it.
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
  });

  test("the money column is tabular, so a ledger stays scannable", async ({ page }) => {
    await seed(page);
    await page.goto("/transactions");
    const amount = page.locator(".money").first();
    await expect(amount).toHaveCSS("font-variant-numeric", "tabular-nums");
  });

  test("no shadow anywhere except the stamp under a button", async ({ page }) => {
    await seed(page);
    await page.goto("/dashboard");
    const offenders = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const shadow = getComputedStyle(el).boxShadow;
        if (!shadow || shadow === "none") continue;
        // The one permitted shadow is a flat 2px ink offset with no blur and
        // no spread: a stamp, not a lift.
        const flat = /rgba?\([^)]*\)\s+0px\s+[02]px\s+0px\s+0px/.test(shadow);
        if (!flat) bad.push(`${el.tagName}.${(el as HTMLElement).className} :: ${shadow}`);
      }
      return bad;
    });
    expect(offenders).toEqual([]);
  });
});
