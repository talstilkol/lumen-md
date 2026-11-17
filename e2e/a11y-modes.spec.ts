import { test, expect } from "@playwright/test";
import { SURFACES, bootApp, openSurface, tabThrough } from "./_surfaces";

/**
 * Plan W13.Y2 — Windows High Contrast (forced colours), prefers-contrast and
 * prefers-reduced-motion, as a gate on the ten surfaces:
 *
 *   forced colours  every focused control shows a visible focus indicator
 *                   (an outline or a border that differs from the unfocused
 *                   state) in a system colour, and text is drawn in system
 *                   colours (no author colour survives except where
 *                   forced-color-adjust: none is allowed);
 *   reduced motion  no CSS animation or transition runs (document.getAnimations()
 *                   is empty or every one is finished within a frame).
 *
 * Screenshots of each surface in forced colours go to test-results/ for the
 * visual baseline (W1.23).
 */

test.describe("forced colours (Windows High Contrast)", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await bootApp(page);
  });

  for (const s of SURFACES) {
    test(`${s.name}: focus is visible and text uses system colours`, async ({ page }, info) => {
      const close = await openSurface(page, s);
      const problems: string[] = [];
      await tabThrough(page, 12, async () => {
        const r = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          const ring = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 1;
          return { tag: el.tagName, name: el.getAttribute("aria-label") ?? el.textContent?.slice(0, 30) ?? "", ring, border: parseFloat(cs.borderTopWidth) >= 1 };
        });
        if (r && !r.ring) problems.push(`${r.tag} “${r.name}” has no visible focus outline`);
      });
      await page.screenshot({ path: info.outputPath(`forced-${s.name.replace(/\W+/g, "-")}.png`) });
      await close();
      expect(problems).toEqual([]);
    });
  }

  test("prefers-contrast: more darkens borders and muted text", async ({ page }) => {
    const tokens = () => page.evaluate(() => ["--border", "--fg-muted"].map((k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim()));
    await page.emulateMedia({ forcedColors: "none", contrast: "no-preference" });
    const normal = await tokens();
    await page.emulateMedia({ forcedColors: "none", contrast: "more" });
    const more = await tokens();
    expect(more[0]).not.toBe(normal[0]);
    expect(more[1]).not.toBe(normal[1]);
  });
});

test.describe("reduced motion", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await bootApp(page);
  });

  for (const s of SURFACES) {
    test(`${s.name}: no running CSS animation or transition`, async ({ page }) => {
      const close = await openSurface(page, s);
      // two frames: any transition the surface starts has begun
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      const running = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.playState === "running" && Number(a.effect?.getComputedTiming().duration ?? 0) > 1)
          .map((a) => (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "script"),
      );
      await close();
      expect(running).toEqual([]);
    });
  }
});
