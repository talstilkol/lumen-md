import { test, expect, type Page } from "@playwright/test";

/**
 * Plan W11.S1 — the encrypted sync is off by default, and the screen that
 * turns it on says, in the user's language, that its cryptography has had
 * no external security audit. The production build, a fresh profile (no
 * flags): opening sync from the command palette shows the gate, not the
 * panel; the notice is visible (on screen, not clipped or hidden) in
 * English and in Hebrew, and the Hebrew gate is right-to-left. "Not now"
 * leaves the flag off and opens nothing.
 */

const run = (page: Page, id: string) => page.evaluate((cmd) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cmd } })), id);

async function boot(page: Page, locale: "en" | "he") {
  await page.addInitScript((loc) => {
    localStorage.clear();
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: loc, doc: { name: "note.md", content: "# note\n", dirty: false, workspaceName: null } }, version: 0 }));
  }, locale);
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
}

async function expectOnScreen(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toBeVisible();
  const box = await el.boundingBox();
  const vp = page.viewportSize()!;
  expect(box, testId).not.toBeNull();
  expect(box!.width).toBeGreaterThan(40);
  expect(box!.height).toBeGreaterThan(16);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
}

const CASES = [
  { locale: "en", badge: "Experimental — not externally security-audited", dir: "ltr" },
  { locale: "he", badge: "ניסיוני — לא עבר ביקורת אבטחה חיצונית", dir: "rtl" },
] as const;

for (const c of CASES) {
  test(`sync off by default: the gate says unaudited (${c.locale})`, async ({ page }) => {
    await boot(page, c.locale);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("lumen-flags") ?? "{}")["sync.e2ee"] ?? false)).toBe(false);
    await run(page, "sync.open");
    const gate = page.getByTestId("e2ee-gate");
    await expect(gate).toBeVisible({ timeout: 10_000 });
    await expect(gate).toHaveAttribute("dir", c.dir);
    await expect(page.getByTestId("e2ee-unaudited")).toContainText(c.badge);
    await expectOnScreen(page, "e2ee-unaudited");
    await page.screenshot({ path: test.info().outputPath(`e2ee-gate-${c.locale}.png`) });
    await page.getByTestId("e2ee-gate-cancel").click();
    await expect(gate).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("lumen-flags") ?? "{}")["sync.e2ee"] ?? false)).toBe(false);
  });
}
