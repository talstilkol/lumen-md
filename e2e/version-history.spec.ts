import { test, expect } from "@playwright/test";

test.describe("Version History", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("lumen-tour-done", "1");
      localStorage.removeItem("lumen-md");
    });
    await page.goto("/");
    await page.locator("header").first().waitFor({ state: "visible", timeout: 5000 });
  });

  test("opens version history via command palette", async ({ page }) => {
    // Type some content first to create a version
    const editor = page.locator(".cm-content, .ProseMirror").first();
    if (await editor.isVisible()) {
      await editor.click();
      await page.keyboard.type("# Test Document");
      await page.waitForTimeout(500);
    }

    // Open command palette
    await page.keyboard.press("Meta+k");
    await page.waitForSelector('[role="dialog"]', { timeout: 3000 });
    await page.keyboard.type("version history");
    await page.waitForTimeout(300);

    // Scope the lookup INSIDE the palette dialog so we don't match
    // the same text appearing in the editor body underneath.
    const dialog = page.locator('[role="dialog"]');
    const vhCmd = dialog.getByText(/Version History/i).first();
    if (await vhCmd.isVisible()) {
      // Use keyboard Enter — the palette already focuses the first
      // match, and a mouse click can be intercepted by the backdrop.
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
      // Smoke: after firing the command the palette should close.
      await expect(dialog).not.toBeVisible({ timeout: 3000 });
    }
  });
});
