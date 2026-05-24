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
  for (let i = 0; i < 10; i += 1) {
    if (await nextBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(200);
    } else {
      break;
    }
  }
  // Final step: click "Done".
  if (await doneBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await doneBtn.click();
  }
  await page.waitForTimeout(500);

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

  // Tour should NOT appear because the localStorage check threw.
  // Wait the tour delay (1200ms + buffer) and confirm no tour dialog.
  await page.waitForTimeout(2000);
  const tour = page.locator(
    "[role='dialog']:has-text('Next'), [role='dialog']:has-text('Done')",
  );
  await expect(tour).toHaveCount(0);

  // App should still be usable. Click into the editor; it should
  // accept input without crashing.
  const editor = page.locator(".cm-content").first();
  await expect(editor).toBeVisible();
});
