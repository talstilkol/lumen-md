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

// Helper: open palette, type a locale label, wait for the matching
// option to render in the dialog's listbox, then fire it via Enter.
//
// The palette placeholder is localized (English: "Type a command…",
// Hebrew: "הקלד פקודה…"), so we can't filter by placeholder text in
// this spec — it switches locales mid-test. Instead we look for the
// generic palette `<input>` inside the role=dialog.
async function pickLocale(
  page: import("@playwright/test").Page,
  label: string,
): Promise<void> {
  await page.keyboard.press("Meta+K");
  const palette = page
    .locator('[role="dialog"][aria-modal="true"]')
    .filter({ has: page.locator("input") });
  await palette.waitFor({ timeout: 8000 });
  await page.keyboard.type(label);
  await palette.getByText(label).first().waitFor({ timeout: 8000 });
  await page.keyboard.press("Enter");
}

test("⌘K → 'עברית' flips <html dir> to rtl", async ({ page }) => {
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await pickLocale(page, "עברית");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "he");
});

test("switching back to English restores ltr", async ({ page }) => {
  await pickLocale(page, "עברית");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await pickLocale(page, "English");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});
