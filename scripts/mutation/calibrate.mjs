#!/usr/bin/env node
/**
 * W11.Q9 (research R5.9): compare the home-grown mutation score with
 * StrykerJS's on the same modules. A home-grown score is not comparable to
 * anything outside; Stryker's is. When the two differ by more than
 * TOLERANCE points, ours is reported as "unverified" for that module
 * (scripts/mutation/check.mjs prints it, and the plan's status must say so).
 *
 *   npx stryker run stryker/stryker.calibrate.json             # reports/mutation/stryker-calibration.json
 *   node scripts/mutation/run.mjs --module gitMerge --max 400  # ours, reports/mutation/report.json (one module per run,
 *   node scripts/mutation/calibrate.mjs --ours reports/mutation/report.json   # or several --ours files)
 *
 * Writes scripts/mutation/calibration.json: per module, both scores, the
 * difference and the verdict. Stryker's score is its "mutation score":
 * detected (killed + timeout) over detected plus undetected (survived + no
 * coverage); compile and runtime errors and ignored mutants do not count,
 * like the invalid mutants ours leaves out.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TOLERANCE = 5;
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const OUT = "scripts/mutation/calibration.json";

const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

/** Stryker's score per file of a mutation-testing-report-schema JSON report. */
export function strykerScores(report) {
  const out = {};
  for (const [file, f] of Object.entries(report?.files ?? {})) {
    const mutants = f.mutants ?? [];
    const detected = mutants.filter((m) => DETECTED.has(m.status)).length;
    const undetected = mutants.filter((m) => UNDETECTED.has(m.status)).length;
    const valid = detected + undetected;
    out[file.replace(/\\/g, "/").replace(/^.*?(src\/)/, "$1")] = { score: valid ? Math.round((detected / valid) * 1000) / 10 : null, mutants: mutants.length, detected, undetected, invalid: mutants.length - valid };
  }
  return out;
}

/** Our scores per module, from run.mjs reports (reports/mutation/report.json) and, failing that, the receipt. */
export function ourScores(reports, receipt) {
  const out = {};
  for (const [module, r] of Object.entries(receipt?.modules ?? {})) out[module] = { score: r.score, sampled: r.sampled, mutants: r.mutants, runner: r.runner, from: "receipt" };
  for (const rep of reports) for (const r of rep.modules ?? rep.results ?? (Array.isArray(rep) ? rep : [])) if (r.module) out[r.module] = { score: r.score, sampled: r.sampled, mutants: r.mutants, runner: rep.runner ?? r.runner ?? null, from: "report" };
  return out;
}

/** The verdict per calibrated module. */
export function calibrate(modules, ours, stryker, tolerance = TOLERANCE) {
  const out = {};
  for (const m of modules) {
    const o = ours[m];
    const s = stryker[m];
    if (!o || !s || s.score === null) {
      out[m] = { ours: o?.score ?? null, stryker: s?.score ?? null, diff: null, verdict: "not measured", note: !s ? "no Stryker run" : !o ? "no home-grown run" : "Stryker found no valid mutants" };
      continue;
    }
    const diff = Math.round((o.score - s.score) * 10) / 10;
    out[m] = {
      ours: o.score,
      oursRunner: o.runner,
      oursSampled: `${o.sampled}/${o.mutants}`,
      stryker: s.score,
      strykerMutants: s.mutants,
      diff,
      verdict: Math.abs(diff) > tolerance ? "unverified" : "verified",
    };
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const all = (k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
  const strykerFile = all("stryker")[0] ?? "reports/mutation/stryker-calibration.json";
  const config = JSON.parse(readFileSync(join(ROOT, "stryker/stryker.calibrate.json"), "utf8"));
  if (!existsSync(join(ROOT, strykerFile))) {
    console.error(`calibrate: no ${strykerFile}: run \`npx stryker run stryker/stryker.calibrate.json\` first`);
    process.exit(2);
  }
  const stryker = strykerScores(JSON.parse(readFileSync(join(ROOT, strykerFile), "utf8")));
  const receiptFile = join(ROOT, "scripts/mutation/receipt.json");
  const receipt = existsSync(receiptFile) ? JSON.parse(readFileSync(receiptFile, "utf8")) : null;
  const ours = ourScores(all("ours").map((f) => JSON.parse(readFileSync(join(ROOT, f), "utf8"))), receipt);
  const modules = calibrate(config.mutate, ours, stryker);
  writeFileSync(join(ROOT, OUT), `${JSON.stringify({ $comment: "W11.Q9: written by scripts/mutation/calibrate.mjs. A module whose home-grown score differs from Stryker's by more than `tolerance` points is 'unverified'.", tolerance: TOLERANCE, date: new Date().toISOString().slice(0, 10), modules }, null, 2)}\n`);
  for (const [m, r] of Object.entries(modules)) console.log(`${r.verdict === "verified" ? "✓" : r.verdict === "unverified" ? "✗" : "·"} ${m}: ours ${r.ours ?? "—"} vs Stryker ${r.stryker ?? "—"}${r.diff !== null ? ` (${r.diff > 0 ? "+" : ""}${r.diff})` : ""} → ${r.verdict}${r.note ? ` (${r.note})` : ""}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
