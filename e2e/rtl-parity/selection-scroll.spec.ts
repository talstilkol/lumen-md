import { test, expect } from "@playwright/test";
import { LOCALES, openApp } from "./_rtl";

/**
 * Plan 9.9 (W10.E22): selection and horizontal scrolling in RTL.
 *  - A double-click selects the whole Hebrew word (niqqud included), and
 *    Shift+End in the source editor selects to the logical end of a Hebrew
 *    line, whichever side that is drawn on.
 *  - A block wider than the pane scrolls on its own, inside the page (the
 *    page never scrolls sideways); code stays LTR, so it opens at its left
 *    edge in either interface.
 */

const WIDE = "x".repeat(400);
const NOTE = ["# בחירה", "", "שָׁלוֹם עולם ומלואו", "", "```js", `const wide = "${WIDE}";`, "```", ""].join("\n");

for (const locale of LOCALES) {
  test.describe(`selection and scroll in ${locale}`, () => {
    test("double-click selects one whole pointed Hebrew word in the preview", async ({ page }) => {
      await openApp(page, locale, NOTE, { mode: "preview" });
      const p = page.locator(".prose-lumen p", { hasText: "עולם" }).first();
      await expect(p).toBeVisible({ timeout: 20_000 });
      await p.getByText("שָׁלוֹם", { exact: false }).first().dblclick({ position: { x: 4, y: 6 } });
      const sel = await page.evaluate(() => window.getSelection()?.toString().trim());
      expect(sel?.normalize("NFC")).toBe("שָׁלוֹם".normalize("NFC"));
    });

    test("Shift+End in the source editor selects to the logical end of a Hebrew line", async ({ page }) => {
      await openApp(page, locale, NOTE, { mode: "source" });
      const line = page.locator(".cm-line", { hasText: "עולם" }).first();
      await expect(line).toBeVisible({ timeout: 20_000 });
      await line.click();
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      const selected = await page.evaluate(() => window.getSelection()?.toString());
      expect(selected?.normalize("NFC")).toBe("שָׁלוֹם עולם ומלואו".normalize("NFC"));
    });

    test("a wide code block scrolls inside itself, starting at its left edge; the page does not scroll sideways", async ({ page }) => {
      await page.setViewportSize({ width: 900, height: 800 });
      await openApp(page, locale, NOTE, { mode: "preview" });
      const pre = page.locator(".prose-lumen pre").first();
      await expect(pre).toBeVisible({ timeout: 20_000 });
      const m = await pre.evaluate((el) => {
        const s = el.scrollWidth > el.clientWidth ? el : (el.querySelector("code") as HTMLElement) ?? el;
        return { scrolls: s.scrollWidth > s.clientWidth, left: s.scrollLeft, dir: getComputedStyle(el).direction, page: document.documentElement.scrollWidth - window.innerWidth };
      });
      expect(m.dir).toBe("ltr");
      expect(m.scrolls).toBe(true);
      expect(m.left).toBe(0);
      expect(m.page).toBeLessThanOrEqual(1);
    });
  });
}
