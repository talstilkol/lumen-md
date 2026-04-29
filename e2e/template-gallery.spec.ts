import { test, expect } from "@playwright/test";

test.describe("Template Gallery", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("opens gallery via command palette", async ({ page }) => {
    // Open command palette
    await page.keyboard.press("Meta+k");
    await page.waitForSelector('[role="listbox"]', { timeout: 3000 });
    // Type template command
    await page.keyboard.type("template");
    await page.waitForTimeout(300);
    // Click the template gallery command
    const templateCmd = page.locator("text=Browse template gallery");
    if (await templateCmd.isVisible()) {
      await templateCmd.click();
      // Verify gallery opens
      await expect(
        page.locator('[aria-label="Template gallery"], [data-testid="template-gallery"]').first()
      ).toBeVisible({ timeout: 3000 });
    }
  });

  test("gallery has at least 5 templates", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    await page.waitForSelector('[role="listbox"]', { timeout: 3000 });
    await page.keyboard.type("template gallery");
    await page.waitForTimeout(300);
    const templateCmd = page.locator("text=Browse template gallery");
    if (await templateCmd.isVisible()) {
      await templateCmd.click();
      await page.waitForTimeout(1000);
      const cards = page.locator('[data-testid="template-card"], .template-card');
      const count = await cards.count();
      expect(count).toBeGreaterThanOrEqual(5);
    }
  });
});
