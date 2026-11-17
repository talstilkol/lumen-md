/**
 * R12.14 — honest status: plan:check (scripts/plan/build.mjs) fails on a ✅
 * task without green evidence; the overclaim report ranks ✅ tasks by
 * evidence alone, in Hebrew; a shallow clone makes a sha "not checkable
 * here", never "no evidence"; a perf limit missed only under load is
 * flagged, not red; a night run plan with a missing interpreter or script
 * is caught before the run. Clean reimplementation (design reference only).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
import * as guard from "../../scripts/plan/claimGuard.mjs";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
import { claimGuard, evidenceProblems, overclaimReport, overclaims, verifyShas } from "../../scripts/plan/claimGuard.mjs";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
import { run } from "../../scripts/plan/build.mjs";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
import { judgePerf, measure } from "../../scripts/plan/perfHonesty.mjs";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
import { lintRunPlan } from "../../scripts/plan/planLint.mjs";

const ROOT = resolve(__dirname, "../..");
const realPlan = () => JSON.parse(readFileSync(join(ROOT, "plan/plan.json"), "utf8"));
const GOOD = { verdict: "DONE", pr: 900, sha: "784ef2e1dd", checks: [{ cmd: "v4.sh x.test.ts", pass: 10, total: 10 }] };
const withTask = (task: object) => {
  const plan = realPlan();
  plan.phases[plan.phases.length - 1].tasks.push({ id: "R12.99", title: "synthetic", lane: "A", minutes: 10, priority: "P2", source: [], steps: ["x"], acceptance: ["y"], dep: [], dod: ["node -e 0"], ...task });
  return plan;
};

describe("R12.14 claim guard", () => {
  it("the plan as it is passes, with no task exempt", () => {
    expect(claimGuard(realPlan())).toEqual([]);
  });

  it("no grandfather list: a task that was ✅ before the rule needs evidence too (W10.G5)", () => {
    expect(Object.keys(guard).filter((k) => /grandfather|exempt/i.test(k))).toEqual([]);
    // 0.1 was the first id in the old list; ✅ and stripped of its evidence it must fail.
    const plan = realPlan();
    const t01 = plan.phases.flatMap((p: { tasks: { id: string }[] }) => p.tasks).find((t: { id: string }) => t.id === "0.1");
    t01.status = "✅ #202";
    delete t01.evidence;
    expect(claimGuard(plan)).toContain("0.1 is ✅ with no evidence");
    expect(claimGuard({ ...withTask({ status: "✅", evidence: GOOD }), receiptGrandfathered: ["R12.99"] }).filter((p: string) => p.startsWith("receiptGrandfathered:"))).toEqual(["receiptGrandfathered: no task is exempt from the evidence rule (W10.G5) — remove the list; a ✅ task needs its evidence, or goes back to ⏳"]);
    expect(claimGuard(withTask({ status: "✅", evidenceExempt: true }))).toContain('R12.99: "evidenceExempt" — no task is exempt from the evidence rule (W10.G5)');
  });

  it("a ✅ needs DONE, a sha and all-green checks", () => {
    expect(evidenceProblems({ evidence: GOOD })).toEqual([]);
    expect(evidenceProblems({})).toEqual(["no evidence"]);
    expect(evidenceProblems({ evidence: { ...GOOD, verdict: "PARTIAL" } })).toEqual(['verdict is "PARTIAL", not "DONE"']);
    expect(evidenceProblems({ evidence: { ...GOOD, checks: [{ cmd: "a", pass: 9, total: 10 }] } })).toEqual(["not all green: a (9/10)"]);
    expect(evidenceProblems({ evidence: { ...GOOD, sha: "main" } })).toEqual(["no commit sha"]);
  });

  it("plan:check (build.mjs) fails on a ✅ without evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "plan-"));
    try {
      mkdirSync(join(dir, "plan"));
      writeFileSync(join(dir, "plan/plan.json"), JSON.stringify(withTask({ status: "✅ done" })));
      expect(() => run({ root: dir, check: true })).toThrow(/✅ without evidence[\s\S]*R12\.99 is ✅ with no evidence/);
      writeFileSync(join(dir, "plan/plan.json"), JSON.stringify(withTask({ status: "✅ done", evidence: GOOD })));
      let msg = "";
      try {
        run({ root: dir, check: true });
      } catch (e) {
        msg = String((e as Error).message);
      }
      expect(msg).not.toMatch(/R12\.99 is ✅/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the overclaim report: by evidence only, the weak back to ⏳, in Hebrew", () => {
    const plan = withTask({ status: "✅", evidence: { ...GOOD, checks: [] } });
    const row = overclaims(plan).find((r: { id: string }) => r.id === "R12.99")!;
    expect(row).toMatchObject({ level: 1, suggest: "⏳" });
    expect(row).not.toHaveProperty("grandfathered");
    const md = overclaimReport(plan);
    expect(md).toContain("# דוח טענות-יתר");
    expect(md).toContain("| R12.99 | חלקית | לא נרשמה אף בדיקה | ⏳ |");
    expect(overclaims(withTask({ status: "✅", evidence: GOOD })).find((r: { id: string }) => r.id === "R12.99")!.level).toBe(2);
  });

  it("a shallow clone: a missing sha is not checkable here, not a failure", () => {
    // Synthetic one-task plan: the real plan's ✅ tasks carry shas of their own.
    const plan = { phases: [{ tasks: [{ id: "R12.99", status: "✅", evidence: GOOD }] }] };
    const git = (shallow: boolean) => (args: string[]) => {
      if (args[0] === "rev-parse") return shallow ? "true\n" : "false\n";
      throw new Error("missing");
    };
    expect(verifyShas(plan, git(true))).toMatchObject({ missing: [], unverifiable: ["R12.99"], shallow: true });
    expect(verifyShas(plan, git(false))).toMatchObject({ missing: ["R12.99"], unverifiable: [] });
  });
});

describe("R12.14 perf honesty", () => {
  it("over the limit only under load is flagged, not red; CPU time or a solo run decides", () => {
    expect(judgePerf({ wallMs: 900, limitMs: 300, load1: 45, cpus: 2 }).verdict).toBe("load");
    expect(judgePerf({ wallMs: 900, limitMs: 300, load1: 0.2, cpus: 2 }).verdict).toBe("fail");
    expect(judgePerf({ wallMs: 900, limitMs: 300, load1: 45, cpus: 2, solo: true }).verdict).toBe("fail");
    expect(judgePerf({ wallMs: 900, cpuMs: 120, limitMs: 300, load1: 45, cpus: 2 })).toMatchObject({ verdict: "pass", basis: "cpu" });
    expect(judgePerf({ wallMs: 900, cpuMs: 400, limitMs: 300, load1: 45, cpus: 2 })).toMatchObject({ verdict: "fail", basis: "cpu" });
    expect(judgePerf({ wallMs: 100, limitMs: 300, load1: 45, cpus: 2 }).verdict).toBe("pass");
  });

  it("measures both clocks", async () => {
    const m = await measure(() => {
      let x = 0;
      for (let i = 0; i < 2e5; i++) x += i;
      return x;
    });
    expect(m.wallMs).toBeGreaterThanOrEqual(0);
    expect(m.cpuMs).toBeGreaterThanOrEqual(0);
  });
});

describe("R12.14 run-plan lint", () => {
  it("catches a missing interpreter, script, path and folder before the night", () => {
    const plan = {
      steps: [
        { name: "ok", cmd: ["node", "scripts/plan/build.mjs", "--check"] },
        { name: "py", cmd: ["python9", "x.py"] },
        { name: "gone", cmd: ["node", "scripts/nope.mjs"], paths: ["no/such/file.json"] },
        { name: "where", cmd: ["node", "-e", "0"], cwd: "no-such-dir" },
      ],
    };
    const problems = lintRunPlan(plan, { root: ROOT, which: (c: string) => c === "node" });
    expect(problems).toEqual(['py: interpreter "python9" is not installed', "py: script x.py does not exist", "gone: script scripts/nope.mjs does not exist", "gone: path no/such/file.json does not exist", "where: working folder no-such-dir does not exist"]);
    expect(lintRunPlan({ steps: [] })).toEqual(["the plan has no steps"]);
  });
});
