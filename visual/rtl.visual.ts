/**
 * Plan 9.5 — visual baselines of the RTL matrix note (e2e/rtl-note.ts):
 * tables, lists, tasks, quotes and code, in the preview and in WYSIWYG,
 * with the interface in Hebrew, light and dark, and on two phones.
 * Same rules as surfaces.visual.ts: a missing baseline fails.
 */
import { test, expect, devices } from "@playwright/test";
import { RTL_NOTE } from "../e2e/rtl-note";
import { prepare, settle, type Variant } from "./harness";

const HE: Variant[] = [
  { id: "he-light", locale: "he", theme: "light" },
  { id: "he-dark", locale: "he", theme: "dark" },
];

const VIEWS = [
  { id: "preview", key: "Meta+3", ready: ".prose-lumen table" },
  { id: "wysiwyg", key: "Meta+4", ready: ".ProseMirror table" },
];

for (const v of HE) {
  for (const view of VIEWS) {
    test(`rtl matrix · ${view.id} · ${v.id}`, async ({ page }) => {
      await prepare(page, v, RTL_NOTE);
      await page.keyboard.press(view.key);
      await page.locator(view.ready).first().waitFor({ state: "visible", timeout: 20_000 });
      await settle(page);
      await expect(page).toHaveScreenshot(`rtl-${view.id}--${v.id}.png`, { fullPage: true });
    });
  }
}

for (const name of ["iPhone 14", "Pixel 7"] as const) {
  test.describe(name, () => {
    const { defaultBrowserType: _engine, ...device } = devices[name];
    test.use(device);
    test(`rtl matrix · preview · he-light · ${name}`, async ({ page }) => {
      await prepare(page, HE[0], RTL_NOTE);
      await page.keyboard.press("Meta+3");
      await page.locator(".prose-lumen table").first().waitFor({ state: "visible", timeout: 20_000 });
      await settle(page);
      await expect(page).toHaveScreenshot(`rtl-preview--he-light--${name.replace(/\s+/g, "-").toLowerCase()}.png`, { fullPage: true });
    });
  });
}

/*
 * Plan W13.H3 — directional icons mirror in RTL, fixed ones do not
 * (src/ui/icons/direction.json). Baselines of the toolbar with its Edit menu
 * open (undo/redo, submenu chevrons) and of the command palette, in Hebrew.
 * The computed `scale` of every icon is checked too, so a regression shows
 * in the assertion before it shows in the pixels.
 */
for (const v of HE) {
  test(`rtl icons · toolbar edit menu · ${v.id}`, async ({ page }) => {
    await prepare(page, v);
    await page.getByRole("button", { name: /עריכה/ }).first().click();
    await page.locator('[role="menu"]').first().waitFor({ state: "visible" });
    const scales = await page.locator("svg.icon-dir").evaluateAll((els) => els.map((e) => getComputedStyle(e).scale));
    expect(scales.length).toBeGreaterThan(1);
    expect(new Set(scales)).toEqual(new Set(["-1 1"]));
    const fixed = await page.locator("svg.lucide:not(.icon-dir)").evaluateAll((els) => els.map((e) => getComputedStyle(e).scale));
    expect(fixed.every((s) => s === "none")).toBe(true);
    await settle(page);
    await expect(page).toHaveScreenshot(`rtl-icons-toolbar--${v.id}.png`);
  });

  test(`rtl icons · command palette · ${v.id}`, async ({ page }) => {
    await prepare(page, v);
    await page.keyboard.press("Meta+K");
    await page.locator('[role="dialog"][aria-modal="true"] input').waitFor({ state: "visible" });
    await settle(page);
    await expect(page).toHaveScreenshot(`rtl-icons-palette--${v.id}.png`);
  });
}
