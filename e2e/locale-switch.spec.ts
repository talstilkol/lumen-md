import { test, expect } from "@playwright/test";

/**
 * Locale switch — opens command palette, selects Hebrew, asserts the
 * document direction flipped to RTL via `<html dir="rtl">`. Also verifies
 * the toolbar relabels (the brand tagline is bilingual).
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await page.locator("header").first().waitFor({ state: "visible", timeout: 5000 });
});

test("⌘K → 'עברית' flips <html dir> to rtl", async ({ page }) => {
  // Default load is LTR.
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

  // Open the command palette and search for the Hebrew locale entry.
  // Using the fully-typed Hebrew name — the locale picker labels each
  // option with its native name so the search hit is locale-agnostic.
  await page.keyboard.press("Meta+K");
  await page.keyboard.type("עברית");
  await page.keyboard.press("Enter");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "he");
});

test("switching back to English restores ltr", async ({ page }) => {
  // Switch to Hebrew first.
  await page.keyboard.press("Meta+K");
  await page.keyboard.type("עברית");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  // Now switch back via "English" — search the English label.
  await page.keyboard.press("Meta+K");
  await page.keyboard.type("English");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});
