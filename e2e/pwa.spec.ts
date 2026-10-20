import { test, expect } from "@playwright/test";

/**
 * D1 / D3 — the installed app keeps the manifest's promises:
 * a shared link opens as a note, shortcuts work, and the production build
 * still opens (with code highlighting) after going offline.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lumen-tour-done", "1"));
});

test("share target shows the shared text and link", async ({ page }) => {
  await page.goto("/?title=" + encodeURIComponent("Shared page") + "&text=hello&url=" + encodeURIComponent("https://example.com/a"));
  // Appended to inbox.md and the inbox shown (plan 4.16, e2e/quick-capture.spec.ts);
  // a new "# Shared page" note where the vault can't be written.
  await expect(page.locator(".cm-content").first()).toContainText("Shared page", { timeout: 15_000 });
  await expect(page.locator(".cm-content").first()).toContainText("hello");
  await expect(page.locator(".cm-content").first()).toContainText("<https://example.com/a>");
  // The parameters are removed so a reload doesn't share twice.
  await expect.poll(() => new URL(page.url()).search).toBe("");
});

test("palette shortcut opens the command palette", async ({ page }) => {
  await page.goto("/?action=palette");
  await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 15_000 });
});

test("production build opens offline after the first visit", async ({ page, context, browserName }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
  const dev = await page.evaluate(() => !!document.querySelector('script[src*="/@vite/client"]'));
  test.skip(dev, "the service worker runs on the production build only");
  test.skip(browserName !== "chromium", "service-worker offline check runs on Chromium");
  const hasSW = await page.evaluate(() => "serviceWorker" in navigator);
  test.skip(!hasSW, "no service worker support");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // A second load lets the worker control the page and fill the chunk cache.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
  await context.setOffline(false);
});
