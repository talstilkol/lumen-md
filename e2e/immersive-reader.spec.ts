import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { testHooks, type LumenTestWindow } from "./_lumen";

/**
 * Plan W13.R5 — the immersive reader in the real app: opened from the
 * Reading mode menu on a Hebrew and an English note, parts of speech in
 * colour, a word's lexicon translation, line focus, axe clean, no request
 * leaves the page while it is used, and the note is unchanged.
 */
const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const NOTES = {
  he: "# שיעור\n\nהילד הקטן הלך לבית הספר בבוקר. המורה החדשה הסבירה לתלמידים את השיעור.",
  en: "# Lesson\n\nThe little boy walked to school in the morning. The new teacher explained the lesson.",
} as const;

for (const lang of ["he", "en"] as const) {
  // "0 requests": nothing leaves the app — its own lazy chunks (same origin) are not network calls to anyone.
  test(`W13.R5 (${lang}): colours, a word's translation, line focus — 0 requests, axe clean, note unchanged`, async ({ page, baseURL }) => {
    await page.addInitScript((l) => {
      localStorage.setItem("lumen-tour-done", "1");
      localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: l, theme: "light" }, version: 0 }));
    }, lang);
    await page.goto("/");
    await testHooks(page);
    const note = NOTES[lang];
    await page.evaluate(async (content) => {
      const { useAppStore } = await (window as unknown as LumenTestWindow).__lumenTest.load("store/useStore");
      useAppStore.getState().setContent(content);
    }, note);
    // The Reading mode menu (View → Reading mode…) → Immersive → Open.
    await page.evaluate(async () => (await (window as unknown as LumenTestWindow).__lumenTest.load("ui/ReadingModeMenu")).openReadingModeMenu());
    await page.getByTestId("rm-mode-immersive").check();
    const requests: string[] = [];
    page.on("request", (r) => {
      if (!r.url().startsWith(baseURL ?? "http://localhost")) requests.push(r.url());
    });
    await page.getByTestId("rm-open").click();
    const reader = page.getByTestId("immersive-page");
    await expect(reader).toBeVisible();
    const verb = reader.locator(`[data-w="${lang === "he" ? "הלך" : "walked"}"]`);
    await expect(verb).toHaveAttribute("data-pos", "verb");
    await reader.locator(`[data-w="${lang === "he" ? "הספר" : "teacher"}"]`).click();
    if (lang === "he") await expect(page.getByTestId("immersive-gloss")).toContainText("book");
    else await expect(page.getByTestId("immersive-translate")).toBeVisible();
    await page.getByTestId("immersive-lines").selectOption("3");
    await expect(page.getByTestId("immersive-band")).toBeAttached();

    await page.addScriptTag({ content: AXE });
    const violations = await page.evaluate(async () => {
      const w = window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null }> }> } };
      const r = await w.axe.run(document.querySelector('[data-testid="immersive-reader"]'), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }, resultTypes: ["violations"] });
      return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
    });
    expect(violations).toEqual([]);
    expect(requests).toEqual([]);
    const content = await page.evaluate(async () => (await (window as unknown as LumenTestWindow).__lumenTest.load("store/useStore")).useAppStore.getState().doc.content);
    expect(content).toBe(note);
  });
}
