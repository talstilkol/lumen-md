#!/usr/bin/env node
/**
 * W10.B12 — honest statuses against the audit itself. claimGuard.mjs checks
 * the evidence a task carries; nothing stopped a hand edit from writing
 * `verdict: "DONE"` on a task the independent audit called PARTIAL. This
 * guard reads the audit's verdicts from a ledger in the repo
 * (plan/audit-verdicts.json) and plan:check fails on:
 *
 * - a ✅ task the latest audit that judged it did not call DONE
 *   (PARTIAL / NOT DONE / FAKED), or that no audit has judged at all;
 * - a ✅ task whose evidence verdict differs from the audit's verdict;
 * - a ✅ task whose evidence does not cite the audit (`evidence.audit`):
 *   every status change names the audit line it rests on;
 * - a ledger that is malformed, or missing while the plan has a ✅ task
 *   (deleting the file must not switch the rule off).
 *
 * Later audits come after earlier ones in `audits`; for each task the last
 * audit that has a verdict for it decides. A new audit is appended with
 *
 *   node scripts/plan/auditGuard.mjs --import <audit.json> --name "r3 20.11" --at 2026-11-20
 *
 * where <audit.json> is a list of { id, verdict } rows (the r2 audit's
 * merged file). `node scripts/plan/auditGuard.mjs --check` prints the
 * problems and exits 1 on any.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const AUDIT_FILE = "plan/audit-verdicts.json";
export const VERDICTS = ["DONE", "PARTIAL", "NOT DONE", "FAKED"];

const tasksOf = (plan) => plan.phases.flatMap((p) => p.tasks);
const isDone = (s = "") => s.startsWith("✅");

/** What is wrong with the ledger itself ([] = well formed). */
export function ledgerProblems(ledger) {
  if (!ledger || typeof ledger !== "object" || !Array.isArray(ledger.audits) || !ledger.audits.length) return [`${AUDIT_FILE}: needs a non-empty "audits" list`];
  const out = [];
  ledger.audits.forEach((a, i) => {
    const where = `${AUDIT_FILE}: audits[${i}]`;
    if (!a || typeof a.name !== "string" || !a.name.trim()) out.push(`${where} has no name`);
    if (!a || typeof a.at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(a.at)) out.push(`${where} has no date (YYYY-MM-DD)`);
    if (!a || !a.verdicts || typeof a.verdicts !== "object" || Array.isArray(a.verdicts)) {
      out.push(`${where} has no verdicts`);
      return;
    }
    for (const [id, v] of Object.entries(a.verdicts)) if (!VERDICTS.includes(v)) out.push(`${where}: ${id} has verdict ${JSON.stringify(v)}, not one of ${VERDICTS.join(", ")}`);
  });
  for (let i = 1; i < ledger.audits.length; i++) if (ledger.audits[i].at < ledger.audits[i - 1].at) out.push(`${AUDIT_FILE}: audits must be in date order (${ledger.audits[i].name} is before ${ledger.audits[i - 1].name})`);
  return out;
}

/** The deciding verdict for each task id: { id: { verdict, audit } }, the last audit that judged it. */
export function latestVerdicts(ledger) {
  const out = new Map();
  for (const a of ledger.audits) for (const [id, verdict] of Object.entries(a.verdicts)) out.set(id, { verdict, audit: a.name });
  return out;
}

/**
 * The problems plan:check fails on. `ledger` is the parsed audit-verdicts file,
 * or null when it is missing.
 */
export function auditGuard(plan, ledger) {
  const done = tasksOf(plan).filter((t) => isDone(t.status));
  if (ledger == null) return done.length ? [`${AUDIT_FILE} is missing, and ${done.length} task(s) are ✅ — a ✅ needs the audit's DONE (W10.B12)`] : [];
  const bad = ledgerProblems(ledger);
  if (bad.length) return bad;
  const latest = latestVerdicts(ledger);
  const out = [];
  for (const t of done) {
    const a = latest.get(t.id);
    if (!a) {
      out.push(`${t.id}: ✅ but no audit in ${AUDIT_FILE} has a verdict for it — back to ⏳ until one calls it DONE`);
      continue;
    }
    if (a.verdict !== "DONE") out.push(`${t.id}: ✅ but the audit "${a.audit}" called it ${a.verdict} — back to ⏳`);
    const ev = t.evidence?.verdict;
    if (ev !== undefined && ev !== a.verdict) out.push(`${t.id}: its evidence says ${JSON.stringify(ev)}, the audit "${a.audit}" says ${JSON.stringify(a.verdict)}`);
    if (typeof t.evidence?.audit !== "string" || !t.evidence.audit.trim()) out.push(`${t.id}: ✅ evidence does not cite the audit line it rests on (evidence.audit)`);
  }
  return out;
}

/** Read the ledger under `root`; null when it does not exist. Throws on bad JSON. */
export function readLedger(root = ROOT) {
  const p = join(root, AUDIT_FILE);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

/** Append one audit (rows of { id, verdict }) to a ledger; returns the new ledger. */
export function appendAudit(ledger, rows, { name, at }) {
  const verdicts = {};
  for (const r of rows) {
    if (!r || typeof r.id !== "string") continue;
    if (!VERDICTS.includes(r.verdict)) throw new Error(`${r.id}: verdict ${JSON.stringify(r.verdict)} is not one of ${VERDICTS.join(", ")}`);
    if (verdicts[r.id] && verdicts[r.id] !== r.verdict) throw new Error(`${r.id}: two different verdicts in one audit`);
    verdicts[r.id] = r.verdict;
  }
  const next = { ...(ledger ?? {}), audits: [...(ledger?.audits ?? []), { name, at, verdicts }] };
  const bad = ledgerProblems(next);
  if (bad.length) throw new Error(bad.join("\n"));
  return next;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  if (args.includes("--import")) {
    const rows = JSON.parse(readFileSync(opt("--import"), "utf8"));
    const next = appendAudit(readLedger(), rows, { name: opt("--name"), at: opt("--at") });
    next.about ??= "Verdicts of the independent audits, by task id. plan:check refuses a ✅ the latest audit did not call DONE (W10.B12, scripts/plan/auditGuard.mjs). Append a new audit with --import; never edit a verdict by hand.";
    writeFileSync(join(ROOT, AUDIT_FILE), JSON.stringify(next, null, 1) + "\n");
    console.log(`${AUDIT_FILE}: ${next.audits.length} audit(s), the new one with ${Object.keys(next.audits.at(-1).verdicts).length} verdicts`);
  } else {
    const plan = JSON.parse(readFileSync(join(ROOT, "plan/plan.json"), "utf8"));
    const problems = auditGuard(plan, readLedger());
    for (const p of problems) console.error(`audit-guard: ${p}`);
    if (!problems.length) console.log("audit-guard: every ✅ task is DONE in its latest audit");
    process.exit(problems.length ? 1 : 0);
  }
}
