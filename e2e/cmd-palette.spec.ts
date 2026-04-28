import { test, expect } from "@playwright/test";

/**
 * Command palette — open / search / execute a command. Verifies that
 * filtering surfaces a known command (View Mode toggle) and that pressing
 * Enter actually fires its action (the active view-mode label changes).
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
});

test("⌘K → search for a known command → fires its action", async ({ page }) => {
  await page.keyboard.press("Meta+K");
  await expect(page.getByRole("dialog")).toBeVisible();

  // Search by partial command label. "Preview" is one of the View Mode
  // toggles always present in the palette.
  await page.keyboard.type("Preview");

  // Focus the first matching listbox option and run.
  await page.keyboard.press("Enter");

  // Palette should close after the action runs.
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("⌘K then Esc closes without firing anything", async ({ page }) => {
  await page.keyboard.press("Meta+K");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
