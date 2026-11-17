/**
 * Review 12, M2: work merged into the train while its wave was frozen.
 *
 * W13.X1 and W13.X2 shipped in the train (#1016, #1019, #1072), but the WIP
 * gate refused them a status, so the plan showed them "not started" and their
 * evidence was deleted. plan/merged-while-frozen.json records such work
 * honestly instead:
 *
 *   { "id": "W13.X1", "prs": [1016, 1072], "mergeSha": "<the merge into the train>", "at": "2026-11-16" }
 *
 * - it is append-only (scripts/plan/ledgerRatchet.mjs) and owned in CODEOWNERS;
 * - every mergeSha is an ancestor of the train (the checkout's HEAD);
 * - isStarted counts the listed ids, wipGate accepts exactly them, and the
 *   board shows them as "merged, held by frozen wave";
 * - plan:check fails when a commit in the train that touches code names a task
 *   in its subject while the task has no status and is not on the list.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const MERGED_FILE = "plan/merged-while-frozen.json";
export const HELD_LABEL = "merged, held by frozen wave";

/** The parsed file, or null when there is none (a malformed file is an error, not "none"). */
export function readMerged(root) {
  const p = join(root, MERGED_FILE);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

export const mergedEntries = (file) => (file && Array.isArray(file.merged) ? file.merged : []);
export const mergedIds = (file) => new Set(mergedEntries(file).map((e) => e?.id).filter((id) => typeof id === "string"));

/**
 * Problems with the file's entries: shape, ids that are not in the plan, a
 * mergeSha that is not an ancestor of the train. `isAncestor(sha)` answers
 * the last; without it that check is skipped.
 */
export function mergedProblems(file, planIds, isAncestor) {
  if (file === null) return [];
  if (!file || !Array.isArray(file.merged)) return [`${MERGED_FILE}: needs a "merged" list`];
  const problems = [];
  const seen = new Set();
  for (const e of file.merged) {
    const at = `${MERGED_FILE} ${e?.id ?? JSON.stringify(e)}`;
    if (!e || typeof e.id !== "string") {
      problems.push(`${at}: an entry needs an id`);
      continue;
    }
    if (seen.has(e.id)) problems.push(`${at}: listed twice`);
    seen.add(e.id);
    if (!planIds.has(e.id)) problems.push(`${at}: no such task in the plan`);
    if (!Array.isArray(e.prs) || !e.prs.length || !e.prs.every((n) => Number.isInteger(n) && n > 0)) problems.push(`${at}: "prs" lists the merged PR numbers`);
    if (typeof e.mergeSha !== "string" || !/^[0-9a-f]{40}$/.test(e.mergeSha)) problems.push(`${at}: "mergeSha" is the full sha of the merge into the train`);
    else if (isAncestor && !isAncestor(e.mergeSha)) problems.push(`${at}: ${e.mergeSha.slice(0, 10)} is not an ancestor of the train`);
    if (typeof e.at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.at)) problems.push(`${at}: "at" is the merge date (YYYY-MM-DD)`);
  }
  return problems;
}

/** `git merge-base --is-ancestor sha HEAD` at `root`; null outside a git checkout of its own (a copy of the plan files). */
export function ancestorOfHead(root) {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" });
  if (top.status !== 0 || resolve(top.stdout.trim()) !== resolve(root)) return null;
  return (sha) => spawnSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: root }).status === 0;
}

const PLAN_ONLY = /^(plan\/|MASTER_PLAN\.md$|public\/roadmap\.html$)/;
const ID = /(?<![\w.])((?:W|R)\d+\.[A-Z]?\d+|\d+\.\d+)(?![\w.]*\d)/g;

/**
 * The tasks named in the subject of a commit in the train that touches more
 * than the plan: Map(id → [short sha + subject]). `log` is the output of
 * `git log --no-merges --no-renames --name-only --format=%x00%H %s HEAD`.
 */
export function namedInCode(log, planIds) {
  const out = new Map();
  for (const chunk of String(log).split("\0").slice(1)) {
    const [head, ...files] = chunk.trim().split("\n");
    const sp = head.indexOf(" ");
    const subject = head.slice(sp + 1);
    if (!files.some((f) => f && !PLAN_ONLY.test(f))) continue;
    for (const m of subject.matchAll(ID)) {
      if (!planIds.has(m[1])) continue;
      if (!out.has(m[1])) out.set(m[1], []);
      out.get(m[1]).push(`${head.slice(0, 10)} ${subject.slice(0, 80)}`);
    }
  }
  return out;
}

export function gitNamedLog(root) {
  if (!ancestorOfHead(root)) return null;
  const r = spawnSync("git", ["log", "--no-merges", "--no-renames", "--name-only", "--format=%x00%H %s", "HEAD"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stdout : null;
}

/** Problems: a task named by merged code, with no status, and not on the list. `started(task)` is build.mjs's isStarted. */
export function unlistedMergedWork(plan, named, merged, started) {
  const problems = [];
  for (const t of plan.phases.flatMap((p) => p.tasks)) {
    const hits = named.get(t.id);
    if (!hits || merged.has(t.id) || started(t)) continue;
    problems.push(`${t.id}: named by ${hits.length} merged commit(s) that touch code (${hits[0]}) but has no status — give it its honest status, or record it in ${MERGED_FILE} if its wave is frozen (review 12, M2)`);
  }
  return problems;
}
