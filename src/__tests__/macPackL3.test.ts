/**
 * Wave g6, lane L3: the Mac pack (plan/mac-pack/L3.json) and its runner,
 * e2e summary and Argon2 bench (scripts/mac-pack/L3/). The pack is what the
 * Mac runs once; these tests keep every entry runnable and every expect
 * machine-checkable before it gets there.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
import { checkExpect, expectErrors, getPath, normalizeSpec, packErrors, specVerdict, summarizePlaywright } from "../../scripts/mac-pack/L3/lib.mjs";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
import { missingRefs, readJsonGlob } from "../../scripts/mac-pack/L3/run.mjs";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
import { wholeRun } from "../../scripts/mac-pack/L3/e2e-summary.mjs";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
import { median, verdict as argonVerdict } from "../../scripts/mac-pack/L3/argon2-bench.mjs";

const PACK = JSON.parse(readFileSync("plan/mac-pack/L3.json", "utf8"));
const SCRIPTS = JSON.parse(readFileSync("package.json", "utf8")).scripts;
/** A real Playwright 1.56 JSON report (chromium + webkit: 2 passed, 1 failed, 1 skipped each). */
const REAL = JSON.parse(readFileSync("src/__tests__/fixtures/macPackL3/playwright-real.json", "utf8"));

/** The lane's Mac tasks (g6w L3.json, w = mac) and the pack entry that answers each. */
const MAC_TASKS: Record<string, string> = {
  "W4.2": "L3-W4.2", "W4.5": "L3-W4.5", "W4.6": "L3-W4.6", "W4.9": "L3-W4.9", "W4.10": "L3-W4.10", "W4.13": "L3-W4.13",
  "W4.15": "L3-W4.15", "W4.16": "L3-W4.16", "W4.17": "L3-W4.17", "W4.20": "L3-W4.20", "W4.21": "L3-W4.21", "W4.22": "L3-W4.22-android",
  "W4.23": "L3-W4.23-mac", "W4.30": "L3-W4.30-diff", "W4.31": "L3-W4.31", "W4.32": "L3-W4.32", "W4.33": "L3-W4.33", "W4.35": "L3-W4.35",
  "W4.36": "L3-W4.36", "7.2": "L3-7.2", "7.3": "L3-7.3", "7.4": "L3-7.4", "7.8": "L3-7.8", "7.9": "L3-7.9", "0.5": "L3-0.5", "0.11": "L3-0.11",
  "0.14": "L3-0.14", "0.15": "L3-W4.17", "0.16": "L3-0.16", "0.20": "L3-0.20", "11.1": "L3-11.1", "11.2": "L3-11.2", "11.4": "L3-11.4",
  "11.5": "L3-11.5", "8.1": "L3-8.1", "8.3": "L3-8.3", "8.4": "L3-8.4", "8.5": "L3-8.5", "W12.M1": "L3-W12.M1", "W12.M2": "L3-W12.M2", "W12.M3": "L3-W12.M3",
};

describe("the L3 Mac pack", () => {
  it("is well formed: ids unique, needs point backwards, every expect checkable", () => {
    expect(packErrors(PACK)).toEqual([]);
  });

  it("answers every Mac task of the lane with an entry that exists", () => {
    const ids = new Set(PACK.map((e: { id: string }) => e.id));
    expect(Object.entries(MAC_TASKS).filter(([, id]) => !ids.has(id))).toEqual([]);
  });

  it("names only npm scripts, scripts and specs that are in the repository", () => {
    const missing = PACK.flatMap((e: { id: string; cmd: string }) => missingRefs(e.cmd, { scripts: SCRIPTS }).map((m: string) => `${e.id}: ${m}`));
    expect(missing).toEqual([]);
    // The check itself sees a missing one (and a .tsx is not read as a .ts).
    expect(missingRefs("npm run nope && npx vitest run src/__tests__/nope.test.tsx e2e/smoke.spec.ts", { scripts: SCRIPTS })).toEqual(["npm script nope", "src/__tests__/nope.test.tsx"]);
  });

  it("every e2e entry reads the one shared run, never starts its own", () => {
    for (const e of PACK.filter((x: { cmd: string }) => x.cmd.includes("e2e-summary.mjs"))) expect(e.needs, e.id).toContain("L3-e2e-run");
    expect(PACK.filter((x: { cmd: string }) => /playwright test(?! --list)/.test(x.cmd))).toEqual([]);
  });
});

describe("expect checks", () => {
  const doc = { kind: "model", steps: [{ id: "asr-web", status: "pass" }, { id: "fim", status: "fail" }], plan: { "0.5": { met: true } }, n: 96 };
  it("paths walk keys, dotted keys and array selectors", () => {
    expect(getPath(doc, ["steps", { id: "asr-web" }, "status"])).toBe("pass");
    expect(getPath(doc, ["plan", "0.5", "met"])).toBe(true);
    expect(getPath(doc, ["steps", { id: "nope" }, "status"])).toBeUndefined();
    expect(getPath(doc, ["kind", "x", "y"])).toBeUndefined();
  });

  it("passes only when the exit code and every field hold", () => {
    const readJson = () => doc;
    expect(checkExpect({ exit: 0 }, { exit: 0, readJson }).ok).toBe(true);
    expect(checkExpect({ exit: 0 }, { exit: 1, readJson }).ok).toBe(false);
    expect(checkExpect({ json: { file: "r.json", path: ["steps", { id: "asr-web" }, "status"], op: "==", value: "pass" } }, { exit: null, readJson }).ok).toBe(true);
    expect(checkExpect({ json: [{ file: "r.json", path: ["n"], op: ">=", value: 95 }, { file: "r.json", path: ["steps", { id: "fim" }, "status"], op: "==", value: "pass" }] }, { exit: null, readJson }).ok).toBe(false);
    expect(checkExpect({ json: { file: "r.json", path: ["n"], op: ">=", value: "96" } }, { exit: null, readJson }).ok).toBe(false);
    const missing = checkExpect({ exit: 0, json: { file: "gone.json", path: ["ok"], op: "==", value: true } }, { exit: 0, readJson: () => { throw new Error("no file matches gone.json"); } });
    expect(missing.ok).toBe(false);
    expect(missing.detail.join(" ")).toContain("no file matches");
  });

  it("refuses an expect that checks nothing or uses an unknown op", () => {
    expect(expectErrors({ says: "looks fine" })).toEqual(["expect checks nothing"]);
    expect(expectErrors({ json: { file: "a", path: ["x"], op: "~=" } })).toEqual(["unknown op ~=", "op ~= needs a value"]);
    expect(expectErrors({ exit: "0" })).toEqual(["exit is not an integer"]);
  });

  it("a star picks the newest matching file, in a directory or in the name", () => {
    const root = mkdtempSync(join(tmpdir(), "macpack-"));
    for (const [run, t] of [["r1", 1000], ["r2", 3000], ["r3", 2000]] as const) {
      mkdirSync(join(root, "day", run), { recursive: true });
      const f = join(root, "day", run, "report.json");
      writeFileSync(f, JSON.stringify({ run }));
      utimesSync(f, t, t);
    }
    expect(readJsonGlob("day/*/report.json", root)).toEqual({ run: "r2" });
    writeFileSync(join(root, "full-2026-11-01.json"), '{"d":1}');
    utimesSync(join(root, "full-2026-11-01.json"), 1000, 1000);
    writeFileSync(join(root, "full-2026-11-02.json"), '{"d":2}');
    expect(readJsonGlob("full-*.json", root)).toEqual({ d: 2 });
    expect(() => readJsonGlob("none/*/x.json", root)).toThrow(/no file matches/);
  });
});

describe("the shared e2e run, read per spec", () => {
  const summary = summarizePlaywright([{ project: "chromium", json: REAL }]);

  it("counts a real Playwright JSON report per project and per spec", () => {
    expect(summary.projects.chromium).toMatchObject({ passed: 2, failed: 1, skipped: 1, flaky: 0 });
    expect(summary.projects.webkit).toMatchObject({ passed: 2, failed: 1, skipped: 1 });
    expect(summary.specs["e2e/a.spec.mjs"].chromium).toEqual({ passed: 2, failed: 1, flaky: 0, skipped: 1 });
  });

  it("a spec with a failure, or missing in a project, is not ok", () => {
    const v = specVerdict(summary, ["e2e/a.spec.mjs", "e2e/other.spec.ts"], ["chromium", "firefox"]);
    expect(v.ok).toBe(false);
    expect(v.problems).toEqual([
      "e2e/a.spec.mjs [chromium]: 1 failed, 0 flaky",
      "e2e/a.spec.mjs [firefox]: not in the run",
      "e2e/other.spec.ts [chromium]: not in the run",
      "e2e/other.spec.ts [firefox]: not in the run",
    ]);
    const green = { projects: {}, specs: { "e2e/b.spec.ts": { webkit: { passed: 0, failed: 0, flaky: 0, skipped: 3 }, chromium: { passed: 3, failed: 0, flaky: 0, skipped: 0 } } } };
    expect(specVerdict(green, ["b.spec.ts"], ["chromium", "webkit"]).problems).toEqual(["b.spec.ts [webkit]: 0 passed (3 skipped)"]);
    expect(specVerdict(green, ["b.spec.ts"], ["chromium", "webkit"], { allowSkipOnly: ["webkit"] }).ok).toBe(true);
  });

  it("spec paths match whatever prefix the reporter used", () => {
    expect(normalizeSpec("plugins.spec.ts")).toBe("e2e/plugins.spec.ts");
    expect(normalizeSpec("/Users/tal/lumen-md/e2e/rtl-parity/a.spec.ts")).toBe("e2e/rtl-parity/a.spec.ts");
  });

  it("the whole run needs every shard, each in time, and 0 failures", () => {
    const ok = { suites: [{ file: "x.spec.ts", specs: [{ tests: [{ projectName: "chromium", status: "expected" }] }] }] };
    const shards = [1, 2].map((i) => ({ project: "chromium", index: i, total: 2, json: ok }));
    expect(wholeRun(shards, { "e2e-chromium-1of2": 12, "e2e-chromium-2of2": 39.9 }, { projects: ["chromium"], total: 2 }).ok).toBe(true);
    const late = wholeRun(shards, { "e2e-chromium-1of2": 12, "e2e-chromium-2of2": 41 }, { projects: ["chromium"], total: 2 });
    expect(late.problems).toEqual(["chromium shard 2/2: 41 min > 40"]);
    const gone = wholeRun(shards.slice(0, 1), { "e2e-chromium-1of2": 12 }, { projects: ["chromium"], total: 2 });
    expect(gone.problems).toEqual(["chromium shard 2/2: no report", "chromium shard 2/2: no time in full-*.json"]);
    const red = wholeRun([{ project: "chromium", index: 1, total: 1, json: REAL }], { "e2e-chromium-1of1": 1 }, { projects: ["chromium"], total: 1 });
    expect(red.problems).toEqual(["chromium: 1 failed, 0 flaky"]);
  });
});

describe("the Argon2 bench's verdict (W4.20)", () => {
  it("wants hash-wasm, the RFC 9106 vector and the 1 s budget", () => {
    const inHouse = { rfc9106: true, runs: [8000], medianMs: 8000 };
    expect(argonVerdict({ "in-house": inHouse, "hash-wasm": null }, 1000).problems[0]).toMatch(/hash-wasm is not installed/);
    expect(argonVerdict({ "in-house": inHouse, "hash-wasm": { rfc9106: true, runs: [600, 700, 650], medianMs: 650 } }, 1000).ok).toBe(true);
    expect(argonVerdict({ "in-house": inHouse, "hash-wasm": { rfc9106: true, runs: [1200], medianMs: 1200 } }, 1000).problems).toEqual(["hash-wasm: median 1200 ms > 1000 ms"]);
    expect(argonVerdict({ "in-house": { ...inHouse, rfc9106: false }, "hash-wasm": { rfc9106: true, runs: [1], medianMs: 1 } }, 1000).ok).toBe(false);
    // FC1: the in-house Argon2id (WebAssembly fill) meets the budget on its own.
    expect(argonVerdict({ "in-house": { rfc9106: true, runs: [450, 470, 460], medianMs: 460 }, "hash-wasm": null }, 1000)).toEqual({ ok: true, problems: [] });
    expect(argonVerdict({ "in-house": { rfc9106: false, runs: [460], medianMs: 460 }, "hash-wasm": null }, 1000).ok).toBe(false);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
