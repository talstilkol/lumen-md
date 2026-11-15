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
 *   green, a sha that is not one. No task is exempt: there is no
 *   grandfather list (W10.G5 removed them all), and a plan or task key that
 *   would exempt one is refused rather than read. The tasks that were ✅
 *   before this rule got evidence from the 15.11 audit or went back to ⏳
 *   (scripts/plan/migrate-evidence.mjs, on chore/plan-fixes-d).
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

/** Plan keys that would exempt tasks from the rule; refused (W10.G5: no exemption lists). */
const EXEMPTION_KEY = /grandfather|exempt/i;

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

export function claimGuard(plan) {
  const out = [];
  for (const k of Object.keys(plan)) if (EXEMPTION_KEY.test(k)) out.push(`${k}: no task is exempt from the evidence rule (W10.G5) — remove the list; a ✅ task needs its evidence, or goes back to ⏳`);
  for (const t of tasksOf(plan)) {
    for (const k of Object.keys(t)) if (EXEMPTION_KEY.test(k)) out.push(`${t.id}: "${k}" — no task is exempt from the evidence rule (W10.G5)`);
    if (!isDone(t.status)) continue;
    for (const p of evidenceProblems(t)) out.push(`${t.id} is ✅ with ${p}`);
  }
  return out;
}

/** Each ✅ task with its evidence level (2 = complete, 1 = partial, 0 = none) and why, weakest first. */
export function overclaims(plan) {
  return tasksOf(plan)
    .filter((t) => isDone(t.status))
    .map((t) => {
      const problems = evidenceProblems(t);
      const level = problems.length === 0 ? 2 : t.evidence ? 1 : 0;
      return { id: t.id, title: t.title, level, problems, suggest: level === 2 ? t.status : "⏳" };
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
export function overclaimReport(plan) {
  const rows = overclaims(plan);
  const down = rows.filter((r) => r.level < 2);
  const out = ["# דוח טענות-יתר: משימות ✅ לפי הראיה בלבד", "", `${rows.length} משימות ✅; ל-${down.length} אין ראיה מלאה, ומוצע להחזיר אותן ל-⏳.`, ""];
  if (down.length) {
    out.push("| משימה | ראיה | למה | הצעה |", "| --- | --- | --- | --- |");
    for (const r of down) out.push(`| ${r.id} | ${r.level === 0 ? "אין" : "חלקית"} | ${r.problems.map(he).join("; ")} | ${r.suggest} |`);
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
