import { test, expect } from "@playwright/test";

/**
 * Plan W10.A10 in a real browser (wave g6, Mac pack L5): the settings
 * screen's tab list shows no raw i18n key (such as `fineTune.title`) in
 * Hebrew or English, from the first paint of the screen — before any lazy
 * panel has loaded. settingsScreen.test.tsx checks the same with the
 * strings already in memory; this is the cold start path, where the bug was.
 */

/** A label that is an i18n key: dotted lowercase words, no spaces (fineTune.title, settings.tab.ai). */
const RAW_KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;

for (const locale of ["he", "en"] as const) {
  test(`W10.A10 (${locale}): no raw key in the settings tabs on a cold open`, async ({ page }) => {
    await page.addInitScript((loc) => {
      localStorage.setItem("lumen-tour-done", "1");
      localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: loc }, version: 0 }));
    }, locale);
    await page.goto("/");
    await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "settings.open" } })));
    const tabs = page.getByTestId("settings-screen").locator('[role="tablist"] [role="tab"]');
    await expect(tabs.first()).toBeVisible({ timeout: 15_000 });
    // Read at once: the first paint is the case under test, not a later re-render.
    const labels = (await tabs.allTextContents()).map((s) => s.trim());
    expect(labels.length).toBeGreaterThan(3);
    const raw = labels.filter((l) => RAW_KEY.test(l));
    expect(raw, `raw keys in the ${locale} tab list: ${raw.join(", ")}`).toEqual([]);
    expect(labels.join("|")).not.toContain("fineTune.title");
  });
}
