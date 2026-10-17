import { test, expect } from "@playwright/test";

/**
 * First-run user journey: simulate a completely fresh user who has
 * never opened Lumen before. Don't set lumen-tour-done. The tour
 * popup should appear after a short delay (1200ms per App.tsx),
 * and the user should be able to click through it, then edit + save
 * their first doc.
 *
 * This catches UX bugs in the new-user path that the rest of the
 * e2e suite skips by setting lumen-tour-done=1 in beforeEach.
 */

test.beforeEach(async ({ page }) => {
  // Intentionally do NOT seed lumen-tour-done. We want the tour.
  await page.addInitScript(() => {
    // Clear any persisted state so this is a true fresh-user run.
    localStorage.clear();
  });
  await page.goto("/");
  await page
    .locator("header")
    .first()
    .waitFor({ state: "visible", timeout: 5000 });
});

test("fresh user can click through every tour step and lands on a usable editor", async ({
  page,
}) => {
  // Tour fires on a setTimeout(1200) after first render. The tour is
  // plain <div>s — not role=dialog — so we anchor on the unique
  // "→ Next" or "✓ Done" button text.
  const nextBtn = page.locator("button:has-text('→ Next')").first();
  const doneBtn = page.locator("button:has-text('✓ Done')").first();
  await Promise.race([
    nextBtn.waitFor({ state: "visible", timeout: 5000 }),
    doneBtn.waitFor({ state: "visible", timeout: 5000 }),
  ]);

  // Click "Next" until "Done" replaces it. The viewport-clamp fix in
  // OnboardingTour.tsx (round-21 bug closure) ensures the tooltip
  // stays inside the viewport on every step. Cap at 10 iterations
  // (the tour has 5 steps; +5 for safety).
  // The tour shows a "n / N" counter; every "Next" must advance it.
  const counter = page.getByText(/^\s*\d+ \/ \d+\s*$/).first();
  await expect(counter).toBeVisible({ timeout: 3000 });
  const [, total] = /(\d+) \/ (\d+)/.exec((await counter.textContent()) ?? "")!.slice(1).map(Number);
  for (let step = 1; step < total; step += 1) {
    await expect(counter).toHaveText(new RegExp(`^\\s*${step} / ${total}\\s*$`));
    await expect(nextBtn).toBeVisible({ timeout: 2000 });
    await nextBtn.click();
    await expect(counter).toHaveText(new RegExp(`^\\s*${step + 1} / ${total}\\s*$`), { timeout: 3000 });
  }
  // Final step: click "Done".
  await expect(doneBtn).toBeVisible({ timeout: 3000 });
  await doneBtn.click();
  await expect(doneBtn).toBeHidden({ timeout: 3000 });
  await page.waitForFunction(() => localStorage.getItem("lumen-tour-done") === "1", null, { timeout: 5000 });

  // The lumen-tour-done flag should be set now.
  const tourDoneFlag = await page.evaluate(() =>
    localStorage.getItem("lumen-tour-done"),
  );
  expect(tourDoneFlag).toBe("1");

  // Editor should be reachable; typing should work.
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill("# My first Lumen doc\n\nHello world!");
  // Preview pane should reflect the heading.
  await expect(
    page.locator(".markdown-preview h1, [data-preview-root] h1").first(),
  ).toBeVisible({ timeout: 5000 });
});

test("a fresh user who never sees the tour (tour blocked by storage) still gets a usable editor", async ({
  page,
}) => {
  // Some browsers / private-mode contexts block localStorage; the
  // tour code wraps its lookup in try/catch and silently skips when
  // storage is denied. Simulate this by overriding localStorage.
  await page.addInitScript(() => {
    const oldStorage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException(
          "Storage denied for testing",
          "SecurityError",
        );
      },
    });
    // Allow the test to recover localStorage if it needs it later.
    (window as unknown as { __origStorage: Storage }).__origStorage =
      oldStorage;
  });
  await page.goto("/");
  await page
    .locator("header")
    .first()
    .waitFor({ state: "visible", timeout: 5000 });

  // Tour should NOT appear because the localStorage check threw. The
  // tour is armed on a 1200 ms timer; let the page's own clock pass it
  // (deterministically, no sleeping) and confirm nothing opened.
  await page.waitForFunction(() => performance.now() > 1500, null, { timeout: 10_000 });
  await expect(page.locator("button:has-text('→ Next'), button:has-text('✓ Done')")).toHaveCount(0);

  // App should still be usable. Click into the editor; it should
  // accept input without crashing.
  const editor = page.locator(".cm-content").first();
  await expect(editor).toBeVisible();
});
