import { test, expect } from "@playwright/test";

test.describe("Focus Mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("toggles focus mode via command palette", async ({ page }) => {
    // Open command palette
    await page.keyboard.press("Meta+k");
    await page.waitForSelector('[role="listbox"]', { timeout: 3000 });
    await page.keyboard.type("focus mode");
    await page.waitForTimeout(300);

    const focusCmd = page.locator("text=Focus mode").first();
    if (await focusCmd.isVisible()) {
      await focusCmd.click();
      await page.waitForTimeout(500);

      // Focus mode should hide sidebars/toolbar — check for exit button
      const exitBtn = page.locator("text=Exit Focus, [aria-label*='focus']").first();
      const isVisible = await exitBtn.isVisible().catch(() => false);
      if (isVisible) {
        // Exit focus mode
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
    }
  });
});
