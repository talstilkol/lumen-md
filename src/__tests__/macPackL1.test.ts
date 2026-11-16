/**
 * Wave g6, lane L1: the Mac pack and the owner pack are commands somebody runs
 * once, unattended or in a short session. A typo in a path or an npm script
 * name costs a whole Mac run, so this checks every entry against the repo,
 * and checks the one helper the Mac entries share (scripts/mac-pack/pw-slice.mjs).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { collect, judge } from "../../scripts/mac-pack/pw-slice.mjs";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const scripts: Record<string, string> = read("package.json").scripts;
type Mac = { id: string; task: string; cmd: string; expect: Record<string, unknown>; needs: string[]; minutes: number };
type Owner = { id: string; task: string; decision: string; options: string[]; recommendation: string; why: string; sources: string[]; changes: string; draftPr: number | null; check: string };
const mac: Mac[] = read("plan/mac-pack/L1.json");
const owner: Owner[] = read("plan/owner-pack/L1.json");

/** Repo paths a command names: e2e specs, tests, scripts, fixtures. */
const PATH_RE = /(?:^|[\s"'(=])((?:e2e|src|scripts|security|ios|src-tauri)\/[\w./@-]+\.(?:ts|mjs|py|sh|swift|json|pbxproj|xcodeproj)|security\/attacks|ios\/App\/App\.xcodeproj|src\/__tests__\/fixtures\/obsidian-corpus\/[\w-]+)/g;
const pathsIn = (s: string) => [...s.matchAll(PATH_RE)].map((m) => m[1]);
const npmIn = (s: string) => [...s.matchAll(/npm run ([\w:.-]+)/g)].map((m) => m[1]);

function report(tests: Array<{ file: string; project: string; status: string }>) {
  // Playwright's JSON reporter: one suite per file, specs inside (possibly in nested describe suites).
  const byFile = new Map<string, typeof tests>();
  for (const t of tests) byFile.set(t.file, [...(byFile.get(t.file) ?? []), t]);
  return {
    suites: [...byFile].map(([file, ts]) => ({
      title: file,
      file,
      specs: [],
      suites: [{ title: "describe", file, specs: ts.map((t, i) => ({ title: `t${i}`, file, tests: [{ projectName: t.project, status: t.status }] })) }],
    })),
  };
}

describe("pw-slice: one Playwright report, judged per spec file", () => {
  const all = (file: string, n: number, status = "expected") =>
    ["chromium", "firefox", "webkit"].flatMap((project) => Array.from({ length: n }, () => ({ file, project, status })));

  it("counts only the given specs, through nested suites and with or without the e2e/ prefix", () => {
    const r = report([...all("rtl-matrix.spec.ts", 2), ...all("other.spec.ts", 5)]);
    const tests = collect(r, ["e2e/rtl-matrix.spec.ts"]);
    expect(tests).toHaveLength(6);
    expect(judge(tests, 6)).toMatchObject({ ok: true, expected: 6, projects: ["chromium", "firefox", "webkit"] });
  });

  it("a skipped, flaky or failed test, or a different count, is not ok", () => {
    const skipped = report([...all("a.spec.ts", 2), { file: "a.spec.ts", project: "webkit", status: "skipped" }]);
    expect(judge(collect(skipped, ["a.spec.ts"]), 7).ok).toBe(false);
    for (const status of ["unexpected", "flaky"]) {
      const r = report([...all("a.spec.ts", 1), { file: "a.spec.ts", project: "webkit", status }]);
      expect(judge(collect(r, ["a.spec.ts"]), 4)).toMatchObject({ ok: false, total: 4 });
    }
    expect(judge(collect(report(all("a.spec.ts", 2)), ["a.spec.ts"]), 5).ok).toBe(false);
  });
});

describe("the Mac pack (plan/mac-pack/L1.json)", () => {
  it("every entry has the fields, a unique id, positive minutes and a machine-checkable expect", () => {
    expect(new Set(mac.map((m) => m.id)).size).toBe(mac.length);
    for (const m of mac) {
      expect(m.id).toMatch(/^L1\//);
      expect(typeof m.cmd).toBe("string");
      expect(m.minutes).toBeGreaterThan(0);
      expect(Array.isArray(m.needs)).toBe(true);
      expect(m.expect.exit, m.id).toBe(0);
    }
  });

  it("every needed entry id exists, and every path and npm script a command names exists", () => {
    const ids = new Set(mac.map((m) => m.id));
    const missing: string[] = [];
    for (const m of mac) {
      for (const n of m.needs) if (n.startsWith("L1/") && !ids.has(n)) missing.push(`${m.id}: needs ${n}`);
      for (const p of pathsIn(m.cmd)) if (!existsSync(join(ROOT, p))) missing.push(`${m.id}: ${p}`);
      for (const s of npmIn(m.cmd)) if (!(s in scripts)) missing.push(`${m.id}: npm run ${s}`);
    }
    expect(missing).toEqual([]);
  });

  it("the shared e2e batch runs every spec a slice judges, and its total is the slices' sum", () => {
    const batch = mac.find((m) => m.id === "L1/e2e-batch")!;
    const run = batch.cmd.split(";")[0];
    const slices = mac.filter((m) => m.needs.includes("L1/e2e-batch") && m.cmd.includes("/e2e.json"));
    const slice = (m: Mac) => m.cmd.slice(m.cmd.lastIndexOf("pw-slice.mjs")).split("&&")[0];
    const judged = new Set(slices.flatMap((m) => pathsIn(slice(m)).filter((p) => p.startsWith("e2e/"))));
    for (const spec of judged) expect(run, spec).toContain(spec);
    const totals = (s: string) => Number(/--total (\d+)/.exec(s)![1]);
    expect(totals(batch.cmd)).toBe(batch.expect.json && (batch.expect.json as { total: number }).total);
    // each spec of the batch is judged by exactly one entry, so the slices add up to the batch
    expect(slices.reduce((n, m) => n + totals(slice(m)), 0)).toBe(totals(batch.cmd));
    expect(judged.size).toBe(pathsIn(run).filter((p) => p.startsWith("e2e/")).length);
  });
});

describe("the owner pack (plan/owner-pack/L1.json)", () => {
  it("every entry has a decision, ≥ 1 option, a recommendation with a reason, sources, what changes, and a check", () => {
    expect(new Set(owner.map((o) => o.id)).size).toBe(owner.length);
    for (const o of owner) {
      for (const k of ["decision", "recommendation", "why", "changes", "check"] as const) expect(o[k].length, `${o.id}.${k}`).toBeGreaterThan(0);
      expect(o.options.length, o.id).toBeGreaterThan(0);
      expect(o.sources.length, o.id).toBeGreaterThan(0);
      expect(o.draftPr === null || Number.isInteger(o.draftPr), o.id).toBe(true);
    }
  });

  it("every repo path a source or a check names exists, and every npm script it runs exists", () => {
    const missing: string[] = [];
    for (const o of owner) {
      for (const s of o.sources) {
        if (/^https?:\/\//.test(s)) continue;
        const p = s.replace(/ items? .*$/, "").replace(/\/$/, "");
        if (!existsSync(join(ROOT, p))) missing.push(`${o.id}: ${s}`);
      }
      for (const p of pathsIn(o.check)) if (!existsSync(join(ROOT, p))) missing.push(`${o.id}: ${p}`);
      for (const s of npmIn(o.check)) if (!(s in scripts)) missing.push(`${o.id}: npm run ${s}`);
    }
    expect(missing).toEqual([]);
  });

  it("no entry names the domain that is not the project's", () => {
    const text = readFileSync(join(ROOT, "plan/owner-pack/L1.json"), "utf8") + readFileSync(join(ROOT, "plan/mac-pack/L1.json"), "utf8");
    expect(text).not.toMatch(/\blumen\.md\b/);
  });
});
