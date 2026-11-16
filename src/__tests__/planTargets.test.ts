// @vitest-environment node
/**
 * Plan 13.6 (W10.E13): every target of MASTER_PLAN.md appendix 14 is mapped
 * to what measures it, and "not measured" is reported as such, never as a pass.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FAIL,
  NOT,
  PASS,
  at,
  audit,
  combine,
  coverage,
  evaluate,
  grepCount,
  loadE2e,
  parseAppendix,
  // @ts-expect-error — plain .mjs module without type declarations
} from "../../scripts/plan-targets.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { seal } from "../../scripts/nightly/receipt.mjs";

type Target = { id: string; area: string; clause: number; target: string; evidence: { type: string }[] };
const rows = () => parseAppendix(readFileSync("MASTER_PLAN.md", "utf8"));
const targets = (): Target[] => JSON.parse(readFileSync("plan/targets.json", "utf8")).targets;
const exec = (cmd: string) => spawnSync("sh", ["-c", cmd]).status ?? 1;

function tmp() {
  const root = mkdtempSync(join(tmpdir(), "targets-"));
  const put = (f: string, text: string) => {
    mkdirSync(join(root, f, ".."), { recursive: true });
    writeFileSync(join(root, f), text);
  };
  return { root, put, done: () => rmSync(root, { recursive: true, force: true }) };
}

describe("appendix 14 is mapped clause by clause", () => {
  it("all 11 areas and every clause of the table have exactly one target with the same text", () => {
    const r = rows();
    expect(r.map((x: { area: string }) => x.area)).toEqual(["עברית", "בטיחות נתונים", "אבטחה", "ביצועים", "אמינות", "נגישות", "מובייל ו-offline", "i18n", "תוספים", "שולחן עבודה", "AI מקומי"]);
    const cov = coverage(r, targets());
    expect(cov.problems).toEqual([]);
    expect(cov.mapped).toBe(cov.clauses);
    expect(cov.clauses).toBe(49);
  });

  it("the file holds no status: every status is computed", () => {
    const text = readFileSync("plan/targets.json", "utf8");
    expect(text).not.toMatch(/"status"\s*:/);
    for (const t of targets()) for (const e of t.evidence) expect(["e2e", "vitest", "command", "json", "grep", "none"]).toContain(e.type);
  });

  it("a dropped target, a reworded clause and a duplicate are caught", () => {
    const r = rows();
    const ts = targets();
    expect(coverage(r, ts.slice(1)).problems.join("\n")).toContain("עברית #1 has no target");
    expect(coverage(r, ts.map((t, i) => (i === 3 ? { ...t, target: "something else" } : t))).problems.join("\n")).toContain("the appendix now says");
    expect(coverage(r, [...ts, { ...ts[0] }]).problems.join("\n")).toContain("used twice");
    expect(coverage(r, [...ts, { ...ts[0], id: "x", clause: 9 }]).problems.join("\n")).toContain("not in the appendix");
  });
});

describe("statuses", () => {
  it("not measured never counts as a pass", () => {
    expect(combine([{ status: PASS }, { status: PASS }])).toBe(PASS);
    expect(combine([{ status: PASS }, { status: NOT }])).toBe(NOT);
    expect(combine([{ status: NOT }, { status: FAIL }])).toBe(FAIL);
    expect(combine([])).toBe(NOT);
  });

  it("json: a missing result is not measured; the bound decides pass or fail; -1 is the last night", () => {
    const t = tmp();
    try {
      const ev = { type: "json", file: "reports/trend/h.json", path: "-1.desktop.scores.performance", op: ">=", value: 90 };
      expect(evaluate(ev, { root: t.root }).status).toBe(NOT);
      t.put("reports/trend/h.json", JSON.stringify([{ desktop: { scores: { performance: 95 } } }, { desktop: { scores: { performance: 88 } } }]));
      const r = evaluate(ev, { root: t.root });
      expect(r.status).toBe(FAIL);
      expect(r.detail).toContain("= 88 (target >= 90)");
      expect(evaluate({ ...ev, path: "0.desktop.scores.performance" }, { root: t.root }).status).toBe(PASS);
      expect(evaluate({ ...ev, path: "-1.nope" }, { root: t.root }).status).toBe(NOT);
      expect(at({ a: [1, { b: 2 }] }, "a.-1.b")).toBe(2);
    } finally {
      t.done();
    }
  });

  it("grep: counts code, skips comments and excluded paths", () => {
    const t = tmp();
    try {
      t.put("src/a.ts", "try { x() } catch {}\n// catch {} in a comment\n");
      t.put("src/__tests__/b.test.ts", "try { y() } catch {}\n");
      t.put("src/c.ts", "try { z() } catch (e) {\n  // why: best effort\n}\n");
      expect(grepCount(t.root, String.raw`catch\s*(\([^)]*\))?\s*\{\s*\}`, ["src"], ["src/__tests__"])).toEqual(["src/a.ts:1"]);
      const ev = { type: "grep", pattern: String.raw`catch\s*(\([^)]*\))?\s*\{\s*\}`, paths: ["src"], exclude: ["src/__tests__"], max: 0 };
      expect(evaluate(ev, { root: t.root }).status).toBe(FAIL);
      t.put("src/a.ts", "try { x() } catch {\n  // why: it may be gone\n}\n");
      expect(evaluate(ev, { root: t.root }).status).toBe(PASS);
      expect(evaluate({ ...ev, paths: ["nowhere"] }, { root: t.root }).status).toBe(NOT);
    } finally {
      t.done();
    }
  });

  it("vitest and command evidence run only with --run; a missing test file is not measured", () => {
    const t = tmp();
    try {
      expect(evaluate({ type: "command", cmd: "true" }, { root: t.root, run: false, exec }).status).toBe(NOT);
      expect(evaluate({ type: "command", cmd: "true" }, { root: t.root, run: true, exec }).status).toBe(PASS);
      expect(evaluate({ type: "command", cmd: "false" }, { root: t.root, run: true, exec }).status).toBe(FAIL);
      expect(evaluate({ type: "vitest", file: "src/__tests__/none.test.ts" }, { root: t.root, run: true, exec }).detail).toContain("does not exist");
      expect(evaluate({ type: "none", reason: "owner" }, { root: t.root }).status).toBe(NOT);
    } finally {
      t.done();
    }
  });

  it("with --runner, a vitest target runs through the offline runner (`<cmd> <root> <file>`), and its exit decides", () => {
    const t = tmp();
    try {
      mkdirSync(join(t.root, "src/__tests__"), { recursive: true });
      writeFileSync(join(t.root, "src/__tests__/x.test.ts"), "");
      const ran: string[] = [];
      const record = (code: number) => (cmd: string) => (ran.push(cmd), code);
      const ev = { type: "vitest", file: "src/__tests__/x.test.ts" };
      expect(evaluate(ev, { root: t.root, run: true, runner: "/opt/shim v4.sh", exec: record(0) })).toMatchObject({ status: PASS });
      expect(ran).toEqual([`'/opt/shim v4.sh' '${t.root}' 'src/__tests__/x.test.ts'`]);
      expect(evaluate(ev, { root: t.root, run: true, runner: "/opt/v4.sh", exec: record(1) }).status).toBe(FAIL);
      expect(evaluate(ev, { root: t.root, run: true, exec: record(0) }).detail).toBe("`npx vitest run src/__tests__/x.test.ts` exit 0");
    } finally {
      t.done();
    }
  });

  it("e2e: from the signed report for HEAD; only chromium is known, a failure in the spec fails it", () => {
    const t = tmp();
    try {
      t.put("e2e/rtl.spec.ts", "");
      const green = { kind: "e2e", project: "chromium", ok: true, commit: { sha: "a".repeat(40) }, shards: [{ failures: [] }] };
      const ev = { type: "e2e", spec: "e2e/rtl.spec.ts", project: "chromium", browsers: ["chromium"] };
      const ctx = (e2e: unknown) => ({ root: t.root, e2e, e2eProblem: e2e ? null : "no e2e report for HEAD" });
      expect(evaluate(ev, ctx(null)).status).toBe(NOT);
      expect(evaluate(ev, ctx(green)).status).toBe(PASS);
      expect(evaluate({ ...ev, browsers: ["chromium", "firefox", "webkit"] }, ctx(green)).detail).toContain("needs firefox and webkit");
      expect(evaluate({ ...ev, project: "perf" }, ctx(green)).status).toBe(NOT);
      const red = { ...green, ok: false, shards: [{ failures: [{ where: "e2e/rtl.spec.ts:12" }] }] };
      expect(evaluate(ev, ctx(red)).status).toBe(FAIL);
      const redElsewhere = { ...green, ok: false, shards: [{ failures: [{ where: "e2e/other.spec.ts:3" }] }] };
      expect(evaluate(ev, ctx(redElsewhere)).status).toBe(NOT);
      expect(evaluate({ ...ev, spec: "e2e/missing.spec.ts" }, ctx(green)).detail).toContain("does not exist");
    } finally {
      t.done();
    }
  });

  it("the report must hold: a sealed one loads, a changed one does not", async () => {
    const t = tmp();
    try {
      const sha = "b".repeat(40);
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const sealed = seal({ kind: "e2e", project: "chromium", ok: true, commit: { sha }, shards: [] }, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
      t.put(`reports/e2e-${sha}.json`, JSON.stringify(sealed));
      const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
      expect((await loadE2e(t.root, sha, pub)).report?.ok).toBe(true);
      t.put(`reports/e2e-${sha}.json`, JSON.stringify({ ...sealed, ok: false }));
      expect((await loadE2e(t.root, sha, pub)).problem).toContain("does not hold");
      expect((await loadE2e(t.root, "c".repeat(40))).problem).toContain("no e2e report");
    } finally {
      t.done();
    }
  });
});

describe("npm run plan:targets on this tree", () => {
  it("reports all 49 targets; what cannot be measured here is not measured; --strict refuses", () => {
    const r = spawnSync(process.execPath, ["scripts/plan-targets.mjs", "--json"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.rows.length).toBe(49);
    expect(out.coverage.ok).toBe(true);
    const by = (id: string) => out.rows.find((x: { id: string }) => x.id === id);
    // Owner-only targets are never a pass here.
    for (const id of ["desktop.signed", "desktop.auto-update", "ai.doctor", "he.eval"]) expect(by(id).status).toBe(NOT);
    // The startup gate's ceiling (222 KB) is at or under the 250 KB target; whether
    // the build fits it is `npm run budget`, which runs only with --run.
    const startup = by("perf.startup-250kb");
    expect(startup.evidence.find((e: { type: string }) => e.type === "json").status).toBe(PASS);
    expect(startup.status).toBe(NOT);
    // 0 empty catches without why:, also in worker and iframe code kept in strings.
    expect(by("rel.no-empty-catch").status).toBe(PASS);
    expect(out.counts[PASS] + out.counts[FAIL] + out.counts[NOT]).toBe(49);
    expect(spawnSync(process.execPath, ["scripts/plan-targets.mjs", "--strict"], { encoding: "utf8" }).status).toBe(1);
    expect(audit([{ id: "x", area: "a", clause: 0, target: "t", evidence: [{ type: "none", reason: "r" }] }], { root: "." }).counts[NOT]).toBe(1);
  });
});
