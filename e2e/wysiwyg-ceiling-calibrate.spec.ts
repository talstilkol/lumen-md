import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { countBlocks } from "../src/editor/wysiwygCeiling";
import { noteOfSize, quantile } from "./perf/probes";

/**
 * W11.Q4: calibrate the WYSIWYG ceiling by measurement. In Chromium with the
 * CPU 4× slower (as e2e/inp-budget.spec.ts), each size of ordinary Markdown
 * (English and Hebrew, headings, links, tasks, code) is opened in WYSIWYG.
 * A note over the current ceiling is opened with "open anyway". Each size
 * records:
 * - the time from the open event to the first ProseMirror paint;
 * - keypress → paint p95 over 60 keystrokes at the end.
 * The results go to reports/perf/wysiwyg-ceiling.json, which
 * `node scripts/perf/wysiwyg-ceiling.mjs --check` reads to say whether the
 * ceiling in src/editor/wysiwygCeiling.ts is supported.
 *
 *   npm run perf:wysiwyg-ceiling
 *
 * Only in the "calibrate" project (@calibrate), never in PR runs.
 */

const CPU_SLOWDOWN = 4;
const SIZES_KB = [50, 100, 200, 300, 450, 600, 900];
const points: Array<{ bytes: number; blocks: number; openMs: number; keyToPaintP95: number }> = [];

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lumen-tour-done", "1");
    localStorage.setItem("lumen-md", JSON.stringify({ state: { showWorkspace: true }, version: 0 }));
  });
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 30_000 });
});

async function slowDown(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
}

async function keyToPaintP95(page: Page, n = 60): Promise<number> {
  await page.evaluate(() => {
    const times: number[] = [];
    (window as unknown as { __k2p: number[] }).__k2p = times;
    document.addEventListener(
      "keydown",
      (e) => {
        const t0 = e.timeStamp;
        requestAnimationFrame(() => {
          const ch = new MessageChannel();
          ch.port1.onmessage = () => times.push(performance.now() - t0);
          ch.port2.postMessage(0);
        });
      },
      { capture: true },
    );
  });
  for (let i = 0; i < n; i++) {
    await page.keyboard.press(i % 10 === 9 ? "Enter" : "a");
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  }
  const times = await page.evaluate(() => (window as unknown as { __k2p: number[] }).__k2p);
  expect(times.length).toBeGreaterThanOrEqual(Math.floor(n * 0.95));
  return quantile(times, 0.95);
}

for (const kb of SIZES_KB) {
  test(`WYSIWYG at ${kb} KB: open time and keypress → paint p95 (CPU ${CPU_SLOWDOWN}× slower)`, { tag: "@calibrate" }, async ({ page }) => {
    test.setTimeout(600_000);
    const text = noteOfSize(kb * 1024);
    const path = `ceiling-${kb}.md`;
    await page.keyboard.press("ControlOrMeta+4");
    await slowDown(page);
    const t0 = await page.evaluate(
      async ({ path, text }) => {
        const root = await navigator.storage.getDirectory();
        const fh = await root.getFileHandle(path, { create: true });
        const w = await (fh as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
        await w.write(text);
        await w.close();
        const start = performance.now();
        window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path } }));
        return start;
      },
      { path, text },
    );
    const notice = page.getByTestId("wysiwyg-ceiling-notice");
    const prose = page.locator(".ProseMirror").first();
    await expect(notice.or(prose)).toBeVisible({ timeout: 300_000 });
    let start = t0;
    if (await notice.isVisible()) {
      start = await page.evaluate(() => performance.now());
      await notice.getByRole("button").click();
    }
    await expect(prose).toContainText("Section 0", { timeout: 300_000 });
    const openMs = Math.round((await page.evaluate(() => new Promise<number>((r) => requestAnimationFrame(() => r(performance.now()))))) - start);
    await prose.click();
    await page.keyboard.press("ControlOrMeta+End");
    const p95 = Math.round((await keyToPaintP95(page)) * 10) / 10;
    points.push({ bytes: kb * 1024, blocks: countBlocks(text), openMs, keyToPaintP95: p95 });
    test.info().annotations.push({ type: "perf", description: `${kb} KB: open ${openMs} ms, keypress → paint p95 ${p95} ms` });
  });
}

test.afterAll(() => {
  if (!points.length) return;
  const dir = join(__dirname, "..", "reports", "perf");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "wysiwyg-ceiling.json"), JSON.stringify({ at: new Date().toISOString(), cpuSlowdown: CPU_SLOWDOWN, points }, null, 2) + "\n");
});
