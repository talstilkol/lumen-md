import { test, expect } from "@playwright/test";
import { SURFACES, bootApp, openSurface } from "./_surfaces";

/**
 * Plan W13.Y4 — the user's text size (EN 301 549 v4.1.1 user preferences,
 * WCAG 1.4.4): with the text at 200 % (what the system text size gives
 * through src/a11y/systemTextSize.ts, as CSS zoom on the root), each of the ten surfaces has no
 * horizontal scroll and no clipped text.
 */
for (const s of SURFACES) {
  test(`${s.name} at 200 % text: no horizontal scroll, no clipped text`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => localStorage.setItem("lumen.textScale.override", "2"));
    await bootApp(page);
    // systemTextSize.ts applies the scale as CSS zoom on the root (browser-zoom reflow).
    await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe("2");
    const close = await openSurface(page, s);
    const r = await page.evaluate(() => {
      const scroll = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const clipped: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("button, label, h1, h2, h3, p, [role=tab], [role=menuitem], [role=option]")) {
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || el.offsetParent === null) continue;
        // Text cut off without an ellipsis or a way to scroll it into view.
        const cut = (el.scrollWidth > el.clientWidth + 1 && cs.overflowX === "hidden" && cs.textOverflow !== "ellipsis") || (el.scrollHeight > el.clientHeight + 1 && cs.overflowY === "hidden" && cs.webkitLineClamp === "none");
        if (cut) clipped.push(`${el.tagName} “${el.textContent?.trim().slice(0, 40)}”`);
      }
      return { scroll, clipped: clipped.slice(0, 10) };
    });
    await close();
    expect(r.scroll, "horizontal scroll (px)").toBeLessThanOrEqual(0);
    expect(r.clipped).toEqual([]);
  });
}
