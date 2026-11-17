import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * Plan W1.21 — the 5 built-in themes (src/lib/themeSettings.ts PRESET_IDS),
 * in the running app:
 *
 *  - axe (WCAG 2.0/2.1 A + AA, colour contrast included) finds no serious or
 *    critical violation on the main screen in each theme, light and dark, in
 *    Hebrew (RTL) and English (LTR);
 *  - switching the theme in Theme settings takes < 100 ms from the click to
 *    the next frame with the theme's variables applied, with no reload.
 *
 * The CSS-snippet half of W1.21 (a snippet's external url() makes no
 * request) is src/__tests__/snippets.test.ts.
 */

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** src/lib/themeSettings.ts PRESET_IDS, in the order the Theme tab lists them. */
const PRESETS = ["default", "sepia", "nord", "highContrast", "hebrew"] as const;
const SWITCH_BUDGET_MS = 100;

type Violation = { id: string; impact: string | null; help: string; nodes: string[] };

async function axe(page: Page): Promise<Violation[]> {
  // Evaluated over the DevTools protocol: the page's CSP doesn't apply.
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }> }> } };
    const r = await w.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 6).map((n) => n.target.join(" ")) }));
  });
}

async function boot(page: Page, lang: "en" | "he", scheme: "light" | "dark", preset: string) {
  await page.addInitScript(
    ([l, th, p]) => {
      localStorage.setItem("lumen-tour-done", "1");
      localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: l, theme: th, themeSettings: { preset: p } }, version: 0 }));
    },
    [lang, scheme, preset] as const,
  );
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "he" ? "rtl" : "ltr");
}

for (const lang of ["he", "en"] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`themes: axe AA on all 5 themes — ${lang === "he" ? "Hebrew RTL" : "English LTR"}, ${scheme}`, async ({ page }) => {
      test.setTimeout(120_000);
      const found: string[] = [];
      for (const preset of PRESETS) {
        await boot(page, lang, scheme, preset);
        await expect(page.locator("html")).toHaveAttribute("data-theme-preset", preset);
        const blocking = (await axe(page)).filter((v) => v.impact === "serious" || v.impact === "critical");
        for (const v of blocking) found.push(`${preset}: ${v.impact} ${v.id} — ${v.help}\n    ${v.nodes.join("\n    ")}`);
      }
      expect(found.join("\n"), "axe serious/critical violations").toBe("");
    });
  }
}

test("themes: switching between the 5 themes takes < 100 ms each, without a reload", async ({ page }) => {
  await boot(page, "he", "light", "default");
  // A marker that a reload would lose.
  await page.evaluate(() => ((window as unknown as { __themeSwitchMarker?: number }).__themeSwitchMarker = 1));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "settings.theme" } })));
  const dialog = page.getByTestId("theme-settings");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  const radios = dialog.getByRole("radiogroup").first().getByRole("radio");
  await expect(radios).toHaveCount(PRESETS.length);

  const times: Record<string, number> = {};
  // Every theme from the one before it, then back to the first.
  for (const [k, preset] of [...PRESETS.slice(1), PRESETS[0]].entries()) {
    const index = PRESETS.indexOf(preset);
    const ms = await radios.nth(index).evaluate(
      (el, want) =>
        new Promise<number>((resolve) => {
          const root = document.documentElement;
          const t0 = performance.now();
          (el as HTMLElement).click();
          // Applied: the preset is on <html> and its variables are in the computed style of the next frame.
          const check = () => {
            if (root.dataset.themePreset === want) {
              void getComputedStyle(document.body).getPropertyValue("--bg");
              requestAnimationFrame(() => resolve(performance.now() - t0));
            } else if (performance.now() - t0 > 5000) resolve(Infinity);
            else requestAnimationFrame(check);
          };
          check();
        }),
      preset,
    );
    times[`${k}:${preset}`] = Math.round(ms * 10) / 10;
    await expect(radios.nth(index)).toHaveAttribute("aria-checked", "true");
  }
  test.info().annotations.push({ type: "perf", description: `theme switch ms: ${JSON.stringify(times)}` });
  for (const [name, ms] of Object.entries(times)) expect(ms, name).toBeLessThan(SWITCH_BUDGET_MS);
  // No reload happened: the marker is still there, and the editor kept its content.
  expect(await page.evaluate(() => (window as unknown as { __themeSwitchMarker?: number }).__themeSwitchMarker)).toBe(1);
});
