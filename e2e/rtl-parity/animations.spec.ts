import { test, expect } from "@playwright/test";
import { LOCALES, openApp } from "./_rtl";
import { testHooks, type LumenTestWindow } from "../_lumen";

/**
 * Plan 9.9 (W10.E22): entrance animations come in from the side their
 * element sits on, mirrored in RTL. A toast sits at the inline end (bottom
 * right in English, bottom left in Hebrew), so it slides in from beyond that
 * edge: from +x in English, from −x in Hebrew. Read from the running
 * animation itself (paused at its first frame), not from the CSS text.
 */

for (const locale of LOCALES) {
  test(`a toast slides in from its own edge (${locale})`, async ({ page }) => {
    // Reduced motion would turn entrances off (stable.css / prefers-reduced-motion): this spec wants them.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openApp(page, locale, "# Toast\n");
    await page.locator(".cm-content, .ProseMirror, .prose-lumen").first().waitFor({ state: "visible", timeout: 20_000 });
    // The app's own toast (src/ui/AiToast.tsx), shown through the e2e hooks (src/testing/e2eHooks.ts).
    await testHooks(page);
    await page.evaluate(async () => (await (window as unknown as LumenTestWindow).__lumenTest.load("ui/AiToast")).showAiToast("RTL toast", "info"));
    const toast = page.locator('[data-testid="toasts-status"] > div').filter({ hasText: "RTL toast" });
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const { dx, side } = await toast.evaluate((el) => {
      const a = el.getAnimations().find((x) => (x as CSSAnimation).animationName === "toast-slide-in");
      if (!a) return { dx: Number.NaN, side: "none" };
      a.pause();
      a.currentTime = 0;
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      const r = el.getBoundingClientRect();
      return { dx: m.m41, side: r.left + r.width / 2 > window.innerWidth / 2 ? "right" : "left" };
    });
    expect(Number.isNaN(dx), "the toast runs toast-slide-in").toBe(false);
    if (locale === "he") {
      expect(side).toBe("left");
      expect(dx).toBeLessThan(0);
    } else {
      expect(side).toBe("right");
      expect(dx).toBeGreaterThan(0);
    }
  });
}
