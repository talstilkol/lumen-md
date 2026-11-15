#!/usr/bin/env node
/**
 * Known-error database for local train runs (R12.12).
 *
 * `scripts/ci-doctor/kedb.json` lists errors we have seen before. Each entry
 * matches failures by signature key (failSig.mjs) or by a regex over the
 * masked error head, and says:
 *
 *   cause       why it happens, in one sentence
 *   class       "env" (the machine or shim, not the code), "code", or "flaky"
 *   workaround  what to do now
 *   runbook     an optional command that fixes or confirms it
 *   outcomes    what happened each time the runbook ran: { at, ok }
 *
 * **The outcomes decide how much the runbook may do alone.** Nobody sets a
 * level by hand:
 *
 *   suggest     the default: print the command, a person runs it
 *   ask         ≥ 3 runs and the Wilson 95% lower bound of the success rate
 *               ≥ 0.4 (3 of 3 is 0.44): the doctor may offer to run it, and a
 *               person says yes
 *   auto        ≥ 10 runs, Wilson lower bound ≥ 0.8 (16 of 16 is 0.81), and
 *               none of the last 3 failed: the doctor may run it unasked (a
 *               local, read-only or reversible command; never a push, never
 *               a merge)
 *
 * One failure in the last three drops `auto` to `ask`, so trust is earned
 * slowly and lost fast.
 *
 * Clean reimplementation; design reference only: israelconnect's
 * tools/control/kedb.py (AGPL), no code copied.
 *
 * CLI: node scripts/ci-doctor/kedb.mjs <log> [--json]   which failures are known, and what to do
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signatures } from "./failSig.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const KEDB_FILE = join(HERE, "kedb.json");

/** Wilson score interval, 95% (z = 1.96): the honest range of a success rate from few runs. */
export function wilson(ok, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = ok / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - r) / d), Math.min(1, (c + r) / d)];
}

export const LEVELS = Object.freeze(["suggest", "ask", "auto"]);

/** How much a runbook may do alone, from its outcomes only. */
export function autonomy(outcomes = []) {
  const n = outcomes.length;
  const ok = outcomes.filter((o) => o.ok).length;
  const [lo] = wilson(ok, n);
  const lastFail = outcomes.slice(-3).some((o) => !o.ok);
  if (n >= 10 && lo >= 0.8 && !lastFail) return "auto";
  if (n >= 3 && lo >= 0.4) return "ask";
  return "suggest";
}

export function loadKedb(file = KEDB_FILE) {
  const db = JSON.parse(readFileSync(file, "utf8"));
  if (db.schema !== 1 || !Array.isArray(db.entries)) throw new Error(`${file}: expected { schema: 1, entries: [] }`);
  for (const e of db.entries) {
    if (!e.id || !(e.key || e.match)) throw new Error(`${file}: entry ${e.id ?? "?"} needs an id and a key or match`);
    if (!["env", "code", "flaky"].includes(e.class)) throw new Error(`${file}: entry ${e.id}: class must be env, code or flaky`);
    // A level written by hand is refused: only outcomes grant autonomy.
    if ("autonomy" in e) throw new Error(`${file}: entry ${e.id}: autonomy is computed from outcomes, not written`);
  }
  return db;
}

/** The entry a signature matches: an exact key first, then the first regex over the masked head. */
export function lookup(db, sig) {
  const byKey = db.entries.find((e) => e.key && e.key === sig.key);
  if (byKey) return byKey;
  return db.entries.find((e) => e.match && new RegExp(e.match, "i").test(sig.head)) ?? null;
}

/** Every failure of a log with its known error, if any, and the runbook's level. */
export function diagnose(log, db) {
  return signatures(log).map((s) => {
    const e = lookup(db, s);
    return { ...s, known: e ? { id: e.id, class: e.class, cause: e.cause, workaround: e.workaround, runbook: e.runbook ?? null, autonomy: autonomy(e.outcomes) } : null };
  });
}

/** Record one runbook outcome (returns a new db; the caller writes it). */
export function recordOutcome(db, id, ok, at = new Date().toISOString()) {
  const entries = db.entries.map((e) => (e.id === id ? { ...e, outcomes: [...(e.outcomes ?? []), { at, ok: !!ok }] } : e));
  if (!entries.some((e) => e.id === id)) throw new Error(`no kedb entry ${id}`);
  return { ...db, entries };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "record" && args[1] && /^(ok|fail)$/.test(args[2] ?? "")) {
    writeFileSync(KEDB_FILE, `${JSON.stringify(recordOutcome(loadKedb(), args[1], args[2] === "ok"), null, 1)}\n`);
    process.exit(0);
  }
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: node scripts/ci-doctor/kedb.mjs <log> [--json] | record <id> ok|fail");
    process.exit(2);
  }
  const rows = diagnose(readFileSync(file, "utf8"), loadKedb());
  if (args.includes("--json")) console.log(JSON.stringify(rows, null, 1));
  else
    for (const r of rows) {
      console.log(`${r.key}  ${r.test}`);
      if (!r.known) console.log("    unknown: a new error (add it to kedb.json once its cause is known)");
      else console.log(`    ${r.known.id} [${r.known.class}] ${r.known.cause}\n    now: ${r.known.workaround}${r.known.runbook ? `\n    runbook (${r.known.autonomy}): ${r.known.runbook}` : ""}`);
    }
}
