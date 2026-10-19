import { test, expect, type Page } from "@playwright/test";

/**
 * Plan 10.3: the visual matrix of scripts/preview-visual.mjs (T24) as a CI
 * gate. Ten surfaces × English / Hebrew × dark / light = 40 screenshots,
 * each compared with its committed baseline (e2e-visual/baselines/) by
 * Playwright's pixel diff. An unintended change fails the "visual" job and
 * its artifact holds expected / actual / diff for every failing shot.
 *
 * A missing baseline fails too (playwright.visual.config.ts). Baselines
 * are refreshed on purpose by the "visual baselines" workflow, which runs
 * this file with --update-snapshots on CI's own chromium and commits the
 * result (CONTRIBUTING.md, "Visual baselines").
 */

type Surface = { id: string; open: (p: Page) => Promise<unknown>; ready: string };

const runCommand = (page: Page, id: string) =>
  page.evaluate((cmd) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cmd } })), id);

/**
 * The WYSIWYG surface shows this note instead of the welcome note. On the
 * current base, Milkdown 7.20 fails to parse lists (its list nodes store
 * `spread` as a string against a boolean-validated attribute, which
 * prosemirror-model 1.25 rejects), and the welcome note then renders empty
 * on some runs and in full on others. #252 carries the fix
 * (editor/milkdownListSpread.ts); until it is merged this fixture has no
 * lists, so the shot is the same on every run.
 */
const WYSIWYG_NOTE = [
  "# Visual fixture",
  "",
  "A paragraph with **bold**, *italic*, ~~struck~~, `code` and a [link](https://example.com).",
  "",
  "פסקה בעברית עם **הדגשה** ומילה באנגלית: Lumen.",
  "",
  "> A quoted line, for the block styles.",
  "",
  "```js",
  "const answer = 42;",
  "```",
  "",
  "| Item | Price |",
  "|:--|--:|",
  "| Milk | 5.90 |",
  "",
  "## Second heading",
  "",
  "The end.",
].join("\n");

async function openWysiwyg(page: Page): Promise<void> {
  await page.keyboard.press("Meta+1");
  const source = page.locator(".cm-content").first();
  await source.waitFor({ state: "visible" });
  await source.click();
  await page.evaluate((text) => {
    type View = { state: { doc: { length: number } }; dispatch(tr: unknown): void };
    const el = document.querySelector(".cm-content") as (HTMLElement & { cmTile?: { root?: { view?: View } } }) | null;
    const view = el?.cmTile?.root?.view;
    view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 }, userEvent: "input" });
  }, WYSIWYG_NOTE);
  await page.keyboard.press("Meta+4");
  await expect(page.locator(".ProseMirror").first()).toContainText("Visual fixture", { timeout: 30_000 });
  await expect(page.locator(".ProseMirror").first()).toContainText("The end.");
}

/** The surfaces of scripts/preview-visual.mjs, reached the same way. */
const SURFACES: Surface[] = [
  { id: "split", open: (p) => p.keyboard.press("Meta+2"), ready: ".prose-lumen h1" },
  { id: "source", open: (p) => p.keyboard.press("Meta+1"), ready: ".cm-content" },
  { id: "preview", open: (p) => p.keyboard.press("Meta+3"), ready: ".prose-lumen h1" },
  { id: "wysiwyg", open: openWysiwyg, ready: ".ProseMirror h1" },
  { id: "palette", open: (p) => p.keyboard.press("Meta+K"), ready: '[role="dialog"][aria-modal="true"] input' },
  { id: "shortcuts", open: (p) => p.keyboard.press("Meta+/"), ready: '[role="dialog"][aria-label="Keyboard Shortcuts"]' },
  { id: "plugins", open: (p) => runCommand(p, "view.plugins"), ready: '[data-testid="plugin-card"]' },
  { id: "templates", open: (p) => runCommand(p, "templates.open"), ready: '[data-testid="template-card"]' },
  { id: "ai-settings", open: (p) => p.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-open-ai-settings"))), ready: '[data-testid="exec-status-ollama"]' },
  { id: "ai-doctor", open: (p) => p.evaluate(() => window.dispatchEvent(new CustomEvent("lumen-open-ai-doctor"))), ready: '[data-testid="doctor-summary"]' },
];

const VARIANTS = [
  { id: "en-dark", locale: "en", theme: "dark" as const },
  { id: "en-light", locale: "en", theme: "light" as const },
  { id: "he-dark", locale: "he", theme: "dark" as const },
  { id: "he-light", locale: "he", theme: "light" as const },
];

/**
 * Parts of a surface that depend on the machine or the moment, not the
 * code, hidden under a flat mask: the hardware card of AI settings, the
 * storage quota of the AI doctor, and every "N ms" probe timing.
 */
const volatile = (page: Page) => [
  page.locator('[data-testid="hw-card"]'),
  page.locator('[data-testid="doctor-storage"]'),
  page.locator("span", { hasText: /^\d+ ms$/ }),
];

for (const v of VARIANTS) {
  test.describe(v.id, () => {
    test.use({ colorScheme: v.theme });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(({ locale, theme }) => {
        localStorage.clear();
        localStorage.setItem("lumen-tour-done", "1");
        localStorage.setItem("lumen-md", JSON.stringify({ state: { locale, theme }, version: 0 }));
      }, v);
      await page.goto("/");
      await page.locator(".cm-content, .ProseMirror").first().waitFor({ timeout: 30_000 });
      await expect(page.locator("html")).toHaveAttribute("dir", v.locale === "he" ? "rtl" : "ltr");
    });

    for (const s of SURFACES) {
      test(`${s.id} (${v.id})`, async ({ page }) => {
        await s.open(page);
        await page.locator(s.ready).first().waitFor({ state: "visible", timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
        await page.evaluate(() => document.fonts.ready);
        // The commonest RTL layout bug, checked on every shot: nothing wider than the viewport.
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "horizontal overflow").toBeLessThanOrEqual(1);
        await expect(page).toHaveScreenshot(`${s.id}--${v.id}.png`, {
          mask: volatile(page),
          maskColor: "#808080",
          // Identical runner, chromium and fonts give identical pixels; this
          // absorbs rasteriser noise only (≈ 250 px of 640×400). A one-line
          // CSS change moves far more.
          maxDiffPixelRatio: 0.001,
        });
      });
    }
  });
}
