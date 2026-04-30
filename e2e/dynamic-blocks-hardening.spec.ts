import { test, expect } from "@playwright/test";

/**
 * Hardening smoke for dynamic blocks: HTML preview is sanitized, Live JS runs
 * via the worker path, and SVG blocks are rendered with status output.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await page.keyboard.press("Meta+2");
});

test("security-critical dynamic blocks stay functional with safe status output", async ({ page }) => {
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill(
    "```html\n" +
      "<div>safe</div><script>console.log(1)</script>\n" +
      "```\n\n" +
      "```live-js\n" +
      "console.log('js-ok');\n" +
      "console.log(3 + 4);\n" +
      "```\n\n" +
      "```svg\n" +
      "<svg><circle cx=\"25\" cy=\"25\" r=\"20\" /></svg>\n" +
      "```\n",
  );

  await expect(page.locator("text=Some HTML content was sanitized before preview for safety.")).toBeVisible({
    timeout: 8_000,
  });

  await expect(page.locator("text=JS run: Completed")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("text=/\\[log\\] js-ok/")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("text=SVG")).toBeVisible();
  await expect(page.locator("text=Rendered")).toBeVisible();
});


test("Live JS block surfaces error state on runtime exception", async ({ page }) => {
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill(
    "```live-js\n" +
      "throw new Error(\"security-workflow\");\n" +
      "```\n",
  );

  await expect(page.locator("text=JS run: Runtime error")).toBeVisible({ timeout: 8_000 });
});
