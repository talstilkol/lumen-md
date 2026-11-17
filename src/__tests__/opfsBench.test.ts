/**
 * W11.Q11: the OPFS vs IndexedDB benchmark's inputs (scripts/perf/opfs-bench.mjs).
 * The runs themselves need browsers (Chromium here, all three on the Mac).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error — plain .mjs script without type declarations
import { fileAt, makeFiles, median, sizes, spans, TARGETS } from "../../scripts/perf/opfs-bench.mjs";

describe("opfs-bench (W11.Q11)", () => {
  it("10,000 file sizes around a 2 KB median, the same every run", () => {
    const s = sizes(10_000) as number[];
    expect(s).toHaveLength(10_000);
    expect(Math.abs(median(s) - 2048)).toBeLessThan(2048 * 0.05);
    expect(sizes(10_000)).toEqual(s);
    expect(Math.min(...s)).toBeGreaterThanOrEqual(64);
  });

  it("cuts the files from real text (the repo's docs), in 100 folders", () => {
    const pool = readFileSync("docs/src/content/docs/editor/acr.md", "utf8").repeat(50);
    const files = makeFiles(500, pool) as Array<{ path: string; text: string }>;
    expect(new Set(files.map((f) => f.path.split("/")[0])).size).toBe(100);
    for (const f of files.slice(0, 20)) expect(pool).toContain(f.text);
  });

  it("checks the task's targets and does not move them", () => {
    expect(TARGETS).toEqual({ chromiumReadMs: 1500, longTasks: 0 });
  });

  it("measures the worker path the app uses: the page writes through vault-io.worker", () => {
    const page = readFileSync("scripts/perf/opfs-bench.page.ts", "utf8");
    expect(page).toContain('new Worker("./vault-io.worker.js", { type: "module" })');
    expect(readFileSync("scripts/perf/opfs-bench.mjs", "utf8")).toContain('src/storage/vault/vault-io.worker.ts');
    expect(readFileSync("src/storage/vault/opfsSyncWrite.ts", "utf8")).toContain('new Worker(new URL("./vault-io.worker.ts", import.meta.url), { type: "module"');
  });

  it("reports both OPFS read paths: the main thread one by one, and the worker in the app's batches", () => {
    const page = readFileSync("scripts/perf/opfs-bench.page.ts", "utf8");
    expect(page).toMatch(/return \{ opfsWrite, opfsRead, opfsReadWorker, idbWrite, idbRead, idbReadAll, readBatch: READ_BATCH, heapMB: heap \}/);
    expect(page).toContain('import { READ_BATCH } from "../../src/storage/vault/opfsSyncWrite"');
    expect(page).toContain('op: "read", paths');
    // The app's backend reads through the worker first (src/storage/vault/opfs.ts).
    expect(readFileSync("src/storage/vault/opfs.ts", "utf8")).toContain("readPrimary: readInWorker");
  });

  it("streams the files to the page: the pool once and 2 numbers per file, cut there as in Node (10k crash, L8)", () => {
    const pool = readFileSync("docs/src/content/docs/editor/acr.md", "utf8").repeat(50);
    const sp = spans(10_000, pool.length) as number[];
    expect(sp).toHaveLength(20_000);
    const files = makeFiles(10_000, pool) as Array<{ path: string; text: string }>;
    for (const i of [0, 1, 99, 4321, 9999]) expect(fileAt(pool, sp, i)).toEqual(files[i]);
    // What crosses page.evaluate: the pool and the spans, not 10,000 texts.
    const sent = JSON.stringify({ pool, spans: sp }).length;
    const before = JSON.stringify(files).length;
    expect(sent).toBeLessThan(before / 4);
    const driver = readFileSync("scripts/perf/opfs-bench.mjs", "utf8");
    expect(driver).toContain("window.opfsBench(a), { pool, spans: sp, concurrency: 8 }");
    expect(driver).not.toMatch(/makeFiles\(n\)/);
    const page = readFileSync("scripts/perf/opfs-bench.page.ts", "utf8");
    expect(page).toContain('import { fileAt as fileAtJs } from "./opfs-bench-files.mjs"');
    expect(page).not.toMatch(/files\.(slice|length|map)/);
  });

  it("reports the peak resident size and the phase a crash happened in", () => {
    const driver = readFileSync("scripts/perf/opfs-bench.mjs", "utf8");
    expect(driver).toContain("results[engine].peakRssMB");
    expect(driver).toContain('page.on("crash"');
    expect(driver).toContain("the page crashed during ${crashed}");
    expect(readFileSync("scripts/perf/opfs-bench.page.ts", "utf8")).toContain("opfs-bench phase: ");
  });
});
