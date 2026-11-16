import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { testHooks, type LumenTestWindow } from "./_lumen";

/**
 * Plan W12.S3 — the three-column conflict dialog in a real browser, in
 * English and in Hebrew (RTL). Acceptance:
 *   - a one-line conflict, a hand edit in the result editor, and "Apply
 *     merge" hands back exactly the edited text (what sync then saves);
 *   - Alt+ArrowDown / F7 / Alt+ArrowUp move focus between the hunks and wrap;
 *   - in RTL "mine" is the right-hand column;
 *   - axe finds no serious or critical violation in the dialog.
 * The dialog is opened through the app's own module (window.__lumenTest),
 * the way sync opens it when a pull finds a conflict.
 */

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const base = "# Title\nThe meeting is on Monday.\nmiddle\nmiddle 2\nmiddle 3\nmiddle 4\nmiddle 5\nEnd";
const local = "# Title\nThe meeting is on Tuesday.\nmiddle\nmiddle 2\nmiddle 3\nmiddle 4\nmiddle 5\nEnd mine";
const remote = "# Title\nThe meeting is on Wednesday.\nmiddle\nmiddle 2\nmiddle 3\nmiddle 4\nmiddle 5\nEnd theirs";
const edited = "# Title\nThe meeting is on Thursday.\nmiddle\nmiddle 2\nmiddle 3\nmiddle 4\nmiddle 5\nEnd both";

type Win = LumenTestWindow & { __conflictChoice?: unknown };

async function boot(page: Page, lang: "en" | "he") {
  await page.addInitScript((l) => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: l, theme: "light" }, version: 0 }));
  }, lang);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
  await testHooks(page);
}

async function openConflict(page: Page) {
  await page.evaluate(
    async ({ base, local, remote }) => {
      const w = window as unknown as Win;
      const m = await w.__lumenTest.load("sync/cloud/ConflictDialog");
      w.__conflictChoice = undefined;
      void m.openConflictDialog({ path: "notes/meeting.md", base, local, remote }).then((c) => {
        w.__conflictChoice = c;
      });
    },
    { base, local, remote },
  );
  const dialog = page.locator("dialog.lumen-modal").last();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

for (const lang of ["en", "he"] as const) {
  test.describe(`three-way conflict dialog (${lang})`, () => {
    test.beforeEach(async ({ page }) => boot(page, lang));

    test("mine, base and theirs per hunk; keyboard moves between hunks; a hand edit is what is saved", async ({ page }) => {
      const dialog = await openConflict(page);
      const hunks = dialog.getByTestId("conflict-hunk");
      await expect(hunks).toHaveCount(2);

      // The first hunk shows mine, base and theirs, in that order in the DOM.
      const cells = await hunks.first().evaluate((h) => [...h.children].slice(0, 3).map((c) => (c.textContent ?? "").trim()));
      expect(cells).toEqual(["The meeting is on Tuesday.", "The meeting is on Monday.", "The meeting is on Wednesday."]);

      // In RTL the first column (mine) is on the right; in LTR on the left.
      const [mineX, theirsX] = await hunks.first().evaluate((h) => {
        const c = [...h.children] as HTMLElement[];
        return [c[0].getBoundingClientRect().left, c[2].getBoundingClientRect().left];
      });
      if (lang === "he") expect(mineX).toBeGreaterThan(theirsX);
      else expect(mineX).toBeLessThan(theirsX);

      // Keyboard: Alt+ArrowDown → next, F7 wraps to the first, Alt+ArrowUp wraps back to the last.
      await hunks.first().focus();
      await page.keyboard.press("Alt+ArrowDown");
      await expect(hunks.nth(1)).toBeFocused();
      await page.keyboard.press("F7");
      await expect(hunks.first()).toBeFocused();
      await page.keyboard.press("Alt+ArrowUp");
      await expect(hunks.nth(1)).toBeFocused();

      // The result starts from the picks (mine), and a hand edit is what "Apply merge" hands back.
      const result = dialog.locator("#conflict-result");
      await expect(result).toHaveValue(local);
      await result.fill(edited);
      await dialog.locator("footer button").last().click();
      await expect(page.locator("dialog.lumen-modal")).toHaveCount(0);
      const choice = await page.evaluate(() => (window as unknown as Win).__conflictChoice);
      expect(choice).toEqual({ kind: "merged", content: edited });
    });

    test("axe: no serious or critical violation in the dialog", async ({ page }) => {
      await openConflict(page);
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
}
