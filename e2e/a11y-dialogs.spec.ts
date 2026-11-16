import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
// @ts-expect-error — plain .mjs module without type declarations
import { DIALOGS } from "./dialogs.registry.mjs";

/**
 * Every modal dialog, opened for real (plan 10.1, W10.E8; research R5.2).
 * Each one is a native <dialog> (src/ui/Modal.tsx). For each, in English
 * and in Hebrew:
 *   - it is open as a modal (`:modal`) and focus is inside;
 *   - 30 Tab presses, and 30 Shift+Tab, never leave it;
 *   - the page behind is inert: the point at the editor's centre belongs to the dialog;
 *   - the focused element is not hidden (WCAG 2.4.11): its centre is on screen and on top;
 *   - axe finds no serious or critical violation in it;
 *   - Escape closes it (unless it must not be dismissed) and focus is back where it was.
 * The registry (e2e/dialogs.registry.mjs) lists every dialog; one that needs
 * a state this spec cannot make yet is a `fixme` with its reason.
 */

type Entry = { file: string; command?: string; keys?: string; then?: string; firstRun?: boolean; embedded?: boolean; guarded?: boolean; fixme?: string };

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

async function boot(page: Page, lang: "en" | "he", firstRun = false) {
  await page.addInitScript(
    ([l, first]) => {
      if (!first) localStorage.setItem("lumen-tour-done", "1");
      localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: l, theme: "light" }, version: 0 }));
    },
    [lang, firstRun] as const,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  if (!firstRun) await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
}

async function open(page: Page, d: Entry) {
  if (d.keys) await page.keyboard.press(d.keys);
  else if (d.command) {
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id } })), d.command);
  }
  const dialog = page.locator("dialog.lumen-modal").last();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  if (d.then) {
    await dialog.getByTestId(d.then).click();
    await expect(page.locator("dialog.lumen-modal")).toHaveCount(2);
  }
  return page.locator("dialog.lumen-modal").last();
}

const focusInside = (page: Page) =>
  page.evaluate(() => {
    const top = [...document.querySelectorAll("dialog.lumen-modal")].pop();
    return !!top && top.contains(document.activeElement);
  });

for (const lang of ["en", "he"] as const) {
  test.describe(`every modal dialog (${lang})`, () => {
    for (const d of DIALOGS as Entry[]) {
      test(d.file, async ({ page }) => {
        // skip-reason: a dialog that needs a state this spec cannot make yet; each entry's reason is its `fixme` in e2e/dialogs.registry.mjs and is the test's annotation | task: W10.E8 | until: 2027-05-16
        test.fixme(!!d.fixme, d.fixme);
        test.setTimeout(60_000);
        await boot(page, lang, !!d.firstRun);
        // The opener: the editor, where the shortcut is pressed or the command is run from.
        if (!d.firstRun) await page.locator(".cm-content").first().click();
        const before = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? "");
        const dialog = await open(page, d);

        // A modal in the top layer, focus inside.
        expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
        await expect.poll(() => focusInside(page)).toBe(true);

        // Tab and Shift+Tab stay inside.
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press("Tab");
          expect(await focusInside(page), `Tab ${i + 1}`).toBe(true);
        }
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press("Shift+Tab");
          expect(await focusInside(page), `Shift+Tab ${i + 1}`).toBe(true);
        }

        // The page behind is inert: what is under the editor's centre is the dialog.
        const covered = await page.evaluate(() => {
          const top = [...document.querySelectorAll("dialog.lumen-modal")].pop()!;
          const ed = document.querySelector(".cm-content");
          if (!ed) return true;
          const r = ed.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 200));
          return !hit || top.contains(hit);
        });
        expect(covered).toBe(true);

        // The focused element is not hidden (2.4.11).
        const seen = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el) return false;
          el.scrollIntoView({ block: "nearest" });
          const r = el.getBoundingClientRect();
          const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
          const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
          const hit = document.elementFromPoint(x, y);
          return r.width > 0 && r.height > 0 && !!hit && (el === hit || el.contains(hit) || hit.contains(el));
        });
        expect(seen).toBe(true);

        // axe on the dialog: no serious or critical violation.
        await page.evaluate(AXE);
        const violations = await page.evaluate(async () => {
          const w = window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; help: string }> }> } };
          const top = [...document.querySelectorAll("dialog.lumen-modal")].pop()!;
          const r = await w.axe.run(top, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] });
          return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.impact} ${v.id}: ${v.help}`);
        });
        expect(violations).toEqual([]);

        // Escape closes it, and focus is back where it was.
        if (d.guarded) return;
        const count = await page.locator("dialog.lumen-modal").count();
        await page.keyboard.press("Escape");
        await expect(page.locator("dialog.lumen-modal")).toHaveCount(count - 1);
        if (!d.firstRun) {
          const after = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? "");
          expect(after).toBe(before);
        }
      });
    }
  });
}
