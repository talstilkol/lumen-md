/**
 * R12.14 migration (scripts/plan/migrate-evidence.mjs): every ✅ task carries the
 * evidence the honest-status rule (#868, scripts/plan/claimGuard.mjs) asks for, and no
 * task is grandfathered (W10.G5). A ✅ task whose audit verdict is not DONE, or whose
 * dod is not green, goes back to ⏳ with "ביקורת 15.11: אין ראיה".
 * The small plans below are synthetic (labelled as such); the last block reads the real plan.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
import { DROP_NOTE, droppedStatus, migrateEvidence, passFail, vitestFiles, whereToRun } from "../../scripts/plan/migrate-evidence.mjs";

const ROOT = resolve(__dirname, "../..");
const SHA = "05973c40e660b98ac095b7bb3679f4af34b9999c";
type Task = { id: string; status?: string; pr?: number; dod?: string[]; evidence?: { verdict: string; sha: string; pr: number; checks: { cmd: string; pass: number; total: number }[] }; verified?: string };
const synthetic = (tasks: Task[]) => ({ phases: [{ id: "x", tasks }] });
const green = (cmd: string) => [{ cmd, pass: 3, total: 3 }];

describe("R12.14 migrate-evidence (synthetic plans)", () => {
  it("parses dod commands and runner output", () => {
    expect(vitestFiles("npx vitest run a.test.ts b.test.tsx")).toEqual(["a.test.ts", "b.test.tsx"]);
    expect(vitestFiles("npm run plan:check")).toBeNull();
    expect(passFail("pass 1 fail 2\n…\nv4: node pass 7 fail 0")).toEqual({ pass: 7, fail: 0 });
    expect(passFail("load error")).toBeNull();
  });

  it("plan tooling runs on the plan branch, app tests on the code tree", () => {
    const roots = { planRoot: "/plan", codeRoot: "/code" };
    expect(whereToRun("npm run plan:check", roots)).toBe("/plan");
    expect(whereToRun("npx vitest run src/__tests__/planBuild.test.ts", roots)).toBe("/plan");
    expect(whereToRun("npx vitest run src/__tests__/i18n.test.ts", roots)).toBe("/code");
    expect(whereToRun("npx vitest run src/__tests__/planBuild.test.ts src/__tests__/i18n.test.ts", roots)).toBe("/code");
  });

  it("a DONE task with a head sha and green dod keeps ✅ with evidence", () => {
    const plan = synthetic([{ id: "1", status: "✅ #202", pr: 202, verified: "browser", dod: ["npx vitest run a.test.ts"] }]);
    const res = migrateEvidence(plan, { audit: { "1": "DONE" }, headOf: { 202: SHA }, check: green });
    expect(res.kept).toEqual(["1"]);
    const t = res.plan.phases[0].tasks[0];
    expect(t.status).toBe("✅ #202");
    expect(t.evidence).toMatchObject({ verdict: "DONE", pr: 202, sha: SHA.slice(0, 10), checks: [{ cmd: "npx vitest run a.test.ts", pass: 3, total: 3 }] });
  });

  it("not DONE, no sha, or a red dod: back to ⏳ with the note, no evidence", () => {
    const plan = synthetic([
      { id: "a", status: "✅ #202", pr: 202, verified: "browser", dod: ["ok"] },
      { id: "b", status: "✅ #203", pr: 203, verified: "browser", dod: ["ok"] },
      { id: "c", status: "✅ #202", pr: 202, verified: "browser", dod: ["red"] },
      { id: "d", status: "⏳ #9", dod: ["red"] },
    ]);
    const check = (cmd: string) => (cmd === "red" ? [{ cmd, pass: 2, total: 3 }] : green(cmd));
    const res = migrateEvidence(plan, { audit: { a: "PARTIAL", b: "DONE", c: "DONE", d: "DONE" }, headOf: { 202: SHA }, check });
    expect(res.kept).toEqual([]);
    expect(res.dropped.map((d: { id: string }) => d.id)).toEqual(["a", "b", "c"]);
    for (const t of res.plan.phases[0].tasks.slice(0, 3)) {
      expect(t.status.startsWith(`⏳ ${DROP_NOTE}`)).toBe(true);
      expect(t.evidence).toBeUndefined();
    }
    expect(res.plan.phases[0].tasks[3]).toEqual(plan.phases[0].tasks[3]);
    expect(droppedStatus("✅ #202")).toBe("⏳ ביקורת 15.11: אין ראיה (היה ✅: #202)");
  });
});

describe("R12.14 the real plan after the migration", () => {
  const plan = JSON.parse(readFileSync(join(ROOT, "plan/plan.json"), "utf8"));
  const done: Task[] = plan.phases.flatMap((p: { tasks: Task[] }) => p.tasks).filter((t: Task) => (t.status ?? "").startsWith("✅"));

  it("every ✅ task has DONE evidence with a sha and all-green checks; nothing is exempt", () => {
    expect(done.length).toBeGreaterThan(0);
    const bad = done.filter((t) => !(t.evidence?.verdict === "DONE" && /^[0-9a-f]{7,40}$/.test(t.evidence.sha) && t.evidence.checks.length && t.evidence.checks.every((c) => c.total > 0 && c.pass === c.total)));
    expect(bad.map((t) => t.id)).toEqual([]);
    expect(Object.keys(plan).filter((k) => /grandfather|exempt/i.test(k))).toEqual([]);
  });

  it("each ✅ task's evidence names its own PR and one check per dod command", () => {
    for (const t of done) {
      expect(t.evidence!.pr).toBe(t.pr);
      expect(t.evidence!.checks.map((c) => c.cmd)).toEqual(t.dod);
    }
  });
});
