/**
 * Decision D1 §9 (16.11.2026): the PRs stacked on older trains stay open,
 * superseded by verify/train-7, with a ledger (plan/stacked-prs-ledger.json).
 * Every row outside the train has its decision in plan/train-missing.json at
 * the same head; the counts add up; nothing in the ledger says "close".
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
type Row = { pr: number; head: string; branch: string; base: string; inTrain: boolean; decision?: string };
const ledger = JSON.parse(readFileSync(join(ROOT, "plan/stacked-prs-ledger.json"), "utf8")) as { train: string; trainHead: string; counts: Record<string, number>; rows: Row[]; about: string };
const missing = JSON.parse(readFileSync(join(ROOT, "plan/train-missing.json"), "utf8")) as { decisions: Array<{ pr: number; head: string; decision: string }> };

describe("the stacked-PR ledger (D1 §9)", () => {
  it("is about verify/train-7, one row per PR, on an older base, with counts that add up", () => {
    expect(ledger.train).toBe("verify/train-7");
    expect(ledger.trainHead).toMatch(/^[0-9a-f]{40}$/);
    const prs = ledger.rows.map((r) => r.pr);
    expect(new Set(prs).size).toBe(prs.length);
    expect(ledger.rows.every((r) => r.base !== "verify/train-7" && r.base !== "main" && /^[0-9a-f]{40}$/.test(r.head))).toBe(true);
    expect(ledger.counts.stacked).toBe(ledger.rows.length);
    expect(ledger.counts.inTrain + ledger.counts.outside).toBe(ledger.rows.length);
    expect(ledger.counts.inTrain).toBe(ledger.rows.filter((r) => r.inTrain).length);
    expect(ledger.counts.w10).toBe(ledger.rows.filter((r) => r.branch.startsWith("w10/")).length);
  });

  it("every PR outside the train has a decision in train-missing.json at the same head", () => {
    const by = new Map(missing.decisions.map((d) => [d.pr, d]));
    for (const r of ledger.rows.filter((x) => !x.inTrain)) {
      const d = by.get(r.pr);
      expect(d, `#${r.pr}`).toBeTruthy();
      expect(d!.head, `#${r.pr}`).toBe(r.head);
      expect(r.decision).toBe(d!.decision);
    }
  });

  it("the policy keeps them open: no lane closes one", () => {
    expect(ledger.about).toMatch(/stay open; none is closed by a lane/);
    expect(JSON.stringify(ledger.rows)).not.toMatch(/"close/);
  });
});
