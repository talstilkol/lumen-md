#!/usr/bin/env node
/**
 * Plan 0.7 — the definition-of-done checker.
 *
 * A task's `dod` in plan/plan.json is the list of commands that prove its
 * acceptance criteria. This script runs them; the plan build (plan:check)
 * refuses a task marked ✅ that has none, so ✅ always means "a command
 * that anyone can run went green".
 *
 *   node scripts/dod.mjs 0.6 4.12      run the DoD of these tasks
 *   node scripts/dod.mjs --done        every ✅ / ✅* task that has a DoD (CI)
 *   node scripts/dod.mjs --list        which tasks have a DoD, and the rule's problems
 *   node scripts/dod.mjs 0.6 --dry     print the commands, run nothing
 *   node scripts/dod.mjs 0.6 --markdown  the PR checklist for these tasks
 *   node scripts/dod.mjs --p0 --runner <shim> --report reports/dod-p0-<sha>.md [--jobs N]
 *       every P0 task's dod (W10.Z3, 13.5; not those two, whose dod is this run),
 *       `npx vitest run` one file at a time through the runner, and the table
 *       written to the report (scripts/lib/dodRunner.mjs). Exit 1 when any is red.
 *   node scripts/dod.mjs --done --runner <shim> [--report <file>]
 *       the same for every ✅ / ✅* task (plan 0.7: a ✅ whose dod is red shows here)
 *
 * ✅* (green against mocks only — no GPU / Ollama here) is set with
 * `"dodMock": true`: such a task can never be plain ✅ until the real-model
 * check named in its owner item replaces the mock.
 */
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PLAN_FILE = "plan/plan.json";

/** @param {{ phases: { tasks: any[] }[] }} plan */
export const allTasks = (plan) => plan.phases.flatMap((p) => p.tasks);

/** ✅ but not ✅* */
export const isFullDone = (status = "") => status.startsWith("✅") && !status.startsWith("✅*");
export const isMockDone = (status = "") => status.startsWith("✅*");

/**
 * The rule plan:check enforces. Returns a list of problems (empty = fine).
 * - every ✅ / ✅* task has a non-empty `dod`. No task is exempt: the 60 tasks
 *   that were ✅ before 0.7 got their commands or went back to ⏳ (W10.G1–G4),
 *   and the grandfather list and its frozen baseline are gone (W10.G5), so a
 *   `dodGrandfathered` list in the plan is refused rather than read
 * - a task with `dodMock: true` is ✅*, never plain ✅
 * - a ✅* task declares `dodMock: true`; without it a later edit could turn ✅* into
 *   plain ✅ and re-run the same mock-only commands as the real check (Codex P1 on #265)
 * - every `dod` entry is a non-empty string
 * - every P0 task, done or not, has a `dod` and a `dodExpect` with one
 *   expected result per command (expectProblems, below)
 * @param {any} plan
 * @returns {string[]}
 */
export function checkDod(plan) {
  const problems = [];
  const tasks = allTasks(plan);
  for (const key of ["dodGrandfathered", "dodRevoked"]) {
    if (plan[key] !== undefined) problems.push(`${key}: no task is exempt from the dod rule any more (W10.G5) — remove the list; a ✅ task needs its dod, or goes back to ⏳`);
  }
  for (const t of tasks) {
    const status = t.status ?? "";
    if (t.dod !== undefined && (!Array.isArray(t.dod) || t.dod.some((c) => typeof c !== "string" || !c.trim()))) {
      problems.push(`${t.id}: dod must be a list of commands`);
    }
    problems.push(...expectProblems(t));
    if (!status.startsWith("✅")) continue;
    if (!t.dod?.length) problems.push(`${t.id} is marked ${status.slice(0, 2).trim()} without a dod — add the commands that prove it (plan 0.7)`);
    if (t.dodMock && isFullDone(status)) problems.push(`${t.id} is checked against mocks only (dodMock) — mark it ✅*, not ✅`);
    if (isMockDone(status) && !t.dodMock) problems.push(`${t.id} is ✅* without "dodMock": true — declare it, so the status can't become ✅ before the real-model check replaces the mock`);
  }
  return problems;
}

/**
 * W10.Z3 / lane A6 — a P0 task's definition of done is concrete whatever its
 * status: at least one command, and for each command the result that proves
 * it (`dodExpect`, the same length as `dod`: "exit 0 — 0 failed", "prints
 * enabled", …). Any task that has a `dodExpect` keeps it in step with `dod`.
 * @param {any} t
 * @returns {string[]}
 */
export function expectProblems(t) {
  const out = [];
  const cmds = Array.isArray(t.dod) ? t.dod : [];
  if (t.priority === "P0" && !cmds.length) out.push(`${t.id} is P0 without a dod — add the commands that prove it and their expected results (dodExpect)`);
  if (t.dodExpect === undefined) {
    if (t.priority === "P0" && cmds.length) out.push(`${t.id} is P0 without dodExpect — the expected result of each dod command`);
    return out;
  }
  if (!Array.isArray(t.dodExpect) || t.dodExpect.some((e) => typeof e !== "string" || !e.trim())) out.push(`${t.id}: dodExpect must be a list of expected results`);
  else if (t.dodExpect.length !== cmds.length) out.push(`${t.id}: dodExpect has ${t.dodExpect.length} entries for ${cmds.length} dod command(s) — one expected result per command`);
  return out;
}

/**
 * @param {any} plan
 * @param {{ ids?: string[], done?: boolean }} sel
 */
export function select(plan, { ids = [], done = false }) {
  const tasks = allTasks(plan);
  if (done) return tasks.filter((t) => (t.status ?? "").startsWith("✅") && t.dod?.length);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return ids.map((id) => {
    const t = byId.get(id);
    if (!t) throw new Error(`dod: no task ${id}`);
    return t;
  });
}

/** The PR checklist (task template, plan 0.7.3). */
export function markdown(tasks) {
  const lines = [];
  for (const t of tasks) {
    lines.push(`### ${t.id} · ${t.title}`);
    for (const a of t.acceptance ?? []) lines.push(`- [ ] ${a}`);
    if (t.dod?.length) t.dod.forEach((c, i) => lines.push(`- [ ] \`${c}\` ${t.dodExpect?.[i] ? `→ ${t.dodExpect[i]}` : "green"}`));
    else lines.push("- [ ] **no `dod` yet** — add the commands to plan/plan.json");
    if (t.dodMock) lines.push("- [ ] mocks only → ✅*; the real-model check stays with the owner item");
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Runs each task's commands in order; a task stops at its first failure.
 * @returns {{ id: string, ok: boolean, failed?: string, ms: number }[]}
 */
export function runDod(tasks, { root = ROOT, exec = defaultExec, log = console.log } = {}) {
  const results = [];
  for (const t of tasks) {
    const t0 = Date.now();
    let failed;
    for (const cmd of t.dod ?? []) {
      log(`dod ${t.id} › ${cmd}`);
      if (!exec(cmd, root)) {
        failed = cmd;
        break;
      }
    }
    results.push({ id: t.id, ok: !failed && !!t.dod?.length, failed, ms: Date.now() - t0 });
  }
  return results;
}

function defaultExec(cmd, cwd) {
  const r = spawnSync(cmd, { cwd, shell: true, stdio: "inherit" });
  return r.status === 0;
}

/** The P0 tasks whose dod the release review runs: all but 13.5 and W10.Z3, whose dod is that run. */
export const p0Tasks = (plan) => allTasks(plan).filter((t) => t.priority === "P0" && !["13.5", "W10.Z3"].includes(t.id));

async function report(plan, argv) {
  const { runTasks, reportMarkdown } = await import("./lib/dodRunner.mjs");
  const val = (name) => (argv.indexOf(name) >= 0 ? argv[argv.indexOf(name) + 1] : null);
  const runner = val("--runner");
  const file = val("--report");
  const jobs = Number(val("--jobs") ?? 1);
  const ids = argv.filter((a, i) => !a.startsWith("--") && !["--runner", "--report", "--jobs"].includes(argv[i - 1]));
  const tasks = argv.includes("--p0") ? p0Tasks(plan) : select(plan, { ids, done: argv.includes("--done") });
  const git = (...a) => spawnSync("git", a, { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const rows = await runTasks(tasks, { root: ROOT, runner, jobs, log: (l) => console.log(l) });
  const md = reportMarkdown(rows, { sha: git("rev-parse", "HEAD"), branch: git("rev-parse", "--abbrev-ref", "HEAD"), runner, at: new Date().toISOString(), mode: argv.includes("--p0") ? "--p0" : argv.includes("--done") ? "--done" : ids.join(" ") });
  if (file) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(dirname(resolve(ROOT, file)), { recursive: true });
    writeFileSync(resolve(ROOT, file), md);
    console.log(`dod: table written to ${file}`);
  } else console.log(md);
  const red = rows.filter((r) => r.verdict === "red").length;
  console.log(`dod: ${rows.length} tasks — ${rows.filter((r) => r.verdict === "green").length} green, ${red} red, ${rows.filter((r) => r.verdict === "not here").length} not here`);
  return red ? 1 : 0;
}

async function main(argv) {
  const plan = JSON.parse(readFileSync(join(ROOT, PLAN_FILE), "utf8"));
  if (argv.includes("--p0") || argv.includes("--report") || argv.includes("--runner")) return report(plan, argv);
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const ids = argv.filter((a) => !a.startsWith("--"));
  if (flags.has("--list")) {
    const tasks = allTasks(plan);
    const withDod = tasks.filter((t) => t.dod?.length);
    console.log(`${withDod.length} tasks with a dod: ${withDod.map((t) => t.id).join(", ") || "—"}`);
    const problems = checkDod(plan);
    for (const p of problems) console.error(`  ✗ ${p}`);
    return problems.length ? 1 : 0;
  }
  const tasks = select(plan, { ids, done: flags.has("--done") });
  if (!tasks.length) {
    console.error(flags.has("--done") ? "dod: no done task has a dod yet" : "usage: node scripts/dod.mjs <task id…> | --done | --list [--dry | --markdown]");
    return flags.has("--done") ? 0 : 2;
  }
  if (flags.has("--markdown")) {
    console.log(markdown(tasks));
    return 0;
  }
  if (flags.has("--dry")) {
    for (const t of tasks) for (const c of t.dod ?? ["(no dod)"]) console.log(`${t.id}\t${c}`);
    return 0;
  }
  const results = runDod(tasks);
  console.log("");
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.id.padEnd(6)} ${(r.ms / 1000).toFixed(1).padStart(6)} s${r.failed ? `  failed: ${r.failed}` : r.ok ? "" : "  no dod"}`);
  const bad = results.filter((r) => !r.ok);
  console.log(bad.length ? `dod: ${bad.length} of ${results.length} not green` : `dod: ${results.length} green`);
  return bad.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exit(1);
  }
}
