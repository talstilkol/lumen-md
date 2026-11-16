/**
 * W11.Q4: the ceiling is calibrated by measurement. scripts/perf/wysiwyg-ceiling.mjs
 * turns e2e/wysiwyg-ceiling-calibrate.spec.ts's report into the ceiling the
 * numbers support, and --check fails when the ceiling in the code is looser.
 * The numbers below are made-up fixtures for the logic; the real run is in
 * Chromium with Milkdown (npm run perf:wysiwyg-ceiling).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — a plain .mjs script
import { KEY_TO_PAINT_P95_MS, OPEN_MS, supportedCeiling } from "../../scripts/perf/wysiwyg-ceiling.mjs";
import { WYSIWYG_MAX_BLOCKS, WYSIWYG_MAX_BYTES } from "../editor/wysiwygCeiling";

const KB = 1024;
const pt = (kb: number, openMs: number, keyToPaintP95: number) => ({ bytes: kb * KB, blocks: kb * 4, openMs, keyToPaintP95 });

describe("the supported WYSIWYG ceiling", () => {
  it("is the largest size below the first one that types or opens too slowly", () => {
    const r = supportedCeiling({ cpuSlowdown: 4, points: [pt(300, 700, 20), pt(50, 100, 8), pt(450, 1100, 34), pt(200, 400, 14), pt(600, 900, 25)] });
    expect(r.bytes).toBe(300 * KB);
    expect(r.blocks).toBe(1200);
    expect(r.firstUnfit).toEqual({ bytes: 450 * KB, why: `keypress → paint p95 34 ms ≥ ${KEY_TO_PAINT_P95_MS}` });
    // A fit size after an unfit one does not count: the ceiling is one number, below the first failure.
    expect(r.fit).toEqual([50 * KB, 200 * KB, 300 * KB]);
  });
  it("a slow open alone makes a size unfit", () => {
    const r = supportedCeiling({ cpuSlowdown: 4, points: [pt(100, 300, 10), pt(200, OPEN_MS, 12)] });
    expect(r.bytes).toBe(100 * KB);
    expect(r.firstUnfit?.why).toMatch(/^open 1500 ms/);
  });
  it("no fit size gives no ceiling; every size fit says so", () => {
    expect(supportedCeiling({ cpuSlowdown: 4, points: [pt(50, 2000, 50)] }).bytes).toBeNull();
    expect(supportedCeiling({ cpuSlowdown: 4, points: [pt(50, 10, 5), pt(900, 900, 30)] }).firstUnfit).toBeNull();
  });
  it("refuses a report without points or with a missing number", () => {
    expect(() => supportedCeiling({ cpuSlowdown: 4, points: [] })).toThrow(/no points/);
    expect(() => supportedCeiling({ cpuSlowdown: 4, points: [{ bytes: 1, blocks: 1, openMs: Number.NaN, keyToPaintP95: 1 }] })).toThrow(/openMs/);
  });
});

describe("--check against the ceiling in src/editor/wysiwygCeiling.ts", () => {
  const run = (points: unknown[]) => {
    const dir = mkdtempSync(join(tmpdir(), "ceiling-"));
    const file = join(dir, "r.json");
    writeFileSync(file, JSON.stringify({ cpuSlowdown: 4, points }));
    try {
      return { code: 0, out: execFileSync(process.execPath, ["scripts/perf/wysiwyg-ceiling.mjs", "--report", file, "--check"], { encoding: "utf8", stdio: "pipe" }) };
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      return { code: err.status, out: err.stdout + err.stderr };
    }
  };
  const kb = WYSIWYG_MAX_BYTES / KB;
  it("fails when the measurement supports less than the code allows", () => {
    const r = run([{ bytes: (kb - 100) * KB, blocks: WYSIWYG_MAX_BLOCKS, openMs: 100, keyToPaintP95: 10 }, { bytes: kb * KB, blocks: WYSIWYG_MAX_BLOCKS + 1, openMs: 100, keyToPaintP95: 40 }]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/above what the measurement supports/);
  });
  it("passes when the ceiling is at or below the supported size", () => {
    const r = run([{ bytes: kb * KB, blocks: WYSIWYG_MAX_BLOCKS, openMs: 600, keyToPaintP95: 20 }, { bytes: 2 * kb * KB, blocks: 2 * WYSIWYG_MAX_BLOCKS, openMs: 2000, keyToPaintP95: 60 }]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/supported ceiling: 307200 B/);
  });
  it("without a report it says the calibration is owed; --check then fails (review 11, L13), the plain report does not", () => {
    const out = execFileSync(process.execPath, ["scripts/perf/wysiwyg-ceiling.mjs", "--report", "no/such.json"], { encoding: "utf8" });
    expect(out).toMatch(/calibration is owed/);
    let code = 0;
    let text = "";
    try {
      execFileSync(process.execPath, ["scripts/perf/wysiwyg-ceiling.mjs", "--report", "no/such.json", "--check"], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      code = err.status;
      text = err.stdout + err.stderr;
    }
    expect(code).toBe(1);
    expect(text).toMatch(/calibration is owed[\s\S]*nothing was measured/);
  });
});
