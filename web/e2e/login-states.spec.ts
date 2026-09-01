import { expect, test, type Page } from "@playwright/test";

/**
 * Login — every state the real API can put the user in.
 *
 * The network is stubbed so each branch is exercised deterministically, but the
 * shapes are copied from the real server, not invented:
 *
 *   200 { ok: true }                        auth.routes.ts
 *   400 { error: "Validation failed" }      zod, via errorHandler.ts
 *   401 { error: "Invalid or expired code" } auth.service.ts verifyOtp
 *   403 { error: "Email not allowed" }      auth.service.ts requestOtp
 *   429 text/plain                          express-rate-limit's DEFAULT body —
 *                                           deliberately NOT json, which is why
 *                                           the client branches on status
 *   500 { error: "<resend message>" }       mail send failure
 */

const EMAIL = "omrajpal.exe@gmail.com";

async function gotoLogin(page: Page) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sorted." })).toBeVisible();
}

async function submitEmail(page: Page) {
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByRole("button", { name: "Send code" }).click();
}

/**
 * A session that only exists once the code has been verified.
 *
 * The login page asks /auth/me on mount to bounce anyone already signed in, and
 * /dashboard asks it again through ProtectedLayout. Stubbing it to 200 up front
 * would redirect us off the login screen before the test began; leaving it
 * unstubbed makes the test depend on whether the real API happens to be running
 * — with the API up, the post-verify redirect correctly bounces straight back
 * to /login because the stubbed verify never set a real cookie.
 *
 * So: 401 until verify succeeds, 200 afterwards.
 */
async function stubSession(page: Page) {
  let signedIn = false;

  await page.route("**/auth/me", (r) =>
    signedIn
      ? r.fulfill({ status: 200, contentType: "application/json", body: `{"email":"${EMAIL}"}` })
      : r.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Not authenticated"}' }),
  );

  await page.route("**/auth/otp/request", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
  );

  return {
    onVerify(handler: (body: { email: string; code: string }) => void = () => {}) {
      return page.route("**/auth/otp/verify", async (r) => {
        handler(JSON.parse(r.request().postData() ?? "{}"));
        signedIn = true;
        await r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      });
    },
  };
}

test.describe("login states", () => {
  test("the hero renders without JavaScript", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto("/login");

    // Static fallback is mandatory: the constellation is the final frame, and
    // GSAP only ever layers an entrance on top of it.
    await expect(page.locator("svg[role=img]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sorted." })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await ctx.close();
  });

  test("happy path: code requested, verified, redirected", async ({ page }) => {
    const session = await stubSession(page);
    await session.onVerify();

    await gotoLogin(page);
    await submitEmail(page);

    await expect(page.getByRole("heading", { name: "Six digits." })).toBeVisible();
    await expect(page.getByText(EMAIL)).toBeVisible();

    await page.getByLabel("Code").fill("123456");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("rate limit: 429 with a plain-text body still reads correctly", async ({ page }) => {
    await page.route("**/auth/otp/request", (r) =>
      r.fulfill({
        status: 429,
        contentType: "text/plain",
        body: "Too many requests, please try again later.",
      }),
    );

    await gotoLogin(page);
    await submitEmail(page);

    const alert = page.getByTestId("login-error");
    await expect(alert).toContainText("Too many attempts");
    // The real numbers, and the fact that code checks share the budget.
    await expect(alert).toContainText("30 requests per 15 minutes");
    // NOT the useless fallback the raw client would have produced.
    await expect(alert).not.toContainText("Request failed");
  });

  test("403: the address is not the allowed one", async ({ page }) => {
    await page.route("**/auth/otp/request", (r) =>
      r.fulfill({ status: 403, contentType: "application/json", body: '{"error":"Email not allowed"}' }),
    );

    await gotoLogin(page);
    await submitEmail(page);

    await expect(page.getByTestId("login-error")).toContainText("can't sign in here");
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  });

  test("500 on request surfaces the mail provider's own message", async ({ page }) => {
    await page.route("**/auth/otp/request", (r) =>
      r.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":"Resend refused the send"}',
      }),
    );

    await gotoLogin(page);
    await submitEmail(page);

    await expect(page.getByTestId("login-error")).toContainText("couldn't be emailed");
    await expect(page.getByTestId("login-error")).toContainText("Resend refused the send");
  });

  test("network failure is not shown as a raw fetch error", async ({ page }) => {
    await page.route("**/auth/otp/request", (r) => r.abort("failed"));

    await gotoLogin(page);
    await submitEmail(page);

    const alert = page.getByTestId("login-error");
    await expect(alert).toContainText("Couldn't reach the server");
    await expect(alert).not.toContainText("Failed to fetch");
  });

  test("401: a wrong code keeps the user on the code stage", async ({ page }) => {
    await page.route("**/auth/otp/request", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
    );
    await page.route("**/auth/otp/verify", (r) =>
      r.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"error":"Invalid or expired code"}',
      }),
    );

    await gotoLogin(page);
    await submitEmail(page);
    await page.getByLabel("Code").fill("000000");

    await expect(page.getByTestId("login-error")).toContainText("didn't work");
    await expect(page.getByRole("heading", { name: "Six digits." })).toBeVisible();
    await expect(page).not.toHaveURL(/\/dashboard/);
  });

  test("reload mid-flow resumes the code stage instead of resetting", async ({ page }) => {
    await page.route("**/auth/otp/request", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
    );

    await gotoLogin(page);
    await submitEmail(page);
    await expect(page.getByRole("heading", { name: "Six digits." })).toBeVisible();

    await page.reload();

    // The old implementation dropped back to an empty email field here, while a
    // perfectly good code sat in the inbox.
    await expect(page.getByRole("heading", { name: "Six digits." })).toBeVisible();
    await expect(page.getByText(EMAIL)).toBeVisible();
  });

  test("double-submit fires exactly one OTP request", async ({ page }) => {
    let hits = 0;
    await page.route("**/auth/otp/request", async (r) => {
      hits += 1;
      await new Promise((res) => setTimeout(res, 300));
      await r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });

    await gotoLogin(page);
    await page.getByLabel("Email").fill(EMAIL);

    // Three synchronous clicks inside a single tick — the actual race. Driving
    // this through the Playwright locator would instead re-resolve the button
    // between clicks, by which point the label has already changed to
    // "Sending…" and the test is measuring something else entirely.
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>('form button[type="submit"]');
      btn?.click();
      btn?.click();
      btn?.click();
    });

    await expect(page.getByRole("heading", { name: "Six digits." })).toBeVisible();
    expect(hits).toBe(1);
  });

  test("the busy button holds pressed and never dims", async ({ page }) => {
    await page.route("**/auth/otp/request", async (r) => {
      await new Promise((res) => setTimeout(res, 800));
      await r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });

    await gotoLogin(page);
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByRole("button", { name: "Send code" }).click();

    const busy = page.getByRole("button", { name: "Sending…" });
    await expect(busy).toHaveAttribute("aria-busy", "true");
    await expect(busy).toBeDisabled();

    // Dimming would drop cream-on-ink from 16.08:1 to ~4:1 at the exact moment
    // the label matters most. It holds itself pressed instead.
    const opacity = await busy.evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBe(1);
  });

  test("resend is not a button during the cooldown", async ({ page }) => {
    await page.route("**/auth/otp/request", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }),
    );

    await gotoLogin(page);
    await submitEmail(page);

    // You cannot double-submit an affordance that was never drawn.
    await expect(page.getByText(/New code in \d:\d\d/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send a new code" })).toHaveCount(0);
  });

  test("email is normalised once, and BOTH stages send the same address", async ({ page }) => {
    const sent: Record<string, string> = {};
    const session = await stubSession(page);
    await page.route("**/auth/otp/request", async (r) => {
      sent.request = JSON.parse(r.request().postData() ?? "{}").email;
      await r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });
    await session.onVerify((body) => {
      sent.verify = body.email;
    });

    await gotoLogin(page);
    await page.getByLabel("Email").fill("  OmRajpal.EXE@Gmail.com  ");
    await page.getByRole("button", { name: "Send code" }).click();
    await expect(page.getByRole("heading", { name: "Six digits." })).toBeVisible();
    await page.getByLabel("Code").fill("123456");
    await expect(page).toHaveURL(/\/dashboard/);

    // The server compares with === against ALLOWED_LOGIN_EMAIL, so the two
    // stages disagreeing is a silent "invalid code" that looks like a bad OTP.
    expect(sent.request).toBe(EMAIL);
    expect(sent.verify).toBe(EMAIL);
  });

  test("a pasted six-digit code fills and submits", async ({ page }) => {
    let verified = "";
    const session = await stubSession(page);
    await session.onVerify((body) => {
      verified = body.code;
    });

    await gotoLogin(page);
    await submitEmail(page);

    // A password manager or an OS autofill drops the whole value in at once,
    // and often with formatting. One real input handles this; six separate
    // boxes would not.
    await page.getByLabel("Code").fill("12 34-56");
    await expect(page).toHaveURL(/\/dashboard/);
    expect(verified).toBe("123456");
  });

  test("an already-authenticated visitor is sent to the dashboard", async ({ page }) => {
    await page.route("**/auth/me", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: '{"email":"' + EMAIL + '"}' }),
    );

    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("a hung request eventually fails instead of spinning forever", async ({ page }) => {
    test.setTimeout(60_000);
    // Never fulfilled. fetch() has no default timeout, so without the client
    // guard this button stays disabled and spinning indefinitely.
    await page.route("**/auth/otp/request", () => {});

    await gotoLogin(page);
    await submitEmail(page);

    await expect(page.getByTestId("login-error")).toContainText("took too long", {
      timeout: 30_000,
    });
    // And the form is usable again.
    await expect(page.getByRole("button", { name: "Send code" })).toBeEnabled();
  });
});
