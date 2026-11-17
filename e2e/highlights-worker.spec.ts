import { test, expect, type Page } from "@playwright/test";
import { vaultOrSkip } from "./_opfs";
import { createPdfAnnotation, upsertAnnotationsNote } from "../src/pdf/annotations";

/**
 * Plan W10.C25 acceptance: "0 index building on the main thread" for All
 * highlights, checked by the spec instead of a person reading a trace (L6).
 * The vault gets 60 PDF highlights and the panel opens and lists them. Then:
 *
 *  - every engine: the index engine reports "worker", and the main thread
 *    never loaded the in-thread index (vaultIndexLocal, the only main-thread
 *    path to hub.ts's buildIndex): no resource of the window's timeline
 *    names it, in the dev server or a build (Vite names the chunk after it);
 *  - Chromium on the dev server: V8 itself is asked, with precise coverage
 *    (call counts, CDP Profiler.startPreciseCoverage) on the main thread, and
 *    hub.ts's `buildIndex` must have run 0 times there. (A build minifies the
 *    names, and CDP is Chromium's; elsewhere this part is not asserted and
 *    the run says so in an annotation.)
 *
 * The control test removes `Worker` before the app starts, so the app falls
 * back to its in-thread engine: there both probes must see it, or they
 * could not see a regression.
 */

const NOW = new Date("2026-11-10T08:00:00Z");
const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const N = 60;

interface Coverage {
  result: Array<{ url: string; functions: Array<{ functionName: string; ranges: Array<{ count: number }> }> }>;
}

async function seed(page: Page): Promise<boolean> {
  const notes = Array.from({ length: 6 }, (_, d) => {
    const anns = Array.from({ length: N / 6 }, (_, i) => createPdfAnnotation({ id: uuid(d * 100 + i), source: `doc${d}.pdf`, page: (i % 3) + 1, text: `Highlighted words ${d}-${i} on this page.`, start: 0, end: 10, now: NOW }));
    return { name: `doc${d}.pdf.md`, text: upsertAnnotationsNote(null, `doc${d}.pdf`, anns, { title: `Highlights — doc${d}.pdf`, page: (n) => `p. ${n}`, empty: "_none_" }) };
  });
  return page.evaluate(async (files) => {
    try {
      const root = await navigator.storage.getDirectory();
      for (const f of files) {
        const fh = await root.getFileHandle(f.name, { create: true });
        const h = fh as unknown as { createWritable?: () => Promise<FileSystemWritableFileStream> };
        if (typeof h.createWritable !== "function") return false;
        const w = await h.createWritable();
        await w.write(f.text);
        await w.close();
      }
      return true;
    } catch {
      return false;
    }
  }, notes);
}

interface Probe {
  engine: string;
  /** Window-timeline resources that are the in-thread index. */
  localIndexLoaded: string[];
  /** Chromium on the dev server: main-thread buildIndex calls and whether hub.ts was there to count; else null. */
  v8: { buildIndexCalls: number; hubLoaded: boolean } | null;
}

/** Open All highlights and read the probes. */
async function openPanel(page: Page, browserName: string): Promise<Probe> {
  const useV8 = browserName === "chromium" && !process.env.PLAYWRIGHT_BASE_URL;
  const cdp = useV8 ? await page.context().newCDPSession(page) : null;
  if (cdp) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
  } else test.info().annotations.push({ type: "probe", description: "V8 call counts not read: CDP is Chromium's, and a build minifies the names; the engine and resource checks ran" });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await page.keyboard.type("All highlights");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("highlights-count")).toContainText(`${N} of ${N}`, { timeout: 30_000 });
  let v8: Probe["v8"] = null;
  if (cdp) {
    const cov = (await cdp.send("Profiler.takePreciseCoverage")) as unknown as Coverage;
    await cdp.send("Profiler.stopPreciseCoverage");
    const hub = cov.result.filter((s) => /\/src\/highlights\/hub\.ts(\?|$)/.test(s.url));
    v8 = { hubLoaded: hub.length > 0, buildIndexCalls: hub.flatMap((s) => s.functions.filter((f) => f.functionName === "buildIndex")).reduce((a, f) => a + (f.ranges[0]?.count ?? 0), 0) };
  }
  const { engine, localIndexLoaded } = await page.evaluate(async () => {
    const m = await (window as unknown as { __lumen: { vaultIndex(): Promise<{ indexStats(): Promise<{ engine: string }> }> } }).__lumen.vaultIndex();
    return {
      engine: (await m.indexStats()).engine,
      localIndexLoaded: performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /vaultIndexLocal/.test(n)),
    };
  });
  return { engine, localIndexLoaded, v8 };
}

test.describe("All highlights builds its index in the vault worker (W10.C25)", () => {
  test("the main thread never builds the index; the engine is the worker", async ({ page, browserName }) => {
    await page.addInitScript(() => localStorage.setItem("lumen-tour-done", "1"));
    await page.goto("/");
    await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 30_000 });
    vaultOrSkip(await seed(page), browserName);
    const r = await openPanel(page, browserName);
    expect(r.engine).toBe("worker");
    expect(r.localIndexLoaded, "the in-thread index loaded on the main thread").toEqual([]);
    if (r.v8) {
      // hub.ts is on the main thread (the panel's search and tags), so a call would be counted.
      expect(r.v8.hubLoaded).toBe(true);
      expect(r.v8.buildIndexCalls, "buildIndex calls on the main thread").toBe(0);
    }
  });

  test("control: with no Worker the app indexes in-thread, and the same probes see it", async ({ page, browserName }) => {
    await page.addInitScript(() => {
      localStorage.setItem("lumen-tour-done", "1");
      // The vault index falls back to its in-thread engine when Worker is missing (workspaceIndex.createEngine).
      delete (window as unknown as { Worker?: unknown }).Worker;
    });
    await page.goto("/");
    await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 30_000 });
    vaultOrSkip(await seed(page), browserName);
    const r = await openPanel(page, browserName);
    expect(r.engine).toBe("local");
    expect(r.localIndexLoaded.length).toBeGreaterThan(0);
    if (r.v8) expect(r.v8.buildIndexCalls).toBeGreaterThan(0);
  });
});
