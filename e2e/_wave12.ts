import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { opfsWritable, vaultOrSkip } from "./_opfs";

/**
 * Shared steps of the wave-12 view specs (wave g6, Mac pack L5):
 * e2e/viz-wave12.spec.ts and e2e/graph-time-slider.spec.ts. A fresh app in
 * one locale, an OPFS vault seeded through the app's own index, a note set
 * in the editor, and axe over one element (the same rules as e2e/a11y.spec.ts).
 */

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

export type Violation = { id: string; impact: string | null; help: string; targets: string[] };

interface Probe {
  writeWorkspaceFile(path: string, content: string): Promise<void>;
}

/** Open the app in `locale` (he: RTL, en: LTR) with an empty OPFS vault; skips only where Playwright has no OPFS. */
export async function freshApp(page: Page, browserName: string, locale: "he" | "en"): Promise<void> {
  await page.addInitScript((loc) => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", JSON.stringify({ state: { locale: loc }, version: 0 }));
  }, locale);
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 20_000 });
  vaultOrSkip(await opfsWritable(page), browserName);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) await root.removeEntry(name, { recursive: true });
  });
}

/** Write vault files through the app's index (the path the app itself saves by). */
export async function seed(page: Page, files: Record<string, string>): Promise<void> {
  await page.evaluate(async (all) => {
    const m = await (window as unknown as { __lumen: { vaultIndex(): Promise<Probe> } }).__lumen.vaultIndex();
    for (const [p, c] of Object.entries(all)) await m.writeWorkspaceFile(p, c);
  }, files);
}

type View = { state: { doc: { length: number } }; dispatch(tr: unknown): void };

/** Replace the open note's text, as typing would (a userEvent "input" transaction). */
export async function setNote(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const el = document.querySelector(".cm-content") as (HTMLElement & { cmTile?: { root?: { view?: View } } }) | null;
    const view = el?.cmTile?.root?.view;
    view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t }, userEvent: "input" });
  }, text);
}

export const runCommand = (page: Page, id: string) => page.evaluate((cmd) => window.dispatchEvent(new CustomEvent("lumen-run-command", { detail: { id: cmd } })), id);

/** Serious and critical axe violations (WCAG 2.0/2.1 A + AA) inside `selector`. */
export async function axeBlocking(page: Page, selector: string): Promise<Violation[]> {
  await page.evaluate(AXE);
  return page.evaluate(async (sel) => {
    const w = window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }> }> } };
    const r = await w.axe.run({ include: [sel] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] });
    return r.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
  }, selector);
}
