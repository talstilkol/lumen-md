#!/usr/bin/env node
/**
 * The reading study (W13.R14): six readers, two of them with dyslexia, read
 * the same invented passages, one per reading mode, in a Latin-square order
 * (eval/reading-study/protocol.json). Per mode: reading time, comprehension
 * (3 questions) and preference (1–5). The experimental modes (RSVP, anchor
 * emphasis) stay or go by the protocol's rule — evidence, not opinion.
 *
 *   node scripts/owner/readingStudy.mjs status    how many valid sessions; exit 1 below 6
 *   node scripts/owner/readingStudy.mjs summary   eval/results/reading/summary.json, with the decisions
 *   node scripts/owner/readingStudy.mjs blank <reader-id> --slot <0-5> [--dyslexia]   an empty sheet to fill in
 *
 * A session file, eval/results/reading/<reader>.json:
 *   { "reader": "r1", "dyslexia": false, "date": "2026-12-01", "language": "he",
 *     "readings": [ { "mode": "rsvp", "passage": "p3", "seconds": 48.2, "answers": [1, 2, 0], "preference": 3 } ] }
 * Readers are pseudonymous ids: no names, no other personal data.
 * The owner's session (scripts/owner/steps.mjs, devices/reading-study) checks this.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PROTOCOL = join(ROOT, "eval", "reading-study", "protocol.json");
export const RESULTS = join(ROOT, "eval", "results", "reading");

export const loadProtocol = (p = PROTOCOL) => JSON.parse(readFileSync(p, "utf8"));

/** Problems with one session file (an empty list: valid). */
export function validateSession(s, protocol) {
  const errs = [];
  if (!s || typeof s !== "object") return ["not an object"];
  if (typeof s.reader !== "string" || !/^[\w-]{1,32}$/.test(s.reader)) errs.push("reader: a short pseudonymous id");
  if (typeof s.dyslexia !== "boolean") errs.push("dyslexia: true or false");
  const modes = protocol.modes.map((m) => m.id);
  const passages = new Map(protocol.passages.map((p) => [p.id, p]));
  const readings = Array.isArray(s.readings) ? s.readings : [];
  const seen = new Set(readings.map((r) => r.mode));
  for (const m of modes) if (!seen.has(m)) errs.push(`no reading in mode ${m}`);
  if (new Set(readings.map((r) => r.passage)).size !== readings.length) errs.push("a passage was read twice");
  for (const r of readings) {
    const p = passages.get(r.passage);
    if (!modes.includes(r.mode)) errs.push(`unknown mode ${r.mode}`);
    if (!p) errs.push(`unknown passage ${r.passage}`);
    if (!(typeof r.seconds === "number" && r.seconds > 0 && r.seconds < 3600)) errs.push(`${r.mode}: seconds`);
    if (!Array.isArray(r.answers) || (p && r.answers.length !== p.questions.length)) errs.push(`${r.mode}: answers`);
    if (!(Number.isInteger(r.preference) && r.preference >= 1 && r.preference <= 5)) errs.push(`${r.mode}: preference 1–5`);
  }
  return errs;
}

export function readSessions(dir = RESULTS) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "summary.json")
    .map((f) => {
      try {
        return { file: f, session: JSON.parse(readFileSync(join(dir, f), "utf8")) };
      } catch {
        return { file: f, session: null };
      }
    });
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x, d = 1) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Per mode, for all readers and for the dyslexic readers: median seconds, comprehension %, median preference. */
export function summarize(sessions, protocol) {
  const passages = new Map(protocol.passages.map((p) => [p.id, p]));
  const out = {};
  for (const m of protocol.modes) {
    const rows = (group) =>
      sessions
        .filter((s) => group === "all" || s.dyslexia)
        .flatMap((s) => s.readings.filter((r) => r.mode === m.id))
        .map((r) => {
          const p = passages.get(r.passage);
          const correct = p ? r.answers.filter((a, i) => a === p.questions[i].answer).length / p.questions.length : 0;
          return { seconds: r.seconds, comprehension: correct * 100, preference: r.preference };
        });
    const stat = (rs) => ({ n: rs.length, seconds: round(median(rs.map((r) => r.seconds))), comprehension: round(mean(rs.map((r) => r.comprehension))), preference: median(rs.map((r) => r.preference)) });
    out[m.id] = { all: stat(rows("all")), dyslexia: stat(rows("dyslexia")) };
  }
  return out;
}

/** The protocol's rule for each experimental mode: keep or drop, and why. */
export function decide(summary, protocol) {
  const base = summary.baseline;
  const out = {};
  for (const id of protocol.decisionRule.experimental) {
    const s = summary[id];
    if (!s || !s.all.n || !base?.all.n) {
      out[id] = { decision: "undecided", why: "no data" };
      continue;
    }
    const reasons = [];
    if (s.all.comprehension < base.all.comprehension - 10) reasons.push(`comprehension ${s.all.comprehension}% < baseline ${base.all.comprehension}% − 10`);
    if ((s.all.preference ?? 0) < 3) reasons.push(`median preference ${s.all.preference} < 3`);
    if (s.dyslexia.n && base.dyslexia.n && s.dyslexia.comprehension < base.dyslexia.comprehension - 10) reasons.push(`dyslexic readers: comprehension ${s.dyslexia.comprehension}% < baseline ${base.dyslexia.comprehension}% − 10`);
    out[id] = reasons.length ? { decision: "drop", why: reasons.join("; ") } : { decision: "keep", why: "comprehension and preference meet the rule" };
  }
  return out;
}

/** Is the study done: 6 valid sessions, at least 2 with dyslexia, and a decision for every experimental mode. */
export function status(entries, protocol) {
  const valid = entries.filter((e) => e.session && !validateSession(e.session, protocol).length).map((e) => e.session);
  const invalid = entries.filter((e) => !e.session || validateSession(e.session, protocol).length).map((e) => ({ file: e.file, errors: e.session ? validateSession(e.session, protocol) : ["not JSON"] }));
  const dyslexic = valid.filter((s) => s.dyslexia).length;
  const decisions = valid.length ? decide(summarize(valid, protocol), protocol) : {};
  const decided = protocol.decisionRule.experimental.every((id) => decisions[id] && decisions[id].decision !== "undecided");
  return { sessions: valid.length, dyslexic, invalid, decisions, done: valid.length >= protocol.readers && dyslexic >= protocol.dyslexicReaders && decided };
}

/** An empty sheet in the Latin square's row `slot` (give each reader a different slot, 0–5). */
export function blank(protocol, reader, dyslexia, slot) {
  const i = Number.isInteger(slot) ? slot % protocol.order.length : Math.abs([...reader].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % protocol.order.length;
  return { reader, dyslexia, date: new Date().toISOString().slice(0, 10), language: "he", order: i, readings: protocol.order[i].map((o) => ({ mode: o.mode, passage: o.passage, seconds: null, answers: [], preference: null })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd = "status", arg] = process.argv.slice(2);
  const protocol = loadProtocol();
  const entries = readSessions();
  if (cmd === "status") {
    const s = status(entries, protocol);
    console.log(`reading study: ${s.sessions}/${protocol.readers} sessions (${s.dyslexic}/${protocol.dyslexicReaders} with dyslexia)${s.invalid.length ? `, ${s.invalid.length} invalid` : ""}`);
    for (const e of s.invalid) console.log(`  ✗ ${e.file}: ${e.errors.join("; ")}`);
    for (const [id, d] of Object.entries(s.decisions)) console.log(`  ${id}: ${d.decision} — ${d.why}`);
    process.exit(s.done ? 0 : 1);
  } else if (cmd === "summary") {
    const valid = entries.map((e) => e.session).filter((x) => x && !validateSession(x, protocol).length);
    const summary = summarize(valid, protocol);
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(join(RESULTS, "summary.json"), JSON.stringify({ sessions: valid.length, summary, decisions: decide(summary, protocol) }, null, 2) + "\n");
    console.log(`wrote ${join("eval", "results", "reading", "summary.json")} from ${valid.length} session(s)`);
  } else if (cmd === "blank") {
    if (!arg) throw new Error("blank <reader-id> [--dyslexia]");
    const k = process.argv.indexOf("--slot");
    console.log(JSON.stringify(blank(protocol, arg, process.argv.includes("--dyslexia"), k > 0 ? Number(process.argv[k + 1]) : undefined), null, 2));
  } else {
    console.error("usage: readingStudy.mjs status | summary | blank <reader-id> [--dyslexia]");
    process.exit(2);
  }
}
