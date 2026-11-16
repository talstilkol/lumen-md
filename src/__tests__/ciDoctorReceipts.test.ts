// @vitest-environment node
/**
 * Plan 0.9 on the CI that runs now: `ci-doctor --source local` diagnoses the
 * runs this machine's gates recorded (train:offline --all, ci:local), with no
 * network: a code-only gate is real, a test that passed on the same commit is
 * flaky, one that only fails here is flake?.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { diagnoseLocal, formatLocal, localRuns, nextLocal, pickRun } from "../../scripts/lib/ci-doctor-receipts.mjs";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const rec = (sha: string, at: string, gates: [string, string][], kind = "train-offline", dirty: string[] = []) => ({ kind, sha, at, dirty, gates: gates.map(([id, status]) => ({ id, status })) });

describe("localRuns", () => {
  it("reads train-offline records and ci:local's steps, newest first, a receipt and its run once", () => {
    const runs = localRuns([
      { file: ".ci-local/runs/a1.json", json: rec(A, "2026-11-16T01:00:00Z", [["imports", "pass"]]) },
      { file: "reports/train-offline-a.json", json: rec(A, "2026-11-16T01:00:00Z", [["imports", "pass"]]) },
      { file: ".ci-local/runs/b1.json", json: { kind: "ci-local", sha: B, at: "2026-11-16T02:00:00Z", steps: [{ id: "typecheck", status: "fail" }] } },
      { file: "junk.json", json: { hello: 1 } },
    ]);
    expect(runs.map((r: { sha: string }) => r.sha)).toEqual([B, A]);
    expect(runs[0].gates).toEqual([{ id: "typecheck", status: "fail" }]);
    expect(pickRun(runs, "aaaa").sha).toBe(A);
    expect(pickRun(runs).sha).toBe(B);
    expect(pickRun(runs, "dddd")).toBeNull();
  });
});

describe("diagnoseLocal", () => {
  const distance = (x: string, y: string) => (x === y ? 0 : 3);

  it("a code-only gate red here and green a few commits back is real: this change broke it", () => {
    const runs = localRuns([
      { file: "1", json: rec(A, "2026-11-16T02:00:00Z", [["imports", "fail"], ["typecheck", "skip"]]) },
      { file: "2", json: rec(B, "2026-11-16T01:00:00Z", [["imports", "pass"], ["typecheck", "pass"]]) },
    ]);
    const [it1] = diagnoseLocal(runs[0], runs, { distance });
    expect(it1).toMatchObject({ gate: "imports", kind: "command", verdict: "real" });
    expect(it1.why).toMatch(/this change broke it/);
    expect(it1.next).toBe("reproduce and fix: node scripts/check-imports.mjs");
  });

  it("a code-only gate with nothing to compare is still real", () => {
    const runs = localRuns([{ file: "1", json: rec(A, "t", [["plan", "fail"]]) }]);
    expect(diagnoseLocal(runs[0], runs, { distance })[0].verdict).toBe("real");
  });

  it("a test file that passed on the same commit in another run is flaky", () => {
    const f = "src/__tests__/x.test.ts";
    const runs = localRuns([
      { file: "1", json: rec(A, "2026-11-16T02:00:00Z", [[f, "fail"]]) },
      { file: "2", json: rec(A, "2026-11-16T01:00:00Z", [[f, "pass"]]) },
    ]);
    const [d] = diagnoseLocal(runs[0], runs, { distance, runner: "$S/shim-v4/v4.sh" });
    expect(d).toMatchObject({ gate: f, kind: "test", verdict: "flaky" });
    expect(d.next).toMatch(/never by a retry/);
  });

  it("a test file red only here, green at similar commits, is flake?; red everywhere near is real", () => {
    const f = "security/attacks/rr7-1-freeze-lockout.test.ts";
    const once = localRuns([
      { file: "1", json: rec(A, "3", [[f, "fail"]]) },
      { file: "2", json: rec(B, "2", [[f, "pass"]]) },
    ]);
    expect(diagnoseLocal(once[0], once, { distance })[0].verdict).toBe("flake?");
    const always = localRuns([
      { file: "1", json: rec(A, "3", [[f, "fail"]]) },
      { file: "2", json: rec(B, "2", [[f, "fail"]]) },
      { file: "3", json: rec(C, "1", [[f, "fail"]]) },
    ]);
    expect(diagnoseLocal(always[0], always, { distance })[0].verdict).toBe("real");
    const far = localRuns([
      { file: "1", json: rec(A, "3", [[f, "fail"]]) },
      { file: "2", json: rec(B, "2", [[f, "pass"]]) },
    ]);
    expect(diagnoseLocal(far[0], far, { distance: () => 500 })[0].verdict).toBe("unknown");
  });

  it("a code-only gate that passed on this same commit in another clean run is flaky: the environment differs", () => {
    const runs = localRuns([
      { file: "1", json: rec(A, "2026-11-16T02:00:00Z", [["typecheck", "fail"]]) },
      { file: "2", json: { ...rec(A, "2026-11-16T01:00:00Z", [["typecheck", "pass"]]), runner: "vitest" } },
    ]);
    const [d] = diagnoseLocal(runs[0], runs, { distance });
    expect(d).toMatchObject({ gate: "typecheck", kind: "command", verdict: "flaky", passed: 1 });
    expect(d.why).toMatch(/passed on this same commit in another run: the environment differs/);
  });

  it("a dirty run is never compared with (review 9, M2): a same-commit pass in a dirty tree proves nothing", () => {
    const f = "src/__tests__/x.test.ts";
    for (const other of [rec(A, "1", [[f, "pass"], ["typecheck", "pass"]], "train-offline", ["src/x.ts"]), { ...rec(A, "1", [[f, "pass"], ["typecheck", "pass"]]), dirty: undefined }]) {
      const runs = localRuns([
        { file: "1", json: rec(A, "2", [[f, "fail"], ["typecheck", "fail"]]) },
        { file: "2", json: other },
      ]);
      const [t, c] = diagnoseLocal(runs[0], runs, { distance });
      expect(t).toMatchObject({ gate: f, verdict: "unknown", passed: 0 });
      expect(c).toMatchObject({ gate: "typecheck", verdict: "real", passed: 0 });
    }
  });

  it("a dirty run itself is diagnosed without comparisons: its red may be the local edit's, never 'flaky'", () => {
    const f = "src/__tests__/x.test.ts";
    const runs = localRuns([
      { file: "1", json: rec(A, "2", [[f, "fail"], ["typecheck", "fail"]], "train-offline", ["src/x.ts"]) },
      { file: "2", json: rec(A, "1", [[f, "pass"], ["typecheck", "pass"]]) },
    ]);
    expect(runs[0]).toMatchObject({ dirty: true });
    const [t, c] = diagnoseLocal(runs[0], runs, { distance });
    expect(t.verdict).toBe("unknown");
    expect(c.verdict).toBe("real");
    expect(c.why).toMatch(/^this run's tree was dirty: not compared with other runs/);
    expect(localRuns([{ file: "x", json: { ...rec(A, "1", []), dirty: undefined } }])[0].dirty).toBeNull();
  });

  it("formats a green run and a red one", () => {
    const g = localRuns([{ file: "r", json: rec(A, "t", [["imports", "pass"]]) }])[0];
    expect(formatLocal(g, [])).toMatch(/no red gate \(1 gates\)/);
    expect(nextLocal("src/__tests__/x.test.ts", "flake?")).toBe("run it once more: npx vitest run src/__tests__/x.test.ts; if it fails again it is real");
  });
});

describe("ci-doctor --source local (CLI)", () => {
  const cli = resolve(__dirname, "../../scripts/ci-doctor.mjs");

  it("reads .ci-local/runs and reports/ receipts with no network, and --json exits 1 on a real failure", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-doctor-local-"));
    try {
      mkdirSync(join(dir, ".ci-local/runs"), { recursive: true });
      mkdirSync(join(dir, "reports"), { recursive: true });
      writeFileSync(join(dir, `reports/train-offline-${B}.json`), JSON.stringify({ ...rec(B, "2026-11-16T01:00:00Z", [["typecheck", "pass"]]), green: true }));
      writeFileSync(join(dir, `.ci-local/runs/${A}-2.json`), JSON.stringify(rec(A, "2026-11-16T02:00:00Z", [["typecheck", "fail"]])));
      const env = { ...process.env, PATH: process.env.PATH ?? "", GH_REPO: "x/y" };
      const r = spawnSync("node", [cli, "--source", "local"], { cwd: dir, encoding: "utf8", env });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/REAL\s+typecheck — code-only gate/);
      const j = spawnSync("node", [cli, "--source", "local", A.slice(0, 10), "--json"], { cwd: dir, encoding: "utf8", env });
      expect(j.status).toBe(1);
      expect(JSON.parse(j.stdout).items[0]).toMatchObject({ gate: "typecheck", verdict: "real" });
      const none = spawnSync("node", [cli, "--source", "local", "ffff"], { cwd: dir, encoding: "utf8", env });
      expect(none.status).toBe(1);
      expect(none.stderr).toMatch(/no run record at ffff/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
