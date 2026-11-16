/**
 * W9.8: the row-by-row proof (plan/w98-ledger.json, scripts/plan/w98-ledger.mjs).
 * Every needs-code = y row of plan/decisions-2026-11-14.md has a ledger row;
 * a "done" row names commits in the train and tests that exist and hold the
 * named test; every other row says what is owed. Running the cited tests is
 * `node scripts/plan/w98-ledger.mjs --runner <shim>` (not here: one runner
 * inside another).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error — a plain .mjs script
import { DECISIONS, LEDGER, counts, ledgerProblems, markdown, nameFilter, needsCodeRows } from "../../scripts/plan/w98-ledger.mjs";

const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : null);
const wanted = needsCodeRows(readFileSync(DECISIONS, "utf8"));
const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
const inGit = (() => {
  try {
    execFileSync("git", ["rev-parse", "HEAD"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const isAncestor = (c: string) => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", c, "HEAD"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

describe("the W9.8 ledger", () => {
  it("reads the 48 needs-code = y rows of the decisions", () => {
    expect(wanted).toHaveLength(48);
    expect(wanted[0]).toMatchObject({ step: "2.9", pr: "#235" });
    expect(new Set(wanted.map((w: { step: string }) => w.step)).size).toBe(48);
  });

  it("the committed ledger has no problem: every row, every commit in the train, every named test in its file", () => {
    const io = { read, isAncestor: inGit ? isAncestor : () => true };
    expect(ledgerProblems(ledger, wanted, io)).toEqual([]);
    expect(counts(ledger)).toEqual({ done: 31, "deps-train": 15, "owner-act": 1, open: 1 });
  });

  it("the committed plan/w98-ledger.md lists every row with its status", () => {
    const md = readFileSync("plan/w98-ledger.md", "utf8");
    for (const w of wanted) expect(md, w.step).toMatch(new RegExp(`^\\| ${w.step.replace(".", "\\.")} \\| ${w.pr} \\| .* \\| ${ledger.rows[w.step].status} \\|`, "m"));
    // The table without results is what --markdown writes; the committed one adds the runner's counts in the proof column.
    expect(markdown(ledger, wanted).split("\n").length).toBe(md.split("\n").length);
  });

  const io = { read: (f: string) => (f === "t.test.ts" ? 'it("the fix (2.9)", () => {})' : f === "doc.md" ? "the sentence" : null), isAncestor: (c: string) => c === "aaaa" };
  const one = (row: unknown) => ledgerProblems({ rows: { "2.9": row } }, [{ step: "2.9" }], io);
  it("refuses a missing row, an extra row, and an unknown status", () => {
    expect(ledgerProblems({ rows: {} }, [{ step: "2.9" }], io)).toEqual(["2.9: a needs-code row with no ledger row"]);
    expect(ledgerProblems({ rows: { "2.9": { status: "open", note: "x" }, "9.9": { status: "open", note: "x" } } }, [{ step: "2.9" }], io)).toEqual(["9.9: in the ledger but not a needs-code = y row"]);
    expect(one({ status: "maybe" })[0]).toMatch(/is not one of/);
  });
  it("a done row needs commits in the train and a test that holds the named test, or a probe", () => {
    expect(one({ status: "done", commits: ["aaaa"], tests: [{ file: "t.test.ts", match: "(2.9)" }] })).toEqual([]);
    expect(one({ status: "done", commits: ["bbbb"], tests: [{ file: "t.test.ts", match: "(2.9)" }] })).toEqual(["2.9: commit bbbb is not an ancestor of HEAD"]);
    expect(one({ status: "done", commits: ["aaaa"], tests: [{ file: "t.test.ts", match: "(2.10)" }] })).toEqual(['2.9: t.test.ts holds no test "(2.10)"']);
    expect(one({ status: "done", commits: ["aaaa"], tests: [{ file: "gone.test.ts", match: "" }] })).toEqual(["2.9: test file gone.test.ts is missing"]);
    expect(one({ status: "done", commits: ["aaaa"] })).toEqual(["2.9: done, with neither a test nor a probe"]);
    expect(one({ status: "done", commits: [], probes: [{ file: "doc.md", contains: "the sentence" }] })).toEqual([]);
    expect(one({ status: "done", commits: [], probes: [{ file: "doc.md", contains: "another" }] })[0]).toMatch(/does not hold/);
  });
  it("a row that is not done says what is owed", () => {
    expect(one({ status: "deps-train" })).toEqual(["2.9: a deps-train row must say what is owed (note)"]);
    expect(one({ status: "open", note: "the Worker routes" })).toEqual([]);
  });
  it("the runner's name filter has no character a shell splits or globs on", () => {
    const f = nameFilter("2.19: a PDF can't be renamed (2.9, Codex P2) *x? [y]");
    expect(f).not.toMatch(/[\s'*?[\]]/);
    expect(new RegExp(f).test("2.19: a PDF can't be renamed (2.9, Codex P2) *x? [y]")).toBe(true);
  });
});
