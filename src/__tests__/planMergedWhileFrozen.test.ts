// @vitest-environment node
/**
 * Review 12, M2 and M3.
 *
 * M2: W13 work was merged while the plan showed it not started, because the
 * evidence was deleted to get past the frozen-wave gate. Now
 * plan/merged-while-frozen.json records it (append-only, CODEOWNERS, every
 * mergeSha an ancestor of the train); isStarted counts the listed ids,
 * wipGate accepts exactly them, the board says "merged, held by frozen wave",
 * and plan:check fails when merged code names a task with no status that is
 * not on the list.
 *
 * M3: the ratchets are enforced. ledgerRatchet runs in plan:check and in
 * ci:local (plan:ratchet), against the PR's base or, on the train itself,
 * HEAD^1 (it used to compare HEAD with itself). The WIP decisions moved to
 * plan/wip-decisions.json (CODEOWNERS) and freeze ids: open and started only
 * go down, and a swap of one task for another fails.
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { isStarted, wipWarnings } from "../../scripts/plan/build.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { wipGate } from "../../scripts/plan/wipGate.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { wipDecisionProblems } from "../../scripts/plan/wipDecisions.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { HELD_LABEL, MERGED_FILE, gitNamedLog, mergedIds, mergedProblems, namedInCode, unlistedMergedWork } from "../../scripts/plan/mergedWhileFrozen.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { auditHash, baseCommit, checkRoot, decisionsOnlyLower, mergedOnlyAppend } from "../../scripts/plan/ledgerRatchet.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { planSteps } from "../../scripts/lib/ciLocal.mjs";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => JSON.parse(readFileSync(join(ROOT, f), "utf8"));
const scratch: string[] = [];
afterAll(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));
const PLACEHOLDER = "⏳ גל 13 — לא התחיל";
type Task = { id: string; status?: string; verified?: string };
const wave = (n: number, tasks: Task[]) => ({ title: `גל ${n} — x`, tasks });
const open = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `W1.${i}`, status: "⏳ #1", verified: "built" }));

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "lumen-m2m3-"));
  scratch.push(dir);
  const git = (...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...a], { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  const commit = (f: string, body: string) => {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), body);
    git("add", "-A");
    git("commit", "-q", "-m", f);
    return git("rev-parse", "HEAD").stdout.trim();
  };
  return { dir, git, commit };
}

describe("plan/merged-while-frozen.json (review 12, M2)", () => {
  it("isStarted counts a listed id whatever its status says", () => {
    expect(isStarted({ id: "W13.X1", status: PLACEHOLDER })).toBe(false);
    expect(isStarted({ id: "W13.X1", status: PLACEHOLDER }, new Set(["W13.X1"]))).toBe(true);
    const plan = { schedule: {}, phases: [wave(1, open(6)), wave(2, [{ id: "W2.1", status: "⏳ גל 2 — לא התחיל" }])] };
    expect(wipWarnings(plan)).toEqual([]);
    expect(wipWarnings(plan, { merged: new Set(["W2.1"]) })[0].started).toEqual(["W2.1"]);
  });

  it("the frozen-wave gate accepts exactly the listed ids, and never calls them stale", () => {
    const warnings = [{ wave: 12, next: 13, started: ["W13.X1", "W13.X2", "W13.E1"] }];
    const g = wipGate(warnings, { started: [] }, new Set(["W13.X1", "W13.X2", "W9.8"]));
    expect(g.blocked.map((b: { id: string }) => b.id)).toEqual(["W13.E1"]);
    expect(g.stale).toEqual([]);
    expect(wipGate(warnings, { started: [] }).blocked).toHaveLength(3);
  });

  it("entries are checked: shape, a task of the plan, a mergeSha that is an ancestor of the train", () => {
    const r = repo();
    const a = r.commit("a.txt", "a");
    r.git("checkout", "-q", "-b", "side");
    const side = r.commit("b.txt", "b");
    r.git("checkout", "-q", "main");
    const anc = (sha: string) => r.git("merge-base", "--is-ancestor", sha, "HEAD").status === 0;
    const ok = { id: "W13.X1", prs: [1016], mergeSha: a, at: "2026-11-16" };
    expect(mergedProblems({ merged: [ok] }, new Set(["W13.X1"]), anc)).toEqual([]);
    expect(mergedProblems({ merged: [{ ...ok, mergeSha: side }] }, new Set(["W13.X1"]), anc)[0]).toMatch(/not an ancestor of the train/);
    expect(mergedProblems({ merged: [{ ...ok, id: "W99.Z9" }] }, new Set(["W13.X1"]), anc)[0]).toMatch(/no such task/);
    expect(mergedProblems({ merged: [{ ...ok, prs: [] }, { ...ok, at: "16.11" }] }, new Set(["W13.X1"]), anc).join("\n")).toMatch(/"prs"[\s\S]*listed twice[\s\S]*"at"/);
  });

  it("plan:check's rule: merged code that names a task with no status fails unless the task is on the list", () => {
    const log = `\0aaaaaaaaaa1 feat(mcp): allow-list (W13.X1) [skip ci]\nsrc-tauri/x.rs\n\0bbbbbbbbbb2 plan: W13.E1 notes [skip ci]\nplan/plan.json\n`;
    const ids = new Set(["W13.X1", "W13.E1"]);
    const named = namedInCode(log, ids);
    expect([...named.keys()]).toEqual(["W13.X1"]);
    const plan = { phases: [wave(13, [{ id: "W13.X1", status: PLACEHOLDER }, { id: "W13.E1", status: PLACEHOLDER }])] };
    expect(unlistedMergedWork(plan, named, new Set(), (t: Task) => isStarted(t))[0]).toMatch(/W13\.X1: named by 1 merged commit/);
    expect(unlistedMergedWork(plan, named, new Set(["W13.X1"]), (t: Task) => isStarted(t, new Set(["W13.X1"])))).toEqual([]);
  });

  it("this repo: W13.X1 and W13.X2 are on the list, ancestors of HEAD, with their status and evidence back; dropping X1 from the list fails", () => {
    const file = read(MERGED_FILE);
    const ids = mergedIds(file);
    for (const id of ["W13.X1", "W13.X2"]) expect(ids.has(id)).toBe(true);
    const plan = read("plan/plan.json");
    const tasks = plan.phases.flatMap((p: { tasks: Task[] }) => p.tasks);
    const planIds = new Set<string>(tasks.map((t: Task) => t.id));
    const anc = (sha: string) => spawnSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: ROOT }).status === 0;
    expect(mergedProblems(file, planIds, anc)).toEqual([]);
    const x1 = tasks.find((t: Task) => t.id === "W13.X1");
    expect(x1.status).toMatch(/^⏳ #1016/);
    expect(x1.evidence?.checks?.length).toBeGreaterThan(0);
    const log = gitNamedLog(ROOT);
    if (log === null) return; // why: not a git checkout (a source tarball); the rule runs only with history
    const named = namedInCode(log, planIds);
    const stripped = { phases: plan.phases.map((p: { tasks: Task[] }) => ({ ...p, tasks: p.tasks.map((t: Task) => (t.id === "W13.X1" ? { id: t.id, status: PLACEHOLDER } : t)) })) };
    const without = new Set([...ids].filter((id) => id !== "W13.X1"));
    expect(unlistedMergedWork(stripped, named, without, (t: Task) => isStarted(t, without))).toEqual([expect.stringMatching(/^W13\.X1: named by/)]);
  });

  it("the board shows the listed tasks as merged, held by frozen wave", () => {
    const md = readFileSync(join(ROOT, "MASTER_PLAN.md"), "utf8");
    expect(md.split("\n").find((l) => l.startsWith("| W13.X1 |"))).toContain(HELD_LABEL);
    expect(readFileSync(join(ROOT, "plan/board.html"), "utf8")).toContain(`<span class="pill p-held">${HELD_LABEL}</span>`);
  });

  it("the list is append-only", () => {
    const e1 = { id: "W13.X1", prs: [1016], mergeSha: "a".repeat(40), at: "2026-11-16" };
    const e2 = { id: "W13.X2", prs: [1019], mergeSha: "b".repeat(40), at: "2026-11-16" };
    expect(mergedOnlyAppend([auditHash(e1)], { merged: [e1, e2] })).toEqual([]);
    expect(mergedOnlyAppend([auditHash(e1), auditHash(e2)], { merged: [e1] })[0]).toMatch(/removed/);
    expect(mergedOnlyAppend([auditHash(e1)], { merged: [{ ...e1, prs: [1] }] })[0]).toMatch(/changed/);
  });
});

describe("the WIP decisions are a ratchet that is enforced (review 12, M3)", () => {
  const d = (o: object = {}) => ({ wave: 1, next: 2, open: 6, started: 1, openIds: open(6).map((t) => t.id), startedIds: ["W2.1"], at: "2026-11-16", decision: "written down", ...o });

  it("a decision freezes ids: verifying one open task and opening another (same counts) fails", () => {
    const plan = (w1: Task[]) => ({ schedule: { wipDecisions: [d()] }, phases: [wave(1, w1), wave(2, [{ id: "W2.1", status: "⏳ #9" }])] });
    const same = plan(open(6));
    expect(wipDecisionProblems(same, wipWarnings(same))).toEqual([]);
    const swapped = plan([...open(5), { id: "W1.99", status: "⏳ #2", verified: "built" }]);
    expect(wipDecisionProblems(swapped, wipWarnings(swapped)).join("\n")).toMatch(/W1\.99[^\n]*not in the frozen "openIds"[\s\S]*W1\.5[^\n]*remove from "openIds"/);
  });

  it("against the base, open and started only go down; growth only for work newly recorded as merged", () => {
    const base = [d()];
    expect(decisionsOnlyLower(base, [d({ open: 5, openIds: open(5).map((t) => t.id) })])).toEqual([]);
    expect(decisionsOnlyLower(base, [d({ started: 2, startedIds: ["W2.1", "W2.2"] })]).join("\n")).toMatch(/W2\.2 added to "startedIds"[\s\S]*"started" went up from 1 to 2/);
    expect(decisionsOnlyLower(base, [d({ started: 2, startedIds: ["W2.1", "W2.2"] })], new Set(["W2.2"]))).toEqual([]);
    expect(decisionsOnlyLower(base, [d({ started: 2 })]).join("\n")).toMatch(/"started" went up/);
    // A base from before the ids (counts only): growth only by newly merged ids.
    const counts = [{ wave: 1, next: 2, open: 6, started: 1 }];
    expect(decisionsOnlyLower(counts, [d({ started: 2, startedIds: ["W2.1", "W2.2"] })]).join("\n")).toMatch(/"started" went up/);
    expect(decisionsOnlyLower(counts, [d({ started: 2, startedIds: ["W2.1", "W2.2"] })], new Set(["W2.2"]))).toEqual([]);
    // A new pair freezes its ids, and holds only exempt or merged starts.
    expect(decisionsOnlyLower([], [d({ startedIds: undefined })])[0]).toMatch(/freezes its "startedIds"/);
    expect(decisionsOnlyLower([], [d()], new Set(), new Set())[0]).toMatch(/not W2\.1/);
    expect(decisionsOnlyLower([], [d()], new Set(), new Set(["W2.1"]))).toEqual([]);
  });

  it("on the train itself the base is HEAD^1, not HEAD; on a branch it is the merge base", () => {
    const r = repo();
    const first = r.commit("a.txt", "a");
    const second = r.commit("b.txt", "b");
    r.git("branch", "train");
    const g = (...a: string[]) => r.git(...a);
    expect(baseCommit(g, "train")).toMatchObject({ sha: first });
    r.git("checkout", "-q", "-b", "pr");
    r.commit("c.txt", "c");
    expect(baseCommit(g, "train")).toMatchObject({ sha: second });
  });

  it("an integration merge that raises a decision is caught (the ratchet compares with HEAD^1)", () => {
    const r = repo();
    const dec = (started: number) => JSON.stringify({ decisions: [{ ...d(), started, startedIds: ["W2.1", "W2.2"].slice(0, started) }] });
    mkdirSync(join(r.dir, "plan"), { recursive: true });
    r.commit("plan/wip-decisions.json", dec(1));
    r.git("branch", "train");
    r.git("checkout", "-q", "-b", "lane");
    r.commit("plan/wip-decisions.json", dec(2));
    r.git("checkout", "-q", "train");
    r.git("merge", "-q", "--no-ff", "-m", "merge lane", "lane");
    expect(checkRoot(r.dir, ["train"]).problems.join("\n")).toMatch(/"started" went up from 1 to 2/);
  });

  it("wired in: plan:ratchet in package.json, a ci:local step with the PR's base, and CODEOWNERS for the files", () => {
    const pkg = read("package.json");
    expect(pkg.scripts["plan:ratchet"]).toBe("node scripts/plan/ledgerRatchet.mjs");
    const steps = planSteps({ pkg, exists: () => true, changed: null, flags: { base: "origin/verify/train-7" }, dynamicTargets: new Set() });
    expect(steps.find((s: { id: string }) => s.id === "plan-ratchet")?.cmd).toEqual(["npm", "run", "-s", "plan:ratchet", "--", "--base", "origin/verify/train-7"]);
    const owners = readFileSync(join(ROOT, ".github/CODEOWNERS"), "utf8");
    for (const f of ["/plan/wip-decisions.json", "/scripts/plan/wipDecisions.mjs", "/plan/merged-while-frozen.json"]) expect(owners).toMatch(new RegExp(`^${f.replace(/[.*/]/g, "\\$&")}\\s+@talstilkol`, "m"));
    expect(existsSync(join(ROOT, "plan/wip-decisions.json"))).toBe(true);
    expect(read("plan/plan.json").schedule.wipDecisions).toBeUndefined();
  });
});
