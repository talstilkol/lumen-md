#!/usr/bin/env node
/**
 * Plan R12.14 migration — give every ✅ task the `evidence` block the honest-status
 * rule (scripts/plan/claimGuard.mjs, #868) needs, with no task grandfathered (W10.G5).
 *
 *   node scripts/plan/migrate-evidence.mjs --audit <merged.json> --shas <pr-shas.tsv> \
 *        --tree <code checkout> --runner '<command that runs one test file; {root} and {file} are replaced>' [--write]
 *
 * This branch holds the plan, not the app's code, so a dod command runs in --tree (a
 * checkout of the newest train, e.g. verify/train-6) — except the plan tooling's own
 * checks (plan:check, PLAN_TOOLING_TESTS), which run on this branch, against this plan. Each check records where it ran as `ranOn`.
 *
 * For each ✅ task:
 *   - the independent audit (merged.json `rows`, 15.11) must say verdict DONE;
 *   - `pr` is the task's own `pr` (from its status), `sha` that PR's head commit
 *     (pr-shas.tsv: number, merged, merge sha, head sha, base — `gh api …/pulls/N`);
 *   - every `dod` command is run: `npx vitest run a b …` runs each file through the
 *     runner and sums its last "pass N fail M" line; any other command counts as one
 *     check that passes on exit 0. A file that is not green is run once more, alone,
 *     before it counts as failed (the machine is shared and timing-sensitive).
 * A task with all three gets `evidence: { verdict, pr, sha, checks: [{cmd, pass, total, ranOn}], audit, at }`.
 * Any other ✅ task goes back to ⏳ with the note "ביקורת 15.11: אין ראיה", and its
 * `verified` level is recomputed from the new status (scripts/plan/migrate-verified.mjs).
 *
 * Without --write it prints what it would do and writes nothing. The result of every
 * run is printed as JSON on stdout (ids kept, ids dropped and why).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ROOT, PLAN_FILE, withVerified } from "./build.mjs";
import { classify, prOf } from "./migrate-verified.mjs";

export const DROP_NOTE = "ביקורת 15.11: אין ראיה";
export const AUDIT_DATE = "2026-11-15";
const SHA = /^[0-9a-f]{40}$/;

/** `npx vitest run a b` → ["a", "b"]; anything else → null. */
export function vitestFiles(cmd) {
  const m = /^npx vitest run((?:\s+[^\s-][^\s]*)+)\s*$/.exec(cmd.trim());
  return m ? m[1].trim().split(/\s+/) : null;
}

/** The last "pass N fail M" in a runner's output. */
export function passFail(out) {
  const all = [...String(out).matchAll(/pass (\d+) fail (\d+)/g)];
  if (!all.length) return null;
  const [, p, f] = all[all.length - 1];
  return { pass: Number(p), fail: Number(f) };
}

/** The ⏳ status a ✅ task drops to: the note first, then what the status said. */
export function droppedStatus(status) {
  const rest = status.replace(/^✅\*?\s*/, "").trim();
  return rest ? `⏳ ${DROP_NOTE} (היה ✅: ${rest})` : `⏳ ${DROP_NOTE}`;
}

/** Adds `evidence` (or replaces it) at the end of the task, keeping every other key in place. */
export function withEvidence(task, evidence) {
  const { evidence: _old, ...rest } = task;
  return { ...rest, evidence };
}

/**
 * @param plan    plan.json
 * @param audit   { id → verdict }
 * @param headOf  { pr → 40-hex head sha }
 * @param check   (cmd) → [{ cmd, pass, total }]
 */
export function migrateEvidence(plan, { audit, headOf, check }) {
  const kept = [];
  const dropped = [];
  const phases = plan.phases.map((ph) => ({
    ...ph,
    tasks: ph.tasks.map((t) => {
      if (!(t.status ?? "").startsWith("✅")) return t;
      const why = [];
      const verdict = audit[t.id];
      if (verdict !== "DONE") why.push(`audit verdict ${verdict ?? "none"}`);
      const pr = t.pr ?? prOf(t.status);
      const sha = headOf[pr];
      if (!pr) why.push("no PR in the status");
      else if (!SHA.test(sha ?? "")) why.push(`no head sha for #${pr}`);
      const checks = (t.dod ?? []).flatMap(check);
      if (!checks.length) why.push("no dod");
      for (const c of checks) if (!(c.total > 0 && c.pass === c.total)) why.push(`not green: ${c.cmd} (${c.pass}/${c.total})`);
      if (why.length) {
        dropped.push({ id: t.id, why });
        const status = droppedStatus(t.status);
        const { evidence: _e, ...rest } = t;
        return withVerified({ ...rest, status }, classify(status), t.pr ?? prOf(status));
      }
      kept.push(t.id);
      return withEvidence(t, { verdict, pr, sha: sha.slice(0, 10), checks, audit: "ביקורת עצמאית 15.11 (merged.json)", at: AUDIT_DATE });
    }),
  }));
  return { plan: { ...plan, phases }, kept, dropped };
}

/** The plan tooling's own checks: they run on this branch, against this plan. */
export const PLAN_TOOLING_TESTS = Object.freeze(["src/__tests__/planBuild.test.ts", "src/__tests__/dod.test.ts", "src/__tests__/migrateEvidence.test.ts"]);

/** Where a dod command runs: here when it is all plan tooling, else the code tree (the newest train). */
export function whereToRun(cmd, { planRoot, codeRoot }) {
  const files = vitestFiles(cmd);
  if (files) return files.every((f) => PLAN_TOOLING_TESTS.includes(f)) ? planRoot : codeRoot;
  return /^npm run plan(:check)?$/.test(cmd.trim()) ? planRoot : codeRoot;
}

/**
 * Runs dod commands for real: vitest files through `runner` ({root} and {file} are
 * replaced), anything else in a shell. `label(root)` is what `ranOn` records.
 */
export function makeCheck({ planRoot, codeRoot, runner, label, log = (s) => process.stderr.write(s + "\n") }) {
  const cache = new Map();
  const runFile = (root, file) => {
    const go = () => {
      const r = spawnSync(runner.replaceAll("{root}", root).replaceAll("{file}", file), { cwd: root, shell: true, encoding: "utf8", maxBuffer: 1 << 28 });
      return passFail((r.stdout ?? "") + (r.stderr ?? "")) ?? { pass: 0, fail: 0 };
    };
    let res = go();
    if (!(res.fail === 0 && res.pass > 0)) {
      log(`  ${file}: ${res.pass}/${res.pass + res.fail}, running it again alone`);
      res = go();
    }
    log(`  ${file}: ${res.pass}/${res.pass + res.fail}`);
    return res;
  };
  return (cmd) => {
    if (cache.has(cmd)) return cache.get(cmd);
    const root = whereToRun(cmd, { planRoot, codeRoot });
    log(`check › ${cmd}   [${label(root)}]`);
    const files = vitestFiles(cmd);
    let out;
    if (files) {
      const sum = files.map((f) => runFile(root, f)).reduce((a, b) => ({ pass: a.pass + b.pass, fail: a.fail + b.fail }), { pass: 0, fail: 0 });
      out = [{ cmd, pass: sum.pass, total: sum.pass + sum.fail, ranOn: label(root) }];
    } else {
      const r = spawnSync(cmd, { cwd: root, shell: true, encoding: "utf8" });
      out = [{ cmd, pass: r.status === 0 ? 1 : 0, total: 1, ranOn: label(root) }];
      log(`  exit ${r.status}`);
    }
    cache.set(cmd, out);
    return out;
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const auditFile = arg("--audit");
  const shasFile = arg("--shas");
  const runner = arg("--runner");
  const tree = arg("--tree");
  if (!auditFile || !shasFile || !runner || !tree) {
    console.error("usage: migrate-evidence.mjs --audit <merged.json> --shas <pr-shas.tsv> --tree <code checkout> --runner '<cmd {root} {file}>' [--write]");
    process.exit(2);
  }
  const audit = Object.fromEntries(JSON.parse(readFileSync(auditFile, "utf8")).rows.map((r) => [r.id, r.verdict]));
  const headOf = Object.fromEntries(
    readFileSync(shasFile, "utf8")
      .trim()
      .split("\n")
      .map((l) => l.split("\t"))
      .map(([n, , , head]) => [Number(n), head]),
  );
  const path = join(ROOT, PLAN_FILE);
  const plan = JSON.parse(readFileSync(path, "utf8"));
  const label = (root) => {
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
    const ref = spawnSync("git", ["log", "-1", "--format=%D", "HEAD"], { cwd: root, encoding: "utf8" }).stdout;
    const name = /origin\/([\w./-]+)/.exec(ref)?.[1] ?? (root === ROOT ? "chore/plan-fixes-d" : "?");
    return `${name} ${head.slice(0, 10)}`;
  };
  const res = migrateEvidence(plan, { audit, headOf, check: makeCheck({ planRoot: ROOT, codeRoot: resolve(tree), runner, label }) });
  if (process.argv.includes("--write")) writeFileSync(path, JSON.stringify(res.plan, null, 1) + "\n");
  console.log(JSON.stringify({ kept: res.kept, dropped: res.dropped }, null, 1));
}
