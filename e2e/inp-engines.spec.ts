import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- plain ESM module, no types
import { engineReport, INP_BUDGET_MS } from "../scripts/perf/inpAttribution.mjs";

/**
 * Plan W13.V1 — INP in Chromium, Firefox and WebKit (Event Timing is Baseline
 * since Safari 26.2): the 20 interactions of e2e/inp-budget.spec.ts, no CPU
 * throttling (only Chromium can), the same budget everywhere: p75 ≤ 200 ms.
 * In Chromium the long animation frames (LoAF) of each slow interaction are
 * kept, so scripts/perf/inp-gate.mjs --engines names the file and function.
 * Runs only in the inp-chromium / inp-firefox / inp-webkit projects
 * (`npm run perf:inp`); writes reports/perf/inp-<engine>.json.
 */

const REPORT_DIR = join(import.meta.dirname, "..", "reports", "perf");

async function openNote(page: Page, path: string, text: string, expectText: string): Promise<void> {
  await page.evaluate(
    async ({ path, text }) => {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle(path, { create: true });
      const w = await (fh as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
      await w.write(text);
      await w.close();
      window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path } }));
    },
    { path, text },
  );
  await expect(page.locator(".cm-content").first()).toContainText(expectText, { timeout: 60_000 });
}

const settle = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

test("INP p75 ≤ 200 ms in this engine, with LoAF attribution where the engine has it", { tag: "@inpx" }, async ({ page, browserName }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", JSON.stringify({ state: { showWorkspace: true }, version: 0 }));
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 30_000 });
  await openNote(page, "inp-a.md", "# Note A\n\n- [ ] first task\n- [ ] second task\n\nSome text.\n", "Note A");
  await openNote(page, "inp-b.md", "# Note B\n\nOther text.\n", "Note B");
  const loafSupported = await page.evaluate(() => {
    const w = window as unknown as { __ev: unknown[]; __loaf: unknown[] };
    w.__ev = [];
    w.__loaf = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceEventTiming[]) if (e.interactionId) w.__ev.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "event", durationThreshold: 16, buffered: false } as PerformanceObserverInit);
    const types = (PerformanceObserver as unknown as { supportedEntryTypes?: string[] }).supportedEntryTypes ?? [];
    if (!types.includes("long-animation-frame")) return false;
    new PerformanceObserver((list) => {
      for (const f of list.getEntries() as unknown as Array<{ startTime: number; duration: number; blockingDuration: number; scripts: Array<{ sourceURL: string; sourceFunctionName: string; invoker: string; invokerType: string; duration: number }> }>)
        w.__loaf.push({ startTime: f.startTime, duration: f.duration, blockingDuration: f.blockingDuration, scripts: f.scripts.map((s) => ({ sourceURL: s.sourceURL, sourceFunctionName: s.sourceFunctionName, invoker: s.invoker, invokerType: s.invokerType, duration: s.duration })) });
    }).observe({ type: "long-animation-frame", buffered: false });
    return true;
  });

  const editor = page.locator(".cm-content").first();
  const tree = page.locator("aside.file-tree");
  const steps: Array<[string, () => Promise<void>]> = [
    ["palette: open", () => page.keyboard.press("ControlOrMeta+K")],
    ["palette: type", () => page.keyboard.type("t")],
    ["palette: next option", () => page.keyboard.press("ArrowDown")],
    ["palette: close", () => page.keyboard.press("Escape")],
    ["view: source", () => page.keyboard.press("ControlOrMeta+1")],
    ["view: split", () => page.keyboard.press("ControlOrMeta+2")],
    ["view: preview", () => page.keyboard.press("ControlOrMeta+3")],
    ["task: check in the preview", () => page.locator("[data-preview-root] input[type=checkbox]").first().click()],
    ["view: back to source", () => page.keyboard.press("ControlOrMeta+1")],
    ["note: open from the tree", () => tree.locator(".file-tree-name", { hasText: "inp-a.md" }).first().click()],
    ["note: switch to the other", () => tree.locator(".file-tree-name", { hasText: "inp-b.md" }).first().click()],
    ["editor: focus", () => editor.click()],
    ["editor: go to the end", () => page.keyboard.press("ControlOrMeta+End")],
    ["editor: type a letter", () => page.keyboard.type("x")],
    ["editor: new line", () => page.keyboard.press("Enter")],
    ["editor: delete", () => page.keyboard.press("Backspace")],
    ["editor: undo", () => page.keyboard.press("ControlOrMeta+Z")],
    ["search: open", () => page.keyboard.press("ControlOrMeta+Shift+F")],
    ["search: type", () => page.keyboard.type("n")],
    ["search: close", () => page.keyboard.press("Escape")],
  ];
  const starts: number[] = [];
  for (const [, act] of steps) {
    starts.push(await page.evaluate(() => performance.now()));
    await act();
    await settle(page);
  }
  await settle(page);
  const { ev, loaf } = await page.evaluate(() => {
    const w = window as unknown as { __ev: Array<{ start: number; duration: number }>; __loaf: unknown[] };
    return { ev: w.__ev, loaf: w.__loaf };
  });
  const interactions = steps.map(([name], i) => {
    const from = starts[i];
    const to = starts[i + 1] ?? Number.POSITIVE_INFINITY;
    const own = ev.filter((e) => e.start >= from && e.start < to);
    const worst = own.sort((a, b) => b.duration - a.duration)[0];
    // An interaction the engine did not report took under 16 ms.
    return { name, start: worst?.start ?? from, ms: worst ? worst.duration : 16 };
  });
  const run = { engine: browserName, loafSupported, interactions, loafs: loaf };
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, `inp-${browserName}.json`), JSON.stringify({ at: new Date().toISOString(), ...run }, null, 2) + "\n");
  const r = engineReport(run);
  expect(r.p75, `INP p75 in ${browserName}`).toBeLessThanOrEqual(INP_BUDGET_MS);
});
