/**
 * W11.Q11: the OPFS vs IndexedDB benchmark's inputs (scripts/perf/opfs-bench.mjs).
 * The runs themselves need browsers (Chromium here, all three on the Mac).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error — plain .mjs script without type declarations
import { makeFiles, median, sizes, TARGETS } from "../../scripts/perf/opfs-bench.mjs";

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
    expect(page).toMatch(/return \{ opfsWrite, opfsRead, opfsReadWorker, idbWrite, idbRead, idbReadAll, readBatch: READ_BATCH \}/);
    expect(page).toContain('import { READ_BATCH } from "../../src/storage/vault/opfsSyncWrite"');
    expect(page).toContain('op: "read", paths');
    // The app's backend reads through the worker first (src/storage/vault/opfs.ts).
    expect(readFileSync("src/storage/vault/opfs.ts", "utf8")).toContain("readPrimary: readInWorker");
  });
});
