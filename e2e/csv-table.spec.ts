import { test, expect } from "@playwright/test";

/**
 * CSV → DataTable — a fenced ```csv``` block renders as a sortable table
 * with column headers. The chart-suggestion side-panel is a follow-up
 * feature; here we just assert the table itself materializes.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
});

test("a CSV fence renders as a DataTable with headers", async ({ page }) => {
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill(
    "```csv\nmonth,revenue\nJan,4200\nFeb,4800\nMar,5100\n```\n",
  );

  // CSV block is lazy-loaded. Wait for the rendered table head to show
  // the two column names.
  const monthHeader = page.locator("table th, [role='columnheader']").filter({ hasText: "month" }).first();
  await expect(monthHeader).toBeVisible({ timeout: 8_000 });
  const revenueHeader = page.locator("table th, [role='columnheader']").filter({ hasText: "revenue" }).first();
  await expect(revenueHeader).toBeVisible({ timeout: 8_000 });
});
