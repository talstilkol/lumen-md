/**
 * W10.F29 (audit r3): the old visual-ci matrix (test/visual-ci 403aa654b7..
 * 38101ac039: e2e-visual/visual-matrix.spec.ts, ten surfaces × en / he ×
 * dark / light) is replaced by visual/ and playwright.visual.config.ts
 * (decision in plan/decisions-2026-11-14.md, W10.F29). visual/harness.ts
 * has nine of its ten surfaces (and theme-settings, which it did not). The
 * tenth, the AI doctor, is ported here, with that branch's masks (391786c18c):
 * the hardware card and every "N ms" probe timing. Kept out of harness.ts
 * SURFACES, whose ten ids Percy pins (percy-surfaces.ts BASE_SURFACE_IDS).
 */
import { test, expect, type Page } from "@playwright/test";
import { VARIANTS, prepare, settle, type Surface } from "./harness";

/** Surfaces of the old matrix that harness.ts SURFACES does not have. */
export const PORTED_SURFACES: Surface[] = [
  {
    id: "ai-doctor",
    open: (p) => p.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-open-ai-doctor"))),
    ready: '[data-testid="doctor-summary"]',
    mask: (p: Page) => [p.locator('[data-testid="hw-card"]'), p.locator("span", { hasText: /^\d+ ms$/ })],
  },
];

for (const v of VARIANTS) {
  test.describe(v.id, () => {
    for (const s of PORTED_SURFACES) {
      test(s.id, async ({ page }) => {
        await prepare(page, v);
        await s.open(page);
        await page.locator(s.ready).first().waitFor({ state: "visible", timeout: 20_000 });
        await settle(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
        await expect(page).toHaveScreenshot(`${s.id}--${v.id}.png`, { mask: s.mask?.(page) });
      });
    }
  });
}
