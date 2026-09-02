import { expect, test } from "@playwright/test";

/**
 * The landing page spends a far larger motion budget than the authenticated
 * app: three pinned ScrollTriggers, a horizontal scroll-jack, a scrubbed
 * twelve-row sort, a flickering board, a custom cursor and magnetic hover.
 *
 * These tests exist so that budget can never quietly become a dependency. Every
 * one of them asserts the same thing from a different angle: the page is a
 * finished, readable, navigable document before a single tween runs.
 */

const BUCKET_NAMES = ["Fixed costs", "Investments", "Savings", "Guilt-free"];

test.describe("landing", () => {
  test("is complete and readable with JavaScript disabled", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto("/");

    // GSAP only ever sets a pre-animation state from inside an effect, so with
    // no JS the markup is already the final frame of every section.
    for (const copy of [
      "Sorted.",
      "left to spend",
      "Watch it work.",
      "You never type a transaction.",
      "Six things, done properly.",
      "One person. One ledger.",
    ]) {
      await expect(page.getByText(copy, { exact: false }).first()).toBeVisible();
    }

    // Real amounts, real merchants, en-IN grouping: present in the HTML, not
    // fetched and not animated into existence.
    await expect(page.getByText("Parag Parikh Flexi Cap").first()).toBeVisible();
    await expect(page.getByText("₹18,240").first()).toBeVisible();

    // The figure appears TWICE and that is deliberate: the hero states it as a
    // claim, the payoff section arrives at it ten screens later having shown
    // the sort. Promise, then proof.
    //
    // What the original version of this assertion was really guarding was not
    // the count: it was CO-VISIBILITY. The rail's guilt-free room used to
    // print it a few hundred pixels above the payoff, so on a phone both sat in
    // one viewport and, the payoff being mid-scramble at that moment, the two
    // disagreed by a rupee. That is what read as a bug. So the rule is stated
    // as what it actually is: never two printings within one screen of each
    // other.
    const figures = page.getByText("₹18,240");
    await expect(figures).toHaveCount(2);
    const boxes = await figures.all();
    const ys: number[] = [];
    for (const f of boxes) ys.push((await f.boundingBox())!.y);
    expect(Math.abs(ys[1] - ys[0])).toBeGreaterThan(2000);

    await ctx.close();
  });

  test("no page-internal design-system language reaches the visitor", async ({ page }) => {
    await page.goto("/");
    const body = await page.locator("body").innerText();

    // The rooms and the sort lanes label themselves with `BucketMeta.name`.
    // `BucketMeta.key` is the API's enum value and renders as one: `GUILT_FREE`,
    // underscore and all. Two of the four survive the mistake as single words,
    // so assert on the two that do not.
    expect(body).toContain("FIXED COSTS");
    expect(body).toContain("GUILT-FREE");
    expect(body).not.toMatch(/FIXED_COSTS|GUILT_FREE/);

    // Each room used to print its own measured ink-on-fill contrast ratio in the
    // corner. That is a WCAG audit note from a design round; it belongs in
    // data.ts as a comment, not on a panel a visitor is standing on.
    expect(body).not.toMatch(/ink on fill/i);
    expect(body).not.toMatch(/\d\.\d+:1/);

    // The `§ NN` numbering device stays; the internal art-direction spine
    // labels behind it do not.
    //
    // SCOPED TO THE EYEBROWS, not the whole body. The first version matched
    // /THE DOOR/i anywhere on the page and started failing the moment a section
    // was legitimately headlined "It splits at the door": the test was
    // policing an English phrase when what it cares about is a LABEL SHAPE.
    expect(body).toContain("§");
    const eyebrows = await page.evaluate(() =>
      [...document.querySelectorAll("p, span")]
        .map((el) => el.textContent?.trim() ?? "")
        .filter((t) => /^§\s*\d/.test(t)),
    );
    expect(eyebrows.length).toBeGreaterThan(0);
    for (const brow of eyebrows) {
      expect(brow).not.toMatch(/the payoff|the door|the parser|the sort$/i);
    }
  });

  test("the page does not open and close on the same sentence", async ({ page }) => {
    await page.goto("/");
    const body = await page.locator("body").innerText();

    // The head carried "Sorted · personal finance, India" and the foot carried
    // "Sorted · private personal finance, India": near-identical strips of
    // mono micro-type at opposite ends, which is what made the two read as
    // duplicates of each other. The giant SORTED. is the wordmark; a caption
    // for it is noise at either end.
    expect(body).not.toMatch(/personal finance, India/i);

    // Implementation trivia dressed as a credential, and a description of the
    // sign-in mechanism aimed at someone who has not signed in.
    expect(body).not.toMatch(/lakh & crore grouping/i);
    expect(body).not.toMatch(/one allowed address/i);

    // "Sorted" should now appear as the wordmark and in running prose, never
    // as a repeated chrome label. Two headings, not two headings plus two
    // strips.
    const wordmarks = page.locator("h1, h2").filter({ hasText: /^Sorted\.$/ });
    await expect(wordmarks).toHaveCount(2);
  });

  test("the twelve sort rows all render, in their lanes, without JavaScript", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto("/");

    // The markup IS the finished diagram: twelve rows already sitting in the
    // four lanes they belong to. The scrub animates them FROM a stack, it does
    // not deliver them.
    const rows = page.locator("[data-sort-row]");
    await expect(rows).toHaveCount(12);
    for (let i = 0; i < 12; i += 1) {
      await expect(rows.nth(i)).toBeVisible();
    }

    // The lane totals are the real sums, already printed.
    for (const total of ["₹45,947", "₹45,000", "₹17,500", "₹3,019"]) {
      await expect(page.getByText(total, { exact: false }).first()).toBeVisible();
    }

    await ctx.close();
  });

  test("the split diagram is complete and to scale without JavaScript", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto("/");

    // Four ribbons, four vessels, four levels: all in the markup at their
    // final values, so with no JS the diagram is simply already poured.
    await expect(page.locator(".l-rib")).toHaveCount(4);
    await expect(page.locator(".l-lvl")).toHaveCount(4);

    for (const name of BUCKET_NAMES) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }

    // DRAWN TO SCALE is the section's whole claim, and a ribbon is geometry
    // rather than a box, so assert it on the path data. Each ribbon starts at
    // its share's x-offset along the incoming bar; fixed costs takes 44.56% of
    // 1000 units and investments starts exactly there.
    const starts = await page.evaluate(() =>
      [...document.querySelectorAll(".l-rib")].map((el) =>
        parseFloat((el.getAttribute("d") ?? "").replace(/^M/, "").split(",")[0]),
      ),
    );
    expect(starts[0]).toBeCloseTo(0, 1);
    expect(starts[1]).toBeCloseTo(445.6, 0);
    expect(starts[2]).toBeCloseTo(754.6, 0);
    expect(starts[3]).toBeCloseTo(874.8, 0);

    await ctx.close();
  });

  test("the guilt-free figure is never printed twice within one screen", async ({ page }) => {
    await page.goto("/");
    // The split's guilt-free caption deliberately defers to the payoff section
    // directly below it, which sets the same number at 340px. On a phone the
    // two would share a viewport, and the payoff is mid-scramble at that
    // moment, so they would disagree by a rupee and read as a bug.
    const figures = page.getByText("₹18,240");
    const boxes = await figures.all();
    const ys: number[] = [];
    for (const f of boxes) ys.push((await f.boundingBox())!.y);
    ys.sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThan(1200);
    }
  });

  test("under prefers-reduced-motion nothing is left hidden", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(900);

    // Reduced motion must mean "no movement", never "content that never
    // arrives". Every element the choreography would have animated has to be
    // sitting at its final frame already.
    const faded = await page.evaluate(() => {
      const out: string[] = [];
      for (const sel of [
        ".l-hero-line",
        ".l-hero-say",
        ".l-hero-figure",
        ".l-sort-say",
        ".l-row",
        ".l-lane-fill",
        ".l-figure",
        ".l-gf-outline",
        ".l-cap",
        // The capability titles are revealed out of their own clip rather than
        // faded, so a broken reveal would leave them at full opacity but
        // translated out of the mask. Opacity alone cannot catch that; the
        // visibility check below is what guards it.
        ".cap-title",
        ".l-close-word",
        ".l-tether-long",
      ]) {
        document.querySelectorAll(sel).forEach((el) => {
          if (parseFloat(getComputedStyle(el).opacity) < 0.99) out.push(sel);
        });
      }
      return out;
    });
    expect(faded).toEqual([]);

    // A masked reveal fails differently from a fade: the element keeps full
    // opacity and is simply pushed outside its own clip, so it reads as an
    // empty rule where a heading should be. Assert the six titles are actually
    // on screen, not merely "not transparent".
    const titles = page.locator(".cap-title");
    await expect(titles).toHaveCount(6);
    for (let i = 0; i < 6; i++) await expect(titles.nth(i)).toBeVisible();

    // No pin means no pin-spacer: the scroll-jack must not have been built.
    const pinned = await page.locator(".pin-spacer").count();
    expect(pinned).toBe(0);

    await ctx.close();
  });

  test("the hero board renders in full without JavaScript", async ({ browser }) => {
    // The board is the hero's ground and it is REAL DATA: every glyph is a
    // character of a bank alert. It ships in the markup, so with no JS the grid
    // renders complete and simply holds still.
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page.locator(".l-cell")).toHaveCount(420);
    await expect(page.locator(".l-cell").first()).toBeVisible();
    await ctx.close();
  });

  test("the board does not flicker under prefers-reduced-motion", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/", { waitUntil: "networkidle" });

    const read = () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".l-cell")].map((c) => c.textContent).join(""),
      );
    const first = await read();
    await page.waitForTimeout(1400);
    expect(await read()).toBe(first);
    await ctx.close();
  });

  test("the board does flicker when motion is allowed", async ({ page }) => {
    // The positive control for the test above: otherwise a board that never
    // animated at all would pass it silently.
    await page.goto("/", { waitUntil: "networkidle" });
    const read = () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".l-cell")].map((c) => c.textContent).join(""),
      );
    const first = await read();
    await page.waitForTimeout(1600);
    expect(await read()).not.toBe(first);
  });

  test("a reload starts at the top, not wherever you left off", async ({ page }) => {
    // Browsers restore the previous scroll offset on reload. Here that dropped
    // the visitor into the middle of the pinned sort section, and worse, the
    // restore lands BEFORE ScrollTrigger builds its pins, so every pin then
    // measures against an already-scrolled document.
    await page.goto("/", { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo(0, 6000));
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(10);

    // And the hero is what you are actually looking at.
    await expect(page.locator(".l-hero-line")).toBeInViewport();
  });

  test("both calls to action reach the login screen", async ({ page }) => {
    await page.goto("/");
    const ctas = page.getByRole("link", { name: "Sign in", exact: true });
    await expect(ctas).toHaveCount(2);

    await ctas.first().click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sorted." })).toBeVisible();
  });

  test("the capability rows are real links and take keyboard focus", async ({ page }) => {
    await page.goto("/");
    // Row-scale hover is only legitimate if the same state is reachable by
    // keyboard. These are anchors, not tabindexed divs.
    const row = page.getByRole("link", { name: /FIFO cost basis/ });
    await expect(row).toHaveCount(1);
    await row.focus();
    await expect(row).toBeFocused();
  });
});
