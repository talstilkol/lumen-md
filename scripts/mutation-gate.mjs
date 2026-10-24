#!/usr/bin/env node
/**
 * The mutation-testing gate (plan 0.15), run after Stryker:
 *
 *   node scripts/mutation-gate.mjs                  check reports/mutation/mutation.json
 *   node scripts/mutation-gate.mjs --write-baseline record today's survivors (owner decision)
 *
 * Fails when
 *  - a module in the critical set scores below 70 % (killed + timeout over
 *    all mutants that some test reaches — Stryker's "covered" score), or
 *  - a mutant survives that scripts/mutation.baseline.json does not list.
 * A baseline entry that no longer survives is reported, so the baseline
 * only shrinks (`--prune` drops them).
 *
 * A survivor is identified by file, mutator and the mutated source text,
 * not by line number, so unrelated edits above it do not churn the
 * baseline.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = join(ROOT, "reports", "mutation", "mutation.json");
const BASELINE = join(ROOT, "scripts", "mutation.baseline.json");
export const MIN_SCORE = 70;

/** A stable key for one mutant: file · mutator · original text → replacement. */
export function mutantKey(file, source, m) {
  const lines = source.split("\n");
  const { start, end } = m.location;
  let original;
  if (start.line === end.line) original = lines[start.line - 1]?.slice(start.column - 1, end.column - 1) ?? "";
  else original = [lines[start.line - 1]?.slice(start.column - 1) ?? "", ...lines.slice(start.line, end.line - 1), lines[end.line - 1]?.slice(0, end.column - 1) ?? ""].join("\n");
  const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  return `${file} · ${m.mutatorName} · ${squash(original)} → ${squash(m.replacement)}`;
}

/** Per-file score and survivors from a Stryker mutation-testing-report-schema JSON. */
export function summarize(report) {
  const files = {};
  for (const [abs, f] of Object.entries(report.files)) {
    const file = relative(ROOT, abs).split("\\").join("/") || abs;
    let killed = 0;
    let covered = 0;
    const survivors = [];
    for (const m of f.mutants) {
      if (m.status === "Killed" || m.status === "Timeout") {
        killed++;
        covered++;
      } else if (m.status === "Survived") {
        covered++;
        survivors.push(mutantKey(file, f.source, m));
      }
    }
    files[file] = { score: covered ? (100 * killed) / covered : 100, killed, covered, total: f.mutants.length, survivors: survivors.sort() };
  }
  return files;
}

/** Compare a summary with the baseline: what fails and what is stale. */
export function judge(files, baseline, minScore = MIN_SCORE) {
  const known = new Set(baseline.survivors ?? []);
  const lowScore = Object.entries(files).filter(([, f]) => f.score < minScore).map(([file, f]) => ({ file, score: f.score }));
  const all = Object.values(files).flatMap((f) => f.survivors);
  const fresh = all.filter((k) => !known.has(k));
  const now = new Set(all);
  const stale = [...known].filter((k) => !now.has(k) && Object.keys(files).some((file) => k.startsWith(`${file} · `)));
  return { lowScore, fresh, stale, ok: lowScore.length === 0 && fresh.length === 0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(REPORT)) {
    console.error(`${relative(ROOT, REPORT)} is missing: run Stryker first (npm run mutation).`);
    process.exit(2);
  }
  const files = summarize(JSON.parse(readFileSync(REPORT, "utf8")));
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { survivors: [] };
  if (process.argv.includes("--write-baseline")) {
    const survivors = Object.values(files).flatMap((f) => f.survivors).sort();
    writeFileSync(BASELINE, JSON.stringify({ note: "Surviving mutants accepted today (plan 0.15). New survivors fail the gate; this list only shrinks.", survivors }, null, 2) + "\n");
    console.log(`wrote ${relative(ROOT, BASELINE)}: ${survivors.length} survivors`);
    process.exit(0);
  }
  const { lowScore, fresh, stale, ok } = judge(files, baseline);
  console.log("| module | score | killed / covered | mutants | survivors |\n|---|---|---|---|---|");
  for (const [file, f] of Object.entries(files).sort()) console.log(`| ${file} | ${f.score.toFixed(1)} % | ${f.killed} / ${f.covered} | ${f.total} | ${f.survivors.length} |`);
  for (const l of lowScore) console.error(`✗ ${l.file}: mutation score ${l.score.toFixed(1)} % < ${MIN_SCORE} %`);
  for (const k of fresh) console.error(`✗ new surviving mutant: ${k}`);
  if (stale.length) {
    if (process.argv.includes("--prune")) {
      const keep = (baseline.survivors ?? []).filter((k) => !stale.includes(k));
      writeFileSync(BASELINE, JSON.stringify({ ...baseline, survivors: keep }, null, 2) + "\n");
      console.log(`pruned ${stale.length} baseline entries that no longer survive`);
    } else console.log(`${stale.length} baseline entries no longer survive — run with --prune to drop them`);
  }
  console.log(ok ? "✓ mutation gate passed" : "✗ mutation gate failed");
  process.exit(ok ? 0 : 1);
}
