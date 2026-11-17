import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { testHooks, type LumenTestWindow } from "./_lumen";

/**
 * Plan W12.S2 — "What I knew then" in a real browser, in Hebrew (RTL).
 * Acceptance:
 *   - moving the date slider changes the results: a word the open note had
 *     ten days ago is found as of then and not as of today;
 *   - the slider runs right to left in RTL (it inherits the page direction);
 *   - restoring one paragraph goes into the open note as one editor
 *     transaction, so a single Ctrl+Z takes it back out;
 *   - axe finds no serious or critical violation in the dialog.
 * History is seeded through the app's own history module (window.__lumenTest),
 * with the open note's history key, the way autosave files it.
 */

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** A word that is nowhere else in the app, so a hit can only be the seeded version. */
const OLD_WORD = "אלמוגנית";
const DAY = 86_400_000;

type Seeded = { key: string; now: string };

async function boot(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: "he", theme: "light" }, version: 0 }));
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
  await testHooks(page);
}

/** Two versions of the open note: ten days ago (with OLD_WORD in its first paragraph) and an hour ago (the editor's text now). */
async function seedHistory(page: Page): Promise<Seeded> {
  return page.evaluate(
    async ({ word, day }) => {
      const w = window as unknown as LumenTestWindow;
      const { useAppStore } = await w.__lumenTest.load("store/useStore");
      const h = await w.__lumenTest.load("storage/history");
      const doc = useAppStore.getState().doc as { name: string; workspaceName?: string | null; content: string };
      const key = h.historyKey(doc);
      const now = doc.content;
      const paras = now.split(/\n{2,}/);
      const old = [`${paras[0]} ${word}`, ...paras.slice(1)].join("\n\n");
      const t = Date.now();
      const a = await h.recordSnapshot(key, old, "manual", t - 10 * day);
      const b = await h.recordSnapshot(key, now, "manual", t - 3_600_000);
      if (!a || !b) throw new Error(`history refused the seed (vault ${JSON.stringify(h.getHistoryVault())})`);
      return { key, now };
    },
    { word: OLD_WORD, day: DAY },
  );
}

async function openAsOf(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: "view.asOf" } })));
  const dialog = page.locator("dialog.lumen-modal").last();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

test.describe("what I knew then (he, RTL)", () => {
  test.beforeEach(async ({ page }) => boot(page));

  test("the slider changes the results; a restored paragraph is one Ctrl+Z away", async ({ page }) => {
    test.setTimeout(60_000);
    const seeded = await seedHistory(page);
    const dialog = await openAsOf(page);
    const slider = dialog.getByTestId("as-of-slider");

    // RTL: the range input runs right to left.
    expect(await slider.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");

    // Today: the old word is not in the vault.
    await dialog.locator('input[type="search"]').fill(OLD_WORD);
    await expect(dialog.getByTestId("as-of-results").locator("button")).toHaveCount(0);

    // Back to the first day history covers (Home): the old version is found.
    await slider.focus();
    await page.keyboard.press("Home");
    await expect(dialog.getByTestId("as-of-results").locator("button")).toHaveCount(1, { timeout: 10_000 });
    // And forward again (End = today): gone again. The slider, not the query, changed the results.
    await page.keyboard.press("End");
    await expect(dialog.getByTestId("as-of-results").locator("button")).toHaveCount(0, { timeout: 10_000 });
    await page.keyboard.press("Home");
    await dialog.getByTestId("as-of-results").locator("button").first().click();

    // Read-only, under the "this is how it was" bar.
    await expect(dialog.getByTestId("as-of-banner")).toBeVisible();
    await expect(dialog.getByTestId("as-of-note")).toContainText(OLD_WORD);
    await expect(dialog.getByTestId("as-of-note")).toHaveAttribute("aria-readonly", "true");

    // Then vs now, and restore the changed paragraph into the open note.
    await dialog.locator("button[aria-pressed]").click();
    const restore = dialog.getByTestId("as-of-hunks").locator("button").first();
    await expect(restore).toBeEnabled();
    await restore.click();
    const editor = page.locator(".cm-content").first();
    await expect(editor).toContainText(OLD_WORD);

    // One transaction: close the dialog, one Ctrl+Z in the editor, and the note is as it was.
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.lumen-modal")).toHaveCount(0);
    await editor.click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor).not.toContainText(OLD_WORD);
    const text = await page.evaluate(async () => {
      const { useAppStore } = await (window as unknown as LumenTestWindow).__lumenTest.load("store/useStore");
      return (useAppStore.getState().doc as { content: string }).content;
    });
    expect(text).toBe(seeded.now);
  });

  test("axe: no serious or critical violation in the dialog", async ({ page }) => {
    await seedHistory(page);
    await openAsOf(page);
    await page.evaluate(AXE);
    const violations = await page.evaluate(async () => {
      const w = window as unknown as { axe: { run: (n: Element, o: unknown) => Promise<{ violations: Array<{ id: string; impact: string; help: string }> }> } };
      const top = [...document.querySelectorAll("dialog.lumen-modal")].pop()!;
      const r = await w.axe.run(top, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] });
      return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.impact} ${v.id}: ${v.help}`);
    });
    expect(violations).toEqual([]);
  });
});
