import { test, expect } from "@playwright/test";

test.describe("Focus Mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("lumen-tour-done", "1");
      localStorage.removeItem("lumen-md");
    });
    await page.goto("/");
    await page.locator("header").first().waitFor({ state: "visible", timeout: 5000 });
  });

  test("toggles focus mode via Cmd+Shift+F shortcut", async ({ page }) => {
    // FocusMode is a portal that mounts only when `active === true`.
    // Its exit affordance carries the title "Exit Focus Mode (Esc)" — we
    // assert presence/absence of that title to detect the mode change.
    const exitBar = page.locator('[title="Exit Focus Mode (Esc)"]');

    // Off initially.
    await expect(exitBar).toHaveCount(0);

    // ⌘⇧F enters focus mode.
    await page.keyboard.press("Meta+Shift+F");
    await expect(exitBar).toBeVisible({ timeout: 3000 });

    // ⌘⇧F again toggles back off.
    await page.keyboard.press("Meta+Shift+F");
    await expect(exitBar).toHaveCount(0, { timeout: 3000 });
  });
});
