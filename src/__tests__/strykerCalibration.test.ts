/**
 * W11.Q9 (research R5.9): the Stryker calibration of the home-grown mutation
 * runner. The config (stryker/stryker.calibrate.json) is checked as a
 * dry-run can check it without Stryker installed: what it mutates exists,
 * its vitest config runs exactly the tests targets.json lists for those
 * modules, incremental mode is on, and nothing is loosened. The comparison
 * (scripts/mutation/calibrate.mjs) is tested on reports in Stryker's JSON
 * schema written for this test (synthetic: a handful of mutants with known
 * statuses), since no real Stryker run exists yet.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { calibrate, ourScores, strykerScores, TOLERANCE } from "../../scripts/mutation/calibrate.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { checkReceipt } from "../../scripts/mutation/check.mjs";

const read = (p: string) => readFileSync(p, "utf8");
const config = JSON.parse(read("stryker/stryker.calibrate.json"));
const targets = JSON.parse(read("scripts/mutation/targets.json"));
const MODULES = ["src/sync/gitMerge.ts", "src/sync/e2ee/keyring.ts", "src/storage/zip.ts"];

const mutants = (statuses: Record<string, number>) => Object.entries(statuses).flatMap(([status, n]) => Array.from({ length: n }, (_, i) => ({ id: `${status}${i}`, status })));

describe("the Stryker calibration config (W11.Q9)", () => {
  it("mutates the three modules, which exist and have tests in targets.json", () => {
    expect(config.mutate).toEqual(MODULES);
    for (const m of MODULES) {
      expect(existsSync(m), m).toBe(true);
      expect(targets.modules[m]?.length, m).toBeGreaterThan(0);
      for (const t of targets.modules[m]) expect(existsSync(t.file), t.file).toBe(true);
    }
  });

  it("uses the vitest runner, per-test coverage and incremental mode, and loosens nothing", () => {
    expect(config.testRunner).toBe("vitest");
    expect(config.plugins).toEqual(["@stryker-mutator/vitest-runner"]);
    expect(config.coverageAnalysis).toBe("perTest");
    expect(config.incremental).toBe(true);
    expect(config.incrementalFile).toMatch(/^reports\/mutation\//);
    expect(config.thresholds).toEqual({ high: 80, low: 60, break: null });
    // The weekly config is untouched.
    expect(JSON.parse(read("stryker/stryker.config.json")).mutate).toEqual(["src/text/hebrew.ts", "src/build/cspEndpoints.ts"]);
  });

  it("its vitest config runs exactly the test files targets.json lists for those modules", () => {
    expect(config.vitest.configFile).toBe("stryker/vitest.calibrate.config.mts");
    const src = read(config.vitest.configFile);
    expect(src).toContain('export const CALIBRATED = ["src/sync/gitMerge.ts", "src/sync/e2ee/keyring.ts", "src/storage/zip.ts"];');
    expect(src).toContain("targets.modules[m]");
    expect(src).toContain('setupFiles: ["src/__tests__/setup.ts"]');
  });
});

describe("scripts/mutation/calibrate.mjs (W11.Q9)", () => {
  it("scores a Stryker report the way Stryker does: detected over detected + undetected", () => {
    const report = {
      schemaVersion: "2",
      files: {
        "src/sync/gitMerge.ts": { language: "typescript", mutants: mutants({ Killed: 70, Timeout: 5, Survived: 20, NoCoverage: 5, CompileError: 9, Ignored: 3 }) },
        "C:\\repo\\src\\storage\\zip.ts": { language: "typescript", mutants: mutants({ CompileError: 2 }) },
      },
    };
    const s = strykerScores(report);
    expect(s["src/sync/gitMerge.ts"]).toEqual({ score: 75, mutants: 112, detected: 75, undetected: 25, invalid: 12 });
    expect(s["src/storage/zip.ts"].score).toBeNull();
  });

  it("marks ours unverified when it is more than 5 points from Stryker's, and says what was not measured", () => {
    expect(TOLERANCE).toBe(5);
    const ours = { "src/sync/gitMerge.ts": { score: 81, sampled: 80, mutants: 300, runner: "vitest" }, "src/sync/e2ee/keyring.ts": { score: 83.8, sampled: 80, mutants: 440, runner: "shim" } };
    const stryker = { "src/sync/gitMerge.ts": { score: 75, mutants: 112 }, "src/sync/e2ee/keyring.ts": { score: 80, mutants: 400 } };
    const r = calibrate(MODULES, ours, stryker);
    expect(r["src/sync/gitMerge.ts"]).toMatchObject({ ours: 81, stryker: 75, diff: 6, verdict: "unverified" });
    expect(r["src/sync/e2ee/keyring.ts"]).toMatchObject({ diff: 3.8, verdict: "verified" });
    expect(r["src/storage/zip.ts"]).toMatchObject({ verdict: "not measured", note: "no Stryker run" });
  });

  it("takes our score from a run report first, and the committed receipt otherwise", () => {
    const receipt = JSON.parse(read("scripts/mutation/receipt.json"));
    const o = ourScores([{ runner: "vitest", modules: [{ module: "src/sync/gitMerge.ts", score: 90, sampled: 10, mutants: 50 }] }], receipt);
    expect(o["src/sync/gitMerge.ts"]).toMatchObject({ score: 90, from: "report" });
    expect(o["src/sync/e2ee/keyring.ts"]).toMatchObject({ score: receipt.modules["src/sync/e2ee/keyring.ts"].score, from: "receipt" });
  });

  it("the mutation gate prints an unverified score with Stryker's, without failing on it", () => {
    const t = { critical: { min: 80, modules: ["src/a.ts"] }, modules: { "src/a.ts": [] } };
    const src = "export const a = 1;\n";
    const sha = createHash("sha256").update(src).digest("hex");
    const tests = createHash("sha256").update("").digest("hex");
    // A measured receipt (real vitest over every mutant): the train's gate counts anything else as an estimate.
    const receipt = { modules: { "src/a.ts": { score: 90, sha256: sha, tests, date: "2026-11-15", runner: "vitest", sampled: 10, mutants: 10 } } };
    const rd = (p: string) => (p === "src/a.ts" ? src : null);
    expect(checkReceipt(t, receipt, rd)[0]).toMatchObject({ state: "ok", score: 90 });
    expect(checkReceipt(t, receipt, rd)[0].verified).toBeUndefined();
    const cal = { modules: { "src/a.ts": { verdict: "unverified", stryker: 70 } } };
    expect(checkReceipt(t, receipt, rd, cal)[0]).toMatchObject({ state: "ok", score: 90, verified: false, stryker: 70 });
  });
});
