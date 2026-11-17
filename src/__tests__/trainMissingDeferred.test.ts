/**
 * Review 12, L5 and L6.
 * L5: train-missing used "in" for PRs left out on purpose until an owner
 * decision. "deferred" (with what it waits for, `until`) is its own value now,
 * and an "in" whose reason says "left out on purpose" is refused.
 * L6: the #1099 merge (an OWNER-DECISION draft a lane note said must not be
 * merged by a lane) is recorded in plan/decisions-2026-11-16-d1.md as made
 * under the owner's delegation.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { DECISIONS, DECISIONS_FILE, checkDecisions, report } from "../../scripts/train-missing.mjs";

const ROOT = resolve(__dirname, "../..");
const H = "dea50af7307387a6348d38ce6b33edeb974b77c3";
const reason = "Left out on purpose: the owner decides this first (owner pack).";

describe("train-missing: deferred is its own decision (review 12, L5)", () => {
  it("'deferred' needs what it waits for; an 'in' left out on purpose is refused", () => {
    expect(DECISIONS).toContain("deferred");
    expect(checkDecisions({ decisions: [{ pr: 1, head: H, decision: "deferred", reason, until: "the owner's decision" }] })).toEqual([]);
    expect(checkDecisions({ decisions: [{ pr: 1, head: H, decision: "deferred", reason }] })[0]).toMatch(/"deferred" names what it waits for/);
    expect(checkDecisions({ decisions: [{ pr: 1, head: H, decision: "in", via: "0.4", reason }] })[0]).toMatch(/is "deferred" \(with until\), not "in"/);
  });

  it("the report counts deferred apart, and the repo's file has its deferrals as deferred", () => {
    const v = { inTrain: [], decided: [{ pr: 1, decision: "deferred" }, { pr: 2, decision: "in" }], stale: [], undecided: [], gone: [], problems: [], ok: true };
    expect(report(v, "verify/train-7").join("\n")).toMatch(/Decisions: in 1 · deferred 1 · rejected 0 · replaced 0\./);
    const file = JSON.parse(readFileSync(join(ROOT, DECISIONS_FILE), "utf8"));
    expect(checkDecisions(file)).toEqual([]);
    const deferred = file.decisions.filter((d: { decision: string }) => d.decision === "deferred").map((d: { pr: number }) => d.pr);
    expect(deferred).toEqual(expect.arrayContaining([1080, 1084, 1090, 1091, 1092, 1101]));
  });
});

describe("the #1099 merge is on the record (review 12, L6)", () => {
  it("plan/decisions-2026-11-16-d1.md names it as made under the owner's delegation, and its merge is in the train", () => {
    const doc = readFileSync(join(ROOT, "plan/decisions-2026-11-16-d1.md"), "utf8");
    const sec = doc.slice(doc.indexOf("## §11"));
    expect(sec).toMatch(/^## §11 The #1099 merge/);
    expect(sec).toMatch(/under the owner's delegation of 16\.11\.2026 21:53/);
    expect(sec).toMatch(/dad246d41d/);
    expect(doc).toMatch(/Acknowledging the #1099 merge \(§11\)/);
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", "dad246d41d", "HEAD"], { cwd: ROOT, stdio: "ignore" });
    } catch (e) {
      // why: exit 1 is "not an ancestor", the claim that must hold; 128 is a checkout without that history
      if ((e as { status?: number }).status === 1) throw new Error("dad246d41d is not in the train");
    }
  });
});
