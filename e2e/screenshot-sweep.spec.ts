import { test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Screenshot sweep — capture visible state of many surfaces to find
 * bugs that mount/visibility assertions miss. The strategy worked
 * twice (Mermaid invisible, outline numbering); applying it broadly.
 */

const OUT = path.join(process.cwd(), "test-results", "screenshots");

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.removeItem("lumen-md");
  });
  await page.goto("/");
  await page.locator("header").first().waitFor({ state: "visible", timeout: 5000 });
});

test("default-welcome-doc", async ({ page }) => {
  await page.screenshot({
    path: path.join(OUT, "00-default-welcome.png"),
    fullPage: false, // viewport only — faster + matches user's first impression
  });
});

test("empty-doc-source-mode", async ({ page }) => {
  await page.keyboard.press("Meta+1");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await editor.fill("");
  await page.screenshot({ path: path.join(OUT, "01-empty-doc.png") });
});

test("command-palette-open", async ({ page }) => {
  await page.keyboard.press("Meta+K");
  await page.locator('[role="dialog"][aria-modal="true"]').first().waitFor();
  await page.screenshot({ path: path.join(OUT, "02-palette.png") });
});

test("file-menu-open", async ({ page }) => {
  await page.locator("header button:has-text('File')").click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, "03-file-menu.png") });
});

test("insert-menu-open", async ({ page }) => {
  await page.locator("header button:has-text('Insert')").click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, "04-insert-menu.png") });
});

test("view-mode-menu-open", async ({ page }) => {
  await page.locator("header button:has-text('View Mode')").click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, "05-view-mode-menu.png") });
});

test("help-menu-open", async ({ page }) => {
  await page.locator("header button:has-text('Help')").click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, "06-help-menu.png") });
});

test("keyboard-shortcuts-dialog", async ({ page }) => {
  // ⌘/ opens shortcuts dialog.
  await page.keyboard.press("Meta+/");
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "07-shortcuts.png") });
});

test("preview-only-rendered-welcome", async ({ page }) => {
  await page.keyboard.press("Meta+3");
  await page.waitForTimeout(2000); // give time for lazy charts to render
  await page.screenshot({
    path: path.join(OUT, "08-preview-welcome-fullpage.png"),
    fullPage: true,
  });
});

test("source-mode-welcome", async ({ page }) => {
  await page.keyboard.press("Meta+1");
  await page.screenshot({ path: path.join(OUT, "09-source-welcome.png") });
});

test("light-mode", async ({ page }) => {
  // The theme toggle button is in the header (icon button).
  await page.keyboard.press("Meta+K");
  const palette = page
    .locator('[role="dialog"][aria-modal="true"]')
    .filter({ has: page.locator("input") });
  await palette.waitFor({ timeout: 3000 });
  await page.keyboard.type("Theme");
  await page.waitForTimeout(300);
  // Try to find a Light theme command.
  const light = palette.getByText(/Light/i).first();
  if (await light.isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
  } else {
    await page.keyboard.press("Escape");
  }
  await page.screenshot({ path: path.join(OUT, "10-light-mode.png") });
});

test("ai-fab-clicked", async ({ page }) => {
  // AI Fab is the floating button at bottom-right.
  const fab = page
    .locator("button[aria-label*='AI' i], button[title*='AI' i]")
    .first();
  if (await fab.isVisible({ timeout: 1500 }).catch(() => false)) {
    await fab.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(OUT, "11-ai-fab.png") });
});
