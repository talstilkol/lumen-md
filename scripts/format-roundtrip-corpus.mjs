#!/usr/bin/env node
/**
 * Plan W12.F1: freeze the 50 Hebrew notes of the format round-trip test.
 *
 * The test used to take "the first 50 mostly-Hebrew sections of docs/" at
 * run time, so every docs PR changed the corpus under the gate: a converter
 * could look 1.5 points worse because a page was edited, and the gate went
 * red without any code change (audit r2: formatRoundTrip red on b402c98035
 * from docs drift). The notes are now a fixture, chosen the same way once,
 * with the file each came from. The gate measures converters, not docs.
 *
 *   node scripts/format-roundtrip-corpus.mjs           write the fixture
 *   node scripts/format-roundtrip-corpus.mjs --check   exit 1 if it is missing or malformed
 *
 * Refreshing it is a deliberate change: re-measure the baseline in the same PR
 * (FORMAT_RT_BASELINE=1, raise only) and say so in the PR.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CORPUS_FILE = "src/__tests__/fixtures/format-roundtrip/hebrew-notes.json";
const N = 50;

/** Same split as src/storage/formatRoundTrip.ts splitAtHeadings (H1/H2, not inside a fence). */
function splitAtHeadings(text) {
  const parts = [];
  let cur = [];
  let fence = null;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const f = /^(`{3,}|~{3,})/.exec(line);
    if (fence === null && f) fence = f[1];
    else if (fence !== null && f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
    else if (fence === null && /^#{1,2} /.test(line) && cur.join("").trim()) {
      parts.push(cur.join("\n"));
      cur = [];
    }
    cur.push(line);
  }
  if (cur.join("").trim()) parts.push(cur.join("\n"));
  return parts.map((p) => p.trim() + "\n");
}

export const isHebrew = (s) => (s.match(/[֐-׿]/g)?.length ?? 0) > (s.match(/[A-Za-z]/g)?.length ?? 0);

export function validate(corpus) {
  const problems = [];
  if (!corpus || !Array.isArray(corpus.notes)) return ["no notes array"];
  if (corpus.notes.length !== N) problems.push(`${corpus.notes.length} notes, want ${N}`);
  for (const [i, n] of corpus.notes.entries()) {
    if (typeof n.file !== "string" || !n.file.startsWith("docs/")) problems.push(`note ${i}: no docs/ source file`);
    if (typeof n.markdown !== "string" || n.markdown.length <= 80) problems.push(`note ${i}: too short`);
    else if (!isHebrew(n.markdown)) problems.push(`note ${i}: not mostly Hebrew`);
  }
  if (new Set(corpus.notes.map((n) => n.markdown)).size !== corpus.notes.length) problems.push("duplicate notes");
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = join(root, CORPUS_FILE);
  if (process.argv.includes("--check")) {
    const problems = existsSync(file) ? validate(JSON.parse(readFileSync(file, "utf8"))) : [`${CORPUS_FILE} is missing`];
    for (const p of problems) console.error(p);
    process.exit(problems.length ? 1 : 0);
  }
  const files = readdirSync(join(root, "docs"), { recursive: true })
    .filter((n) => n.endsWith(".md"))
    .sort()
    .map((n) => join("docs", n));
  const notes = files
    .flatMap((f) => splitAtHeadings(readFileSync(join(root, f), "utf8")).map((markdown) => ({ file: f, markdown })))
    .filter((n) => isHebrew(n.markdown) && n.markdown.length > 80)
    .slice(0, N);
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["rev-parse", "--short=10", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    /* not a checkout */
  }
  const out = {
    note: "Plan W12.F1: 50 Hebrew sections of this repository's docs/, frozen so the round-trip gate measures converters, not docs edits. Made by scripts/format-roundtrip-corpus.mjs.",
    licence: "MIT (this repository's own documentation)",
    frozenAt: commit,
    notes,
  };
  const problems = validate(out);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  console.log(`wrote ${CORPUS_FILE}: ${notes.length} notes from ${new Set(notes.map((n) => n.file)).size} files at ${commit}`);
}
