/**
 * W10.B12 — plan:check holds every ✅ against the audit's own verdicts
 * (plan/audit-verdicts.json), not only against the evidence a task carries:
 * a hand-edited `verdict: "DONE"` on a task the audit called PARTIAL fails.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { appendAudit, AUDIT_FILE, auditGuard, latestVerdicts, ledgerProblems, readLedger } from "../../scripts/plan/auditGuard.mjs";
import { run } from "../../scripts/plan/build.mjs";

const ROOT = resolve(__dirname, "../..");
const realPlan = () => JSON.parse(readFileSync(join(ROOT, "plan/plan.json"), "utf8"));
const realLedger = () => JSON.parse(readFileSync(join(ROOT, AUDIT_FILE), "utf8"));
const tasks = (p: { phases: { tasks: Record<string, unknown>[] }[] }) => p.phases.flatMap((ph) => ph.tasks);
const EVIDENCE = { verdict: "DONE", pr: 900, sha: "784ef2e1dd", checks: [{ cmd: "v4.sh x.test.ts", pass: 3, total: 3 }], audit: "r2 16.11 row" };

/** The real plan with one task (by id) turned ✅ with complete evidence. */
const promote = (id: string, evidence: Record<string, unknown> = EVIDENCE) => {
  const plan = realPlan();
  const t = tasks(plan).find((x) => x.id === id)!;
  t.status = "✅ #900";
  t.evidence = { ...evidence };
  return plan;
};
const partialId = () => Object.entries(realLedger().audits.at(-1).verdicts).find(([, v]) => v === "PARTIAL")![0];

describe("W10.B12 audit guard", () => {
  it("the plan and its ledger as they are pass; the ledger is the r2 audit, 818 verdicts", () => {
    const ledger = readLedger(ROOT);
    expect(ledgerProblems(ledger)).toEqual([]);
    expect(Object.keys(ledger.audits[0].verdicts)).toHaveLength(818);
    expect(auditGuard(realPlan(), ledger)).toEqual([]);
    // Every ✅ in the plan is DONE in the audit that judged it last.
    const latest = latestVerdicts(ledger);
    for (const t of tasks(realPlan()).filter((x) => String(x.status ?? "").startsWith("✅"))) expect(latest.get(t.id as string)?.verdict).toBe("DONE");
  });

  it("a ✅ on a task the audit called PARTIAL fails, even with evidence that claims DONE", () => {
    const id = partialId();
    const name = realLedger().audits.at(-1).name;
    const problems = auditGuard(promote(id), realLedger());
    expect(problems).toContain(`${id}: ✅ but the audit "${name}" called it PARTIAL — back to ⏳`);
    expect(problems).toContain(`${id}: its evidence says "DONE", the audit "${name}" says "PARTIAL"`);
  });

  it("a ✅ no audit has judged fails; a later audit that calls it DONE lets it pass", () => {
    const plan = realPlan();
    const unjudged = tasks(plan).find((t) => !latestVerdicts(realLedger()).has(t.id as string))!;
    unjudged.status = "✅ #900";
    unjudged.evidence = { ...EVIDENCE };
    expect(auditGuard(plan, realLedger())).toEqual([`${unjudged.id}: ✅ but no audit in ${AUDIT_FILE} has a verdict for it — back to ⏳ until one calls it DONE`]);
    const later = appendAudit(realLedger(), [{ id: unjudged.id as string, verdict: "DONE" }], { name: "r3", at: "2026-11-20" });
    expect(auditGuard(plan, later)).toEqual([]);
  });

  it("the last audit decides: a later PARTIAL takes a ✅ back", () => {
    const later = appendAudit(realLedger(), [{ id: "0.1", verdict: "PARTIAL" }], { name: "r3", at: "2026-11-20" });
    expect(auditGuard(realPlan(), later)).toContain('0.1: ✅ but the audit "r3" called it PARTIAL — back to ⏳');
  });

  it("a ✅ must cite the audit line it rests on", () => {
    const plan = realPlan();
    const t = tasks(plan).find((x) => x.id === "0.1")!;
    t.evidence = { ...(t.evidence as object), audit: " " };
    expect(auditGuard(plan, realLedger())).toEqual(["0.1: ✅ evidence does not cite the audit line it rests on (evidence.audit)"]);
  });

  it("deleting or breaking the ledger does not switch the rule off", () => {
    const done = tasks(realPlan()).filter((x) => String(x.status ?? "").startsWith("✅")).length;
    expect(done).toBeGreaterThan(0);
    expect(auditGuard(realPlan(), null)[0]).toBe(`plan/audit-verdicts.json is missing, and ${done} task(s) are ✅ — a ✅ needs the audit's DONE (W10.B12)`);
    expect(ledgerProblems({ audits: [] })).toEqual([`${AUDIT_FILE}: needs a non-empty "audits" list`]);
    expect(ledgerProblems({ audits: [{ name: "x", at: "2026-11-16", verdicts: { "0.1": "DONE-ish" } }] })[0]).toMatch(/0\.1 has verdict "DONE-ish"/);
    expect(() => appendAudit(realLedger(), [{ id: "0.1", verdict: "DONE" }], { name: "old", at: "2026-01-01" })).toThrow(/date order/);
    expect(() => appendAudit(null, [{ id: "a", verdict: "DONE" }, { id: "a", verdict: "PARTIAL" }], { name: "x", at: "2026-11-16" })).toThrow(/two different verdicts/);
  });

  it("plan:check (build.mjs) fails on a ✅ the audit did not call DONE, and on a missing ledger", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-"));
    try {
      mkdirSync(join(dir, "plan"));
      const id = partialId();
      writeFileSync(join(dir, "plan/plan.json"), JSON.stringify(promote(id)));
      writeFileSync(join(dir, AUDIT_FILE), JSON.stringify(realLedger()));
      expect(() => run({ root: dir, check: true })).toThrow(new RegExp(`the audit did not call DONE[\\s\\S]*${id.replace(".", "\\.")}: ✅ but the audit`));
      writeFileSync(join(dir, "plan/plan.json"), JSON.stringify(realPlan()));
      rmSync(join(dir, AUDIT_FILE));
      expect(() => run({ root: dir, check: true })).toThrow(/audit-verdicts\.json is missing/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
