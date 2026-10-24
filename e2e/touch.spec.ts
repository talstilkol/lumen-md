import { test, expect, devices, type Page } from "@playwright/test";

/**
 * Touch and mobile (plan 10.2). The whole journey on an iPhone 14 and a
 * Pixel 7 (viewport, device scale, touch, mobile user agent). Both run on
 * Chromium here — Playwright's WebKit isn't available on this machine, so
 * the iPhone run checks layout and touch input, not Safari's engine.
 *
 * Acceptance: the full journey is green on both devices.
 */

const run = (page: Page, id: string) => page.evaluate((cmd) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cmd } })), id);

/** A synthetic touch pointer gesture: down on `from`, slide to `to`, up — after `holdMs`. */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, holdMs = 0) {
  await page.evaluate(
    async ({ from, to, holdMs }) => {
      const opts = (x: number, y: number) => ({ pointerId: 7, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 });
      const start = document.elementFromPoint(from.x, from.y)!;
      start.dispatchEvent(new PointerEvent("pointerdown", opts(from.x, from.y)));
      await new Promise((r) => setTimeout(r, holdMs));
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        const x = from.x + ((to.x - from.x) * i) / steps;
        const y = from.y + ((to.y - from.y) * i) / steps;
        (document.elementFromPoint(x, y) ?? document.body).dispatchEvent(new PointerEvent("pointermove", opts(x, y)));
        await new Promise((r) => setTimeout(r, 16));
      }
      (document.elementFromPoint(to.x, to.y) ?? document.body).dispatchEvent(new PointerEvent("pointerup", { ...opts(to.x, to.y), buttons: 0 }));
    },
    { from, to, holdMs },
  );
}

const center = async (page: Page, selector: string) => {
  const b = (await page.locator(selector).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

for (const name of ["iPhone 14", "Pixel 7"] as const) {
  test.describe(name, () => {
    const { defaultBrowserType: _ignored, ...device } = devices[name];
    test.use(device);

    test(`${name}: the full journey by touch`, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("lumen-tour-done", "1"));
      await page.goto("/");
      const editor = page.locator(".cm-content").first();
      await expect(editor).toBeVisible({ timeout: 20_000 });
      const vw = page.viewportSize()!.width;
      const vh = page.viewportSize()!.height;

      // 10.2.3: the page may use the whole screen, and the bars keep out of the insets.
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      // 10.2.2: every control in the app's chrome is at least 44×44 CSS px.
      const small = await page.evaluate(() => {
        const out: string[] = [];
        const chrome = document.querySelectorAll(".titlebar, .status-bar, [role='toolbar'], [role='tablist']");
        for (const root of chrome)
          for (const el of root.querySelectorAll<HTMLElement>("button, [role='button'], [role='tab'], a[href], select, input")) {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none") continue;
            if (r.width < 44 - 0.5 || r.height < 44 - 0.5) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
          }
        return out;
      });
      expect(small, "touch targets under 44 px").toEqual([]);

      // Write by touch.
      await editor.tap();
      await editor.fill("# One\n\nFirst paragraph.\n\n## Two\n\nSecond paragraph.\n\n## Three\n\nThird.\n");
      await expect(editor).toContainText("Third.");

      // 10.2.4: the outline is a bottom sheet across the screen; picking a heading closes it.
      await run(page, "view.outline");
      const sheet = page.getByTestId("outline-sheet");
      await expect(sheet).toBeVisible();
      const sb = (await sheet.boundingBox())!;
      expect(Math.round(sb.x)).toBe(0);
      expect(Math.round(sb.width)).toBe(vw);
      expect(Math.abs(sb.y + sb.height - vh)).toBeLessThan(2);
      expect(sb.height).toBeLessThanOrEqual(vh * 0.6 + 1);
      await sheet.getByRole("link", { name: "Three" }).tap();
      await expect(sheet).toBeHidden();
      // and the close button
      await run(page, "view.outline");
      await expect(sheet).toBeVisible();
      await sheet.getByRole("button", { name: "Close the outline" }).tap();
      await expect(sheet).toBeHidden();

      // The palette opens and runs a command by tap.
      await run(page, "file.new");
      const tabs = page.locator("[data-tab-index]");
      await expect(tabs).toHaveCount(2, { timeout: 10_000 });

      // 10.2.1: a long press picks a tab up; sliding and lifting reorders it.
      const first = (await tabs.nth(0).innerText()).trim();
      const a = await center(page, "[data-tab-index='0']");
      const b = await center(page, "[data-tab-index='1']");
      await touchDrag(page, a, b, 450);
      await expect.poll(async () => (await tabs.nth(1).innerText()).trim()).toBe(first);

      // 10.2.1: in the rich editor, the block handle moves a block by touch.
      await run(page, "view.wysiwyg");
      const pm = page.locator(".ProseMirror").first();
      await expect(pm).toContainText("Third.", { timeout: 15_000 });
      await page.locator("[data-tab-index='1']").tap(); // back to the note we wrote
      await expect(pm).toContainText("First paragraph.", { timeout: 10_000 });
      const blocks = pm.locator(":scope > *");
      const handle = pm.locator(".lumen-drag-handle").first();
      await expect(handle).toBeAttached();
      const h = (await handle.boundingBox())!;
      const target = (await blocks.filter({ hasText: "Second paragraph." }).first().boundingBox())!;
      await touchDrag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: target.x + 20, y: target.y + target.height - 2 });
      await expect.poll(async () => (await blocks.first().innerText()).trim()).not.toBe("One");
    });
  });
}
