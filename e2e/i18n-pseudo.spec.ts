import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { testHooks, type LumenTestWindow } from "./_lumen";
import { pseudoScan, type PseudoFinding } from "./_pseudoScan";

/**
 * Pseudo-localisation (plan W13.I1): the app in en-XA (every string accented,
 * 40 % longer, inside ⟦ ⟧) and ar-XB (the same, right to left), on 20
 * surfaces. A visible string without brackets never went through t()
 * (hard-coded); a bracketed label whose box clips it is cut off. Both lists
 * must be empty. The locales are built from the English by
 * scripts/i18n-pseudo.mjs into .pseudo/ (never shipped) and installed
 * through the test hooks under codes the language picker doesn't list.
 *
 * Needs the dev server or a VITE_E2E=1 build (the test hooks), like the
 * other specs that use e2e/_lumen.ts.
 */

const ROOT = join(__dirname, "..");
execFileSync(process.execPath, [join(ROOT, "scripts/i18n-pseudo.mjs")], { cwd: ROOT, stdio: "pipe" });
const PSEUDO = {
  "en-XA": JSON.parse(readFileSync(join(ROOT, ".pseudo/en-XA.json"), "utf8")) as { dir: "ltr" | "rtl"; strings: Record<string, string> },
  "ar-XB": JSON.parse(readFileSync(join(ROOT, ".pseudo/ar-XB.json"), "utf8")) as { dir: "ltr" | "rtl"; strings: Record<string, string> },
};

/** What isn't UI text: the note itself, file and note names, code. */
const IGNORE = [".cm-editor", ".cm-content", "[data-user-content]", "[data-path]", ".tree-item-name", ".file-name", ".tab-title", "pre", "code"];

const run = (page: Page, id: string) => page.evaluate((cmd) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cmd } })), id);
const dialog = '[role="dialog"]';

/** The 20 surfaces: the main screen, then dialogs and panels opened the way a user opens them. */
const SURFACES: Array<{ name: string; open?: (page: Page) => Promise<unknown>; scope?: string }> = [
  { name: "main screen" },
  { name: "command palette", open: (p) => p.keyboard.press("ControlOrMeta+k"), scope: dialog },
  { name: "search", open: (p) => run(p, "view.search"), scope: dialog },
  { name: "keyboard shortcuts", open: (p) => p.keyboard.press("ControlOrMeta+/"), scope: dialog },
  { name: "settings", open: (p) => run(p, "settings.open"), scope: dialog },
  { name: "setup", open: (p) => run(p, "help.setup"), scope: dialog },
  { name: "what's new", open: (p) => run(p, "help.whatsNew"), scope: dialog },
  { name: "credits", open: (p) => run(p, "help.credits"), scope: dialog },
  { name: "usage", open: (p) => run(p, "help.usage"), scope: dialog },
  { name: "feedback", open: (p) => run(p, "help.feedback"), scope: dialog },
  { name: "accessibility statement", open: (p) => run(p, "help.a11yStatement"), scope: dialog },
  { name: "version history", open: (p) => run(p, "view.versionHistory"), scope: dialog },
  { name: "properties", open: (p) => run(p, "view.properties") },
  { name: "network monitor", open: (p) => run(p, "privacy.networkMonitor"), scope: dialog },
  { name: "backups", open: (p) => run(p, "vault.backups"), scope: dialog },
  { name: "import", open: (p) => run(p, "vault.import"), scope: dialog },
  { name: "reading options", open: (p) => run(p, "view.readingOptions") },
  { name: "plugins", open: (p) => run(p, "view.plugins"), scope: dialog },
  { name: "trusted repositories", open: (p) => run(p, "settings.trustedRepos"), scope: dialog },
  { name: "graph view", open: (p) => run(p, "view.graphView") },
];

async function boot(page: Page, code: keyof typeof PSEUDO) {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: "en" }, version: 0 }));
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
  await testHooks(page);
  const { dir, strings } = PSEUDO[code];
  await page.evaluate(
    async ([c, s, d]) => {
      const i18n = await (window as unknown as LumenTestWindow).__lumenTest.load("i18n/index");
      i18n.installBundle(c, s, d);
      // What the language picker does: the store's setLocale applies the bundle (now in memory) and re-renders.
      const store = await (window as unknown as LumenTestWindow).__lumenTest.load("store/useStore");
      store.useAppStore.getState().setLocale(c as never);
    },
    [code, strings, dir] as const,
  );
  await expect(page.locator("html")).toHaveAttribute("dir", dir);
  await expect(page.locator("html")).toHaveAttribute("lang", code);
}

const report = (fs: PseudoFinding[]) => fs.map((f) => `  ${f.kind}: “${f.text}” at ${f.where}`).join("\n");

for (const code of ["en-XA", "ar-XB"] as const) {
  test(`pseudo-locale ${code}: 0 hard-coded strings and 0 cut-off labels on ${SURFACES.length} surfaces`, async ({ page }) => {
    test.setTimeout(180_000);
    expect(SURFACES).toHaveLength(20);
    await boot(page, code);
    const found: string[] = [];
    let scanned = 0;
    for (const s of SURFACES) {
      if (s.open) {
        await s.open(page);
        if (s.scope === dialog) await expect(page.locator(dialog).first()).toBeVisible({ timeout: 10_000 });
        else await page.waitForTimeout(400);
      }
      const findings = await page.evaluate(([scope, ignore]) => (window as unknown as { __pseudoScan: typeof pseudoScan }).__pseudoScan(scope, ignore), [s.scope ?? null, IGNORE] as const).catch(async () => {
        await page.evaluate(`window.__pseudoScan = ${pseudoScan.toString()}`);
        return page.evaluate(([scope, ignore]) => (window as unknown as { __pseudoScan: typeof pseudoScan }).__pseudoScan(scope, ignore), [s.scope ?? null, IGNORE] as const);
      });
      // A surface that shows no pseudo string at all did not open (or did not re-render): that is a failure too.
      const pseudoText = await page.evaluate((scope) => ((scope && document.querySelector(scope)) || document.body).textContent?.includes("⟦") ?? false, s.scope ?? null);
      if (!pseudoText) found.push(`— ${s.name}: no ⟦ string on the surface (did it open?)`);
      if (findings.length) found.push(`— ${s.name}\n${report(findings)}`);
      scanned++;
      if (s.open) {
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
      }
    }
    expect(scanned).toBe(20);
    expect(found, found.join("\n")).toEqual([]);
  });
}
