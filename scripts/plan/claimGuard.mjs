#!/usr/bin/env node
/**
 * Honest status (plan R12.14): a task is ✅ only with evidence that a check
 * went green, recorded on the task itself — never inferred from git
 * history, so a shallow clone cannot turn a done task into "no evidence".
 *
 *   evidence: { verdict: "DONE", pr: 838, sha: "784ef2e1dd",
 *               checks: [{ cmd: "v4.sh … entityEval.test.ts", pass: 10, total: 10 }] }
 *
 * - `claimGuard(plan)`: the problems plan:check fails on — a ✅ task
 *   without evidence, a verdict other than DONE, a check that was not all
 *   green, a sha that is not one. The tasks ✅ before this rule existed are
 *   frozen in RECEIPT_GRANDFATHER (the list only shrinks, as in dod.mjs).
 * - `overclaimReport(plan)`: every ✅ task ranked by its evidence, and the
 *   ones that should go back to ⏳, with the reason, in Hebrew.
 * - `verifyShas(plan, git)`: a recorded sha missing from this clone is
 *   "not checkable here" when the clone is shallow, never a failure.
 *
 *   node scripts/plan/claimGuard.mjs            # the overclaim report (Hebrew Markdown)
 *   node scripts/plan/claimGuard.mjs --check    # exit 1 on any problem
 *
 * Clean reimplementation (design reference only: israelconnect's claim
 * guard and overclaim audit, AGPL; no code taken).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** ✅ before R12.14 (verify/train-5 and chore/dod, 15.11.2026). Only ever loses ids. */
export const RECEIPT_GRANDFATHER = Object.freeze(["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.8", "0.9", "0.10", "0.11", "0.12", "0.13", "0.14", "0.17", "0.18", "0.20", "0.21", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "2.1", "2.2", "2.3", "2.4", "2.5", "2.7", "2.8", "3.1", "3.2", "3.6", "4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "4.12", "5.1", "5.2", "5.3", "5.11", "6.0", "6.1", "7.1", "7.10", "8.5", "9.1", "9.2", "9.3", "9.7", "9.8", "14.1", "W1.35", "W6.4"]);

const tasksOf = (plan) => plan.phases.flatMap((p) => p.tasks);
const isDone = (s = "") => s.startsWith("✅");
const SHA = /^[0-9a-f]{7,40}$/;

/** What is wrong with a task's evidence ([] = enough for ✅). */
export function evidenceProblems(task) {
  const e = task.evidence;
  if (!e || typeof e !== "object") return ["no evidence"];
  const out = [];
  if (e.verdict !== "DONE") out.push(`verdict is ${JSON.stringify(e.verdict ?? null)}, not "DONE"`);
  if (typeof e.sha !== "string" || !SHA.test(e.sha)) out.push("no commit sha");
  if (!Array.isArray(e.checks) || !e.checks.length) out.push("no check recorded");
  else
    for (const c of e.checks) {
      if (!c || typeof c.cmd !== "string" || !c.cmd.trim()) out.push("a check without its command");
      else if (!(Number.isInteger(c.total) && c.total > 0 && c.pass === c.total)) out.push(`not all green: ${c.cmd} (${c.pass ?? "?"}/${c.total ?? "?"})`);
    }
  return out;
}

export function claimGuard(plan, grandfather = RECEIPT_GRANDFATHER) {
  const old = new Set(grandfather);
  const out = [];
  for (const t of tasksOf(plan)) {
    if (!isDone(t.status) || old.has(t.id)) continue;
    for (const p of evidenceProblems(t)) out.push(`${t.id} is ✅ with ${p}`);
  }
  return out;
}

/** Each ✅ task with its evidence level (2 = complete, 1 = partial, 0 = none) and why, weakest first. */
export function overclaims(plan, grandfather = RECEIPT_GRANDFATHER) {
  const old = new Set(grandfather);
  return tasksOf(plan)
    .filter((t) => isDone(t.status))
    .map((t) => {
      const problems = evidenceProblems(t);
      const level = problems.length === 0 ? 2 : t.evidence ? 1 : 0;
      return { id: t.id, title: t.title, level, problems, grandfathered: old.has(t.id), suggest: level === 2 ? t.status : "⏳" };
    })
    .sort((a, b) => a.level - b.level || (a.id < b.id ? -1 : 1));
}

const HE_PROBLEM = [
  [/^no evidence$/, () => "אין ראיה רשומה"],
  [/^verdict is (.*), not "DONE"$/, (m) => `הביקורת אמרה ${m[1]}, לא DONE`],
  [/^no commit sha$/, () => "אין sha של קומיט"],
  [/^no check recorded$/, () => "לא נרשמה אף בדיקה"],
  [/^a check without its command$/, () => "בדיקה בלי הפקודה שלה"],
  [/^not all green: (.*)$/, (m) => `לא הכול ירוק: ${m[1]}`],
];
const he = (p) => {
  for (const [re, f] of HE_PROBLEM) {
    const m = re.exec(p);
    if (m) return f(m);
  }
  return p;
};

/** The overclaim report, in Hebrew Markdown. */
export function overclaimReport(plan, grandfather = RECEIPT_GRANDFATHER) {
  const rows = overclaims(plan, grandfather);
  const down = rows.filter((r) => r.level < 2);
  const out = ["# דוח טענות-יתר: משימות ✅ לפי הראיה בלבד", "", `${rows.length} משימות ✅; ל-${down.length} אין ראיה מלאה, ומוצע להחזיר אותן ל-⏳.`, ""];
  if (down.length) {
    out.push("| משימה | ראיה | למה | הצעה |", "| --- | --- | --- | --- |");
    for (const r of down) out.push(`| ${r.id}${r.grandfathered ? " (לפני הכלל)" : ""} | ${r.level === 0 ? "אין" : "חלקית"} | ${r.problems.map(he).join("; ")} | ${r.suggest} |`);
  } else out.push("לכל משימה ✅ יש ראיה מלאה.");
  return out.join("\n") + "\n";
}

/**
 * Check recorded shas against this clone. `git(args)` runs git and returns stdout (throws on failure).
 * Returns { missing, unverifiable }: a sha absent from a full clone is missing; from a shallow one, only unverifiable.
 */
export function verifyShas(plan, git) {
  let shallow = false;
  try {
    shallow = git(["rev-parse", "--is-shallow-repository"]).trim() === "true";
  } catch {
    shallow = true;
  }
  const missing = [];
  const unverifiable = [];
  for (const t of tasksOf(plan)) {
    const sha = t.evidence?.sha;
    if (!isDone(t.status) || typeof sha !== "string" || !SHA.test(sha)) continue;
    try {
      git(["cat-file", "-e", `${sha}^{commit}`]);
    } catch {
      (shallow ? unverifiable : missing).push(t.id);
    }
  }
  return { missing, unverifiable, shallow };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = JSON.parse(readFileSync(join(ROOT, "plan/plan.json"), "utf8"));
  if (process.argv.includes("--check")) {
    const problems = claimGuard(plan);
    for (const p of problems) console.error(`claim-guard: ${p}`);
    const { missing, unverifiable } = verifyShas(plan, (a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    for (const id of missing) console.error(`claim-guard: ${id}: its evidence sha is not in this repository`);
    if (unverifiable.length) console.error(`claim-guard: shallow clone, ${unverifiable.length} sha(s) not checkable here (not a failure)`);
    process.exit(problems.length || missing.length ? 1 : 0);
  }
  process.stdout.write(overclaimReport(plan));
}
