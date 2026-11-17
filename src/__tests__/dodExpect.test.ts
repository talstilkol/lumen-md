/**
 * Audit r3: dod.mjs checked exit codes only, so W6.39 ("exit 0 with no flag —
 * … no wave is over its WIP limit") showed green while `npm run plan:check`
 * printed ten WIP warnings. A dod command is now held to the machine-checkable
 * part of its dodExpect; an unmet one is red, "expect unmet".
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs script, no types
import { parseExpect, unmetExpect } from "../../scripts/lib/dodExpect.mjs";
// @ts-expect-error -- plain .mjs script, no types
import { runCommand, runTasks } from "../../scripts/lib/dodRunner.mjs";
// @ts-expect-error -- plain .mjs script, no types
import { runDod, shellPasses } from "../../scripts/dod.mjs";

const WIP_EXPECT = "exit 0 with no flag — strict by default, and no wave is over its WIP limit while the next wave has started (today it exits 1: 11 waves over)";
const WIP_OUT = [
  "plan: WIP — wave 1 has 24 ⏳ tasks verified below browser (limit 5) while wave 2 has 25 started (W2.1 …).",
  "plan: WIP — wave 2 has 19 ⏳ tasks verified below browser (limit 5) while wave 3 has 11 started (W3.1 …).",
  "plan: MASTER_PLAN.md, plan/board.html and public/roadmap.html match plan/plan.json",
].join("\n") + "\n";
const CLEAN_OUT = "plan: MASTER_PLAN.md, plan/board.html and public/roadmap.html match plan/plan.json\n";

describe("dodExpect: the machine-checkable clauses", () => {
  it("reads exit codes, prints, absences, counts, 0 failed and known phrases; notes in parentheses are not clauses", () => {
    expect(parseExpect("exit 0").map((c: { kind: string }) => c.kind)).toEqual(["exit"]);
    expect(parseExpect("exit 0 — prints human-reviewed")).toMatchObject([{ kind: "exit", code: 0 }, { kind: "prints", text: "human-reviewed" }]);
    expect(parseExpect("exit 0 — prints no `WIP —`")).toMatchObject([{ kind: "exit" }, { kind: "absent", text: "WIP —" }]);
    expect(parseExpect("exit 0 on the Mac — 6/6 steps")).toMatchObject([{ kind: "exit" }, { kind: "count", text: "6/6" }]);
    expect(parseExpect("exit 0 — Python and TS agree on every vector (51/51 on 16.11)").map((c: { kind: string }) => c.kind)).toEqual(["exit"]);
    expect(parseExpect(WIP_EXPECT).map((c: { kind: string }) => c.kind)).toEqual(["exit", "phrase"]);
    expect(parseExpect("exit 0 — 0 failed, 0 skipped without a reason").map((c: { kind: string }) => c.kind)).toEqual(["exit", "zero-failed"]);
    expect(parseExpect("exit 0 — card complete").map((c: { kind: string }) => c.kind)).toEqual(["exit"]);
  });

  it("an unmet clause is reported; a met one or prose says nothing", () => {
    expect(unmetExpect(WIP_EXPECT, { code: 0, out: WIP_OUT })[0]).toMatch(/^2 × a wave over its WIP limit/);
    expect(unmetExpect(WIP_EXPECT, { code: 0, out: CLEAN_OUT })).toEqual([]);
    expect(unmetExpect("exit 0 — prints human-reviewed", { code: 0, out: "human-reviewed\n" })).toEqual([]);
    expect(unmetExpect("exit 0 — prints human-reviewed", { code: 0, out: "" })).toEqual(['does not print "human-reviewed"']);
    expect(unmetExpect("exit 0 on the Mac — 6/6 steps", { code: 0, out: "steps 5/6" })).toEqual(["no 6/6 in the output"]);
    expect(unmetExpect("exit 0 on the Mac — 6/6 steps", { code: 0, out: "steps 6/6" })).toEqual([]);
    expect(unmetExpect("exit 0 — 0 failed", { code: 0, out: "Tests  3 failed | 40 passed" })).toEqual(["3 failed"]);
    expect(unmetExpect("exit 0 — 0 failed", { code: 0, out: "0 failed, 40 passed" })).toEqual([]);
    expect(unmetExpect("exit 0 — no problem lines", { code: 0, out: "12 tasks with a dod\n  ✗ 0.4: dod must be a list" })).toHaveLength(1);
    expect(unmetExpect("exit 1", { code: 0, out: "" })).toEqual(["exit 1 expected, got 0"]);
  });
});

describe("dod.mjs and the runner hold a command to its dodExpect", () => {
  const fake = (status: number, stdout: string) => () => ({ status, stdout, stderr: "" });

  it("W6.39: plan:check exits 0 with WIP warnings — red (expect unmet), and green once there are none", () => {
    expect(shellPasses("npm run plan:check", ".", fake(0, WIP_OUT), WIP_EXPECT)).toBe(false);
    expect(shellPasses("npm run plan:check", ".", fake(0, CLEAN_OUT), WIP_EXPECT)).toBe(true);
    // A command whose expected exit is not 0.
    expect(shellPasses("! grep -q x f", ".", fake(1, ""), "exit 1 — the pattern is absent")).toBe(true);
  });

  it("runDod passes each command its own expectation", () => {
    const seen: Array<[string, string | undefined]> = [];
    const results = runDod([{ id: "W6.39", dod: ["a", "b"], dodExpect: ["exit 0", WIP_EXPECT] }], {
      exec: (cmd: string, _root: string, expectText?: string) => (seen.push([cmd, expectText]), cmd === "a"),
      log: () => {},
    });
    expect(seen).toEqual([["a", "exit 0"], ["b", WIP_EXPECT]]);
    expect(results[0]).toMatchObject({ ok: false, failed: "b" });
  });

  it("the report run marks an unmet expectation red with the reason", async () => {
    const run = async () => ({ code: 0, out: WIP_OUT });
    const r = await runCommand("npm run plan:check", { root: ".", run, expect: WIP_EXPECT });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/^exit 0 — expect unmet: 2 × a wave over its WIP limit/);
    const rows = await runTasks([{ id: "W6.39", title: "strict", dod: ["npm run plan:check"], dodExpect: [WIP_EXPECT] }], { root: ".", run });
    expect(rows[0].verdict).toBe("red");
    const clean = await runTasks([{ id: "W6.39", title: "strict", dod: ["npm run plan:check"], dodExpect: [WIP_EXPECT] }], { root: ".", run: async () => ({ code: 0, out: CLEAN_OUT }) });
    expect(clean[0].verdict).toBe("green");
  });
});
