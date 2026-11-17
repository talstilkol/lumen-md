#!/usr/bin/env node
/**
 * Flaky or real? Rerun alone, classify, and quarantine with an expiry (R12.12; feeds W10.M12).
 *
 * Every local run can append its failures and passes to a history
 * (`.ci-doctor/history.jsonl`, not committed): `{ at, commit, file, test,
 * key, ok, alone }`. From that history one test is:
 *
 *   real        it failed every time at this commit, alone too (≥ 2 alone reruns)
 *   flaky       it both passed and failed at the same commit
 *   isolation   it fails in the full run but passes every time alone
 *               (another test leaks state into it)
 *   unknown     not enough runs to say; rerun it alone first
 *
 * `rerun <file>` runs one test file alone N times through the runner the
 * machine has (`CI_DOCTOR_RUNNER`, default `npx vitest run {file}`; offline:
 * the shim v4 command) and records each run.
 *
 * **Quarantine** (`scripts/ci-doctor/quarantine.json`, committed): a test
 * goes in only when the history shows it flaky (a pass and a fail at the
 * same commit), with a reason and an expiry at most 14 days out. A quarantined
 * failure is reported as quarantined, not hidden; an expired entry is an
 * error (`check` exits 1) until it is fixed or renewed with new evidence.
 * Nothing here changes what an existing gate counts: no gate reads the
 * quarantine yet (W10.M12 decides that).
 *
 * Clean reimplementation; design reference only: israelconnect's
 * tools/control/flake_classifier.py (AGPL), no code copied.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signatures } from "./failSig.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const QUARANTINE_FILE = join(HERE, "quarantine.json");
export const HISTORY_FILE = resolve(process.env.CI_DOCTOR_DIR || ".ci-doctor", "history.jsonl");
/** The longest a quarantine may run before it has to be renewed with new evidence. */
export const MAX_QUARANTINE_DAYS = 14;
const DAY = 864e5;

/** Classify one test from its history rows. */
export function classify(rows, { commit } = {}) {
  const at = commit ? rows.filter((r) => r.commit === commit) : rows;
  if (!at.length) return { verdict: "unknown", why: "no runs" };
  const byCommit = new Map();
  for (const r of at) (byCommit.get(r.commit) ?? byCommit.set(r.commit, []).get(r.commit)).push(r);
  for (const [c, rs] of byCommit) {
    if (rs.some((r) => r.ok) && rs.some((r) => !r.ok)) return { verdict: "flaky", why: `passed ${rs.filter((r) => r.ok).length} and failed ${rs.filter((r) => !r.ok).length} times at ${c.slice(0, 10)}`, commit: c };
  }
  const alone = at.filter((r) => r.alone);
  const full = at.filter((r) => !r.alone);
  if (alone.length >= 2 && alone.every((r) => !r.ok)) return { verdict: "real", why: `failed ${alone.length}/${alone.length} times alone` };
  if (alone.length >= 2 && alone.every((r) => r.ok) && full.some((r) => !r.ok)) return { verdict: "isolation", why: `fails in the full run, passes ${alone.length}/${alone.length} alone` };
  return { verdict: "unknown", why: `${at.length} run(s), ${alone.length} alone: rerun it alone (≥ 2)` };
}

export function readHistory(file = HISTORY_FILE) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function appendHistory(rows, file = HISTORY_FILE) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
}

/** History rows for one run's log: one row per failure, and an `ok` row for the file when nothing failed. */
export function rowsFromLog(log, { file, commit, alone, at = new Date().toISOString(), code }) {
  const sigs = signatures(log);
  if (!sigs.length) return [{ at, commit, file, test: "(file)", key: null, ok: code === 0, alone }];
  return sigs.map((s) => ({ at, commit, file, test: s.test, key: s.key, ok: false, alone }));
}

/**
 * Rerun a test file alone `times` times. `exec` runs the command and returns
 * `{ code, text }` (injected in tests; spawnSync otherwise).
 */
export function rerunAlone(file, { times = 3, commit, runner = process.env.CI_DOCTOR_RUNNER || "npx vitest run {file}", exec = defaultExec } = {}) {
  const rows = [];
  for (let i = 0; i < times; i++) {
    const { code, text } = exec(runner.replaceAll("{file}", file));
    const run = rowsFromLog(text, { file, commit, alone: true, code });
    // A run that failed with no parsed failure is still a failure of the file.
    if (code !== 0 && run.every((r) => r.ok)) run[0].ok = false;
    rows.push(...run);
  }
  return rows;
}

function defaultExec(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", maxBuffer: 64 << 20 });
  return { code: r.status ?? 1, text: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/* ─── Quarantine ─────────────────────────────────────────────────────── */

export function loadQuarantine(file = QUARANTINE_FILE) {
  if (!existsSync(file)) return { schema: 1, entries: [] };
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Problems with one entry: a quarantine needs evidence, a reason and an expiry within 14 days. */
export function entryProblems(e) {
  const p = [];
  if (!e.test || !e.file) p.push("test and file are required");
  if (!e.reason?.trim()) p.push("a reason is required");
  if (!e.evidence?.trim()) p.push("evidence is required (the flaky verdict: a pass and a fail at one commit)");
  const since = Date.parse(e.since);
  const expires = Date.parse(e.expires);
  if (!Number.isFinite(since) || !Number.isFinite(expires)) p.push("since and expires must be dates");
  else if (expires <= since || expires - since > MAX_QUARANTINE_DAYS * DAY) p.push(`expires must be after since and at most ${MAX_QUARANTINE_DAYS} days later`);
  return p;
}

/** Active, expired and invalid quarantine entries at `now`. */
export function checkQuarantine(q, now = Date.now()) {
  const out = { active: [], expired: [], invalid: [] };
  for (const e of q.entries) {
    const problems = entryProblems(e);
    if (problems.length) out.invalid.push({ ...e, problems });
    else if (Date.parse(e.expires) <= now) out.expired.push(e);
    else out.active.push(e);
  }
  return out;
}

/** Add a test to the quarantine; refused unless its history says flaky. */
export function quarantine(q, { test, file, reason, owner = "", history, now = Date.now(), days = 7 }) {
  const v = classify(history.filter((r) => r.file === file && (r.test === test || r.test === "(file)")));
  if (v.verdict !== "flaky") throw new Error(`refused: ${test} is ${v.verdict} (${v.why}); only a flaky test goes into quarantine`);
  if (days > MAX_QUARANTINE_DAYS) throw new Error(`refused: at most ${MAX_QUARANTINE_DAYS} days`);
  const entry = { test, file, reason, owner, evidence: v.why, since: new Date(now).toISOString(), expires: new Date(now + days * DAY).toISOString() };
  return { ...q, entries: [...q.entries.filter((e) => !(e.test === test && e.file === file)), entry] };
}

/** How a failure is reported given the quarantine: quarantined (not hidden) while active, red otherwise. */
export function reportFailure(q, { test, file }, now = Date.now()) {
  const e = q.entries.find((x) => x.test === test && x.file === file);
  if (!e) return { status: "red" };
  if (entryProblems(e).length || Date.parse(e.expires) <= now) return { status: "red", note: `quarantine of ${test} expired or invalid: fix it or renew with new evidence` };
  return { status: "quarantined", note: `quarantined until ${e.expires.slice(0, 10)}: ${e.reason}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sub, ...rest] = process.argv.slice(2);
  const opt = (k, d) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : d);
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim() || "unknown";
  if (sub === "rerun" && rest[0]) {
    const rows = rerunAlone(rest[0], { times: Number(opt("--times", 3)), commit });
    appendHistory(rows);
    const v = classify(readHistory().filter((r) => r.file === rest[0]), { commit });
    console.log(`${rest[0]}: ${v.verdict} (${v.why})`);
  } else if (sub === "classify" && rest[0]) {
    const v = classify(readHistory().filter((r) => r.file === rest[0]), { commit });
    console.log(`${rest[0]}: ${v.verdict} (${v.why})`);
  } else if (sub === "add" && rest[0] && opt("--test") && opt("--reason")) {
    const q = quarantine(loadQuarantine(), { file: rest[0], test: opt("--test"), reason: opt("--reason"), owner: opt("--owner", ""), history: readHistory(), days: Number(opt("--days", 7)) });
    writeFileSync(QUARANTINE_FILE, `${JSON.stringify(q, null, 1)}\n`);
  } else if (sub === "check") {
    const r = checkQuarantine(loadQuarantine());
    console.log(`quarantine: ${r.active.length} active, ${r.expired.length} expired, ${r.invalid.length} invalid`);
    for (const e of [...r.expired, ...r.invalid]) console.log(`  ✗ ${e.file} > ${e.test}${e.problems ? `: ${e.problems.join("; ")}` : ": expired"}`);
    process.exitCode = r.expired.length || r.invalid.length ? 1 : 0;
  } else {
    console.error("usage: flake.mjs rerun <file> [--times N] | classify <file> | add <file> --test NAME --reason TEXT [--days N] | check");
    process.exit(2);
  }
}
