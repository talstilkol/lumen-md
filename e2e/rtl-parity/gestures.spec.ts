import { test, expect, devices, type Page } from "@playwright/test";
import { LOCALES, boxOf, openApp, type Locale } from "./_rtl";

/**
 * Plan 9.9 (W10.E22): phone edge swipes mirror in RTL (src/mobile/gestures.ts).
 * A swipe in from the *start* edge opens the file tree, from the *end* edge
 * the outline sheet; in Hebrew the start edge is the right one. A swipe back
 * towards the panel's edge closes it. Real touch pointer events on a Pixel 7
 * (Chromium), as e2e/touch.spec.ts drives them.
 */

const { defaultBrowserType: _browser, ...pixel } = devices["Pixel 7"];
test.use(pixel);

const NOTE = "# כותרת\n\nפסקה.\n\n## Second\n\nText.\n";

/** A quick horizontal touch stroke from x0 to x1 at mid-height (under 700 ms, so a swipe). */
async function swipe(page: Page, x0: number, x1: number): Promise<void> {
  await page.evaluate(
    async ({ x0, x1 }) => {
      const y = Math.round(window.innerHeight / 2);
      const ev = (type: string, x: number, buttons: number) => new PointerEvent(type, { pointerId: 11, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, buttons });
      (document.elementFromPoint(x0, y) ?? document.body).dispatchEvent(ev("pointerdown", x0, 1));
      for (let i = 1; i <= 5; i++) {
        const x = x0 + ((x1 - x0) * i) / 5;
        (document.elementFromPoint(x, y) ?? document.body).dispatchEvent(ev("pointermove", x, 1));
        await new Promise((r) => setTimeout(r, 16));
      }
      (document.elementFromPoint(x1, y) ?? document.body).dispatchEvent(ev("pointerup", x1, 0));
    },
    { x0, x1 },
  );
}

for (const locale of LOCALES) {
  test.describe(`edge swipes in ${locale}`, () => {
    const startEdge = (w: number, l: Locale) => (l === "he" ? { from: w - 4, to: w - 160 } : { from: 4, to: 160 });
    const endEdge = (w: number, l: Locale) => (l === "he" ? { from: 4, to: 160 } : { from: w - 4, to: w - 160 });

    test("a swipe in from the start edge opens the file tree on that side; a swipe back closes it", async ({ page }) => {
      await openApp(page, locale, NOTE);
      await expect(page.locator("main")).toBeVisible({ timeout: 20_000 });
      const w = page.viewportSize()!.width;
      await expect(page.locator(".file-tree")).toHaveCount(0);
      const s = startEdge(w, locale);
      await swipe(page, s.from, s.to);
      const tree = page.locator(".file-tree").first();
      await expect(tree).toBeVisible();
      const b = await boxOf(page, ".file-tree");
      // The panel hugs the start edge: the right edge in Hebrew, the left in English.
      if (locale === "he") expect(Math.round(b.x + b.width)).toBeGreaterThanOrEqual(w - 2);
      else expect(Math.round(b.x)).toBeLessThanOrEqual(2);
      // Back towards its edge, starting on the panel.
      await swipe(page, locale === "he" ? b.x + 40 : b.x + b.width - 40, locale === "he" ? b.x + 40 + 140 : b.x + b.width - 40 - 140);
      await expect(page.locator(".file-tree")).toHaveCount(0);
    });

    test("a swipe in from the end edge opens the outline sheet, not the file tree", async ({ page }) => {
      await openApp(page, locale, NOTE);
      await expect(page.locator("main")).toBeVisible({ timeout: 20_000 });
      const w = page.viewportSize()!.width;
      const e = endEdge(w, locale);
      await swipe(page, e.from, e.to);
      await expect(page.getByTestId("outline-sheet")).toBeVisible();
      await expect(page.locator(".file-tree")).toHaveCount(0);
    });

    test("the mirrored swipe (in from the other edge, the wrong way) does nothing", async ({ page }) => {
      await openApp(page, locale, NOTE);
      await expect(page.locator("main")).toBeVisible({ timeout: 20_000 });
      const w = page.viewportSize()!.width;
      // From the start edge but outwards: not a swipe in.
      const s = startEdge(w, locale);
      await swipe(page, s.to, s.from);
      await expect(page.locator(".file-tree")).toHaveCount(0);
      await expect(page.getByTestId("outline-sheet")).toHaveCount(0);
    });
  });
}
