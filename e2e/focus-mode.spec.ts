import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { testHooks, type LumenTestWindow } from "./_lumen";

test.describe("Focus Mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("lumen-tour-done", "1");
      localStorage.removeItem("lumen-md");
    });
    await page.goto("/");
    await page.locator("header").first().waitFor({ state: "visible", timeout: 5000 });
  });

  test("toggles focus mode via Cmd+Shift+F shortcut", async ({ page }) => {
    // FocusMode is a portal that mounts only when `active === true`.
    // Its exit affordance carries the title "Exit Focus Mode (Esc)" — we
    // assert presence/absence of that title to detect the mode change.
    const exitBar = page.locator('[title="Exit Focus Mode (Esc)"]');

    // Off initially.
    await expect(exitBar).toHaveCount(0);

    // ⌘⇧F enters focus mode.
    await page.keyboard.press("Meta+Shift+F");
    await expect(exitBar).toBeVisible({ timeout: 3000 });

    // ⌘⇧F again toggles back off.
    await page.keyboard.press("Meta+Shift+F");
    await expect(exitBar).toHaveCount(0, { timeout: 3000 });
  });
});

// ── Plan W13.R2: sentence / paragraph focus and readability highlights ──

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const NOTES = {
  en: "The report was written by the team. She quickly utilized the tool. Then she left.\n\nA second paragraph here.",
  he: "המכתב נכתב על ידי המנהל. הוא עבד באופן יסודי במסגרת הפרויקט. ואז הלך.\n\nפסקה שנייה כאן.",
} as const;

for (const lang of ["en", "he"] as const) {
  test(`W13.R2 (${lang}): the sentence stays bright, highlights are drawn with a legend, the note is unchanged, axe is clean`, async ({ page }) => {
    await page.addInitScript((l) => {
      localStorage.setItem("lumen-tour-done", "1");
      localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: l, theme: "light" }, version: 0 }));
    }, lang);
    await page.goto("/");
    await testHooks(page);
    const note = NOTES[lang];
    await page.evaluate(async (content) => {
      const { useAppStore } = await (window as unknown as LumenTestWindow).__lumenTest.load("store/useStore");
      useAppStore.getState().setMode("source");
      useAppStore.getState().setContent(content);
      window.dispatchEvent(new Event("lumen-open-focus"));
    }, note);
    const bar = page.getByRole("group", { name: lang === "he" ? "מיקוד וקריאוּת" : "Focus and readability" });
    await expect(bar).toBeVisible();
    await page.getByTestId("focus-unit").selectOption("sentence");
    // Put the cursor in the second sentence.
    await page.locator(".cm-content").last().getByText(lang === "he" ? "יסודי" : "quickly", { exact: false }).first().click();
    await expect(page.locator(".cm-focus-dim").first()).toBeAttached();
    const bright = await page.locator(".cm-content").last().evaluate((el) => [...el.querySelectorAll(".cm-line")].map((l) => [...l.childNodes].filter((n) => !(n instanceof HTMLElement && n.classList.contains("cm-focus-dim"))).map((n) => n.textContent).join("")).join(""));
    expect(bright).toBe(lang === "he" ? "הוא עבד באופן יסודי במסגרת הפרויקט." : "She quickly utilized the tool.");

    await page.getByTestId("focus-hemingway").check();
    const legend = page.getByTestId("focus-legend");
    await expect(legend).toBeVisible();
    await expect(page.locator("[data-hw=passive]").first()).toBeAttached();
    await expect(page.getByTestId("focus-count-passive")).toContainText("1");
    // The legend sits on the side reading starts: right in Hebrew, left in English.
    const box = await legend.boundingBox();
    const width = page.viewportSize()!.width;
    if (lang === "he") expect(box!.x).toBeGreaterThan(width / 2);
    else expect(box!.x).toBeLessThan(width / 2);

    const content = await page.evaluate(async () => (await (window as unknown as LumenTestWindow).__lumenTest.load("store/useStore")).useAppStore.getState().doc.content);
    expect(content).toBe(note);

    await bar.hover();
    await page.addScriptTag({ content: AXE });
    const violations = await page.evaluate(async () => {
      const w = window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null }> }> } };
      const r = await w.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }, resultTypes: ["violations"] });
      return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
    });
    expect(violations).toEqual([]);
  });
}
