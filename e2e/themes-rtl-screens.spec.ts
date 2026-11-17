import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { testHooks, type LumenTestWindow } from "./_lumen";
// @ts-expect-error -- plain .mjs module without type declarations
import { PROBE, SCREENS, SPECIMEN_MD } from "../scripts/themes/rtl-probe.mjs";

/**
 * Plan W12.S6 — the 8 screens of every gallery theme in the RUNNING APP, in
 * Hebrew (RTL) and English (LTR): screenshots, plus the measurements that
 * src/plugins/runtime/rtlScreens.ts judges (each RTL block is the mirror of
 * its LTR twin; no sideways scrolling; no serious/critical axe finding the
 * app without a theme doesn't already have).
 *
 * Writes test-results/themes-rtl/measures.json; then
 *   node scripts/themes/rtl-check.mjs --screens test-results/themes-rtl/results.json
 * merges the verdicts into the scorecards (the "tested in RTL" badge).
 * The offline stand-in, on a static specimen instead of the app, is
 * scripts/themes/rtl-screens-specimen.mjs.
 */

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const GALLERY = join(process.cwd(), "public/themes/examples");
const index = JSON.parse(readFileSync(join(GALLERY, "index.json"), "utf8")) as { themes: { id: string; path: string }[] };
const THEMES = [{ id: "(no theme)", css: "" }, ...index.themes.map((t) => ({ id: t.id, css: readFileSync(join(GALLERY, t.path, "theme.css"), "utf8") }))];
const OUT = join(process.cwd(), "test-results/themes-rtl");

type Probe = { boxes: { key: string; x: number; y: number; width: number; height: number }[]; overflowX: number; viewport: number };

async function boot(page: Page, lang: "he" | "en") {
  await page.addInitScript((l) => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: l, theme: "light", mode: "preview" }, version: 0 }));
  }, lang);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await testHooks(page);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "he" ? "rtl" : "ltr");
}

async function applyTheme(page: Page, css: string) {
  await page.evaluate((c) => {
    document.getElementById("rtl-screens-theme")?.remove();
    const s = document.createElement("style");
    s.id = "rtl-screens-theme";
    s.textContent = c;
    document.head.append(s);
  }, css);
}

async function axeOn(page: Page, root: string, only: string): Promise<string[]> {
  await page.evaluate(AXE);
  return page.evaluate(
    async ([r, o]) => {
      const w = window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string | null; nodes: { target: string[] }[] }[] }> } };
      if (!document.querySelector(r)) return [];
      const res = await w.axe.run({ include: o.split(",").map((x: string) => [`${r} ${x}`]) }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
      return res.violations.filter((v) => v.impact === "serious" || v.impact === "critical").flatMap((v) => v.nodes.map((n) => `${v.id}:${n.target.join(" ")}`));
    },
    [root, only] as const,
  );
}

async function measureAll(page: Page, lang: "he" | "en", shotPrefix: string) {
  const out: Record<string, Probe & { axe: string[] }> = {};
  // The note screens: one specimen note in preview.
  await page.evaluate(async (md) => {
    const ws = await (window as unknown as LumenTestWindow).__lumenTest.load("storage/workspace");
    await ws.writeWorkspaceFile("rtl-specimen.md", md);
    window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path: "rtl-specimen.md" } }));
  }, SPECIMEN_MD);
  const store = async (mode: string) =>
    page.evaluate(async (m) => {
      const s = await (window as unknown as LumenTestWindow).__lumenTest.load("store/useStore");
      (s as unknown as { useAppStore: { getState(): { setMode(m: string): void } } }).useAppStore.getState().setMode(m);
    }, mode);
  await store("preview");
  await expect(page.locator(".prose-lumen .callout").first()).toBeVisible({ timeout: 15_000 });
  for (const s of ["preview", "table", "lists", "callouts", "code-in-hebrew"] as const) {
    out[s] = { ...((await page.evaluate(`(${PROBE})(${JSON.stringify(SCREENS[s])})`)) as Probe), axe: await axeOn(page, SCREENS[s].root, SCREENS[s].only) };
  }
  await page.screenshot({ path: `${shotPrefix}-preview-${lang}.png` });
  await store("source");
  await expect(page.locator(".cm-editor").first()).toBeVisible();
  out.editor = { ...((await page.evaluate(`(${PROBE})(${JSON.stringify(SCREENS.editor)})`)) as Probe), axe: await axeOn(page, SCREENS.editor.root, SCREENS.editor.only) };
  await page.screenshot({ path: `${shotPrefix}-editor-${lang}.png` });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "settings.open" } })));
  const dialog = page.getByRole("dialog").first();
  if (await dialog.isVisible({ timeout: 10_000 }).catch(() => false)) {
    out.settings = { ...((await page.evaluate(`(${PROBE})(${JSON.stringify(SCREENS.settings)})`)) as Probe), axe: await axeOn(page, SCREENS.settings.root, SCREENS.settings.only) };
    await page.screenshot({ path: `${shotPrefix}-settings-${lang}.png` });
    await page.keyboard.press("Escape");
  }
  // Bases: a .base over the specimen note, when the build opens .base files in a view.
  await page.evaluate(async () => {
    const ws = await (window as unknown as LumenTestWindow).__lumenTest.load("storage/workspace");
    await ws.writeWorkspaceFile("rtl-specimen.base", "views:\n  - type: table\n    name: טבלה\n");
    window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path: "rtl-specimen.base" } }));
  });
  if (await page.locator(SCREENS.bases.root).first().isVisible({ timeout: 10_000 }).catch(() => false)) {
    out.bases = { ...((await page.evaluate(`(${PROBE})(${JSON.stringify(SCREENS.bases)})`)) as Probe), axe: await axeOn(page, SCREENS.bases.root, SCREENS.bases.only) };
    await page.screenshot({ path: `${shotPrefix}-bases-${lang}.png` });
  }
  return out;
}

test("themes: the 8 RTL screens of every gallery theme, measured in the running app", async ({ browser }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  const measures: Record<string, Record<string, unknown>> = {};
  for (const th of THEMES) {
    const per: Record<string, Awaited<ReturnType<typeof measureAll>>> = {};
    for (const lang of ["he", "en"] as const) {
      const page = await browser.newPage();
      await boot(page, lang);
      await applyTheme(page, th.css);
      per[lang] = await measureAll(page, lang, join(OUT, th.id.replace(/[^\w.@-]+/g, "_")));
      await page.close();
    }
    measures[th.id] = per;
  }
  writeFileSync(join(OUT, "measures.json"), JSON.stringify(measures, null, 1) + "\n");
  // Every theme reached at least the five note screens and the editor in both directions.
  for (const th of THEMES) for (const lang of ["he", "en"]) expect(Object.keys((measures[th.id] as Record<string, object>)[lang]).length, `${th.id} ${lang}`).toBeGreaterThanOrEqual(6);
});
