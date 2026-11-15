#!/usr/bin/env node
/**
 * Max-lines gate (plan W6.25; W10.E31): no production file under src/ is
 * longer than 800 lines. No baseline, no exceptions (scripts/lib/maxLines.mjs).
 *
 *   node scripts/check-max-lines.mjs     check (part of `npm run hygiene`)
 *
 * Exit 1 when a file is over 800 lines, or when a baseline file is back.
 */
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkMaxLines, describeProblems, MAX_LINES, productionLineCounts, RETIRED_BASELINE_PATH } from "./lib/maxLines.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function main() {
  const counts = productionLineCounts(root);
  const problems = describeProblems(checkMaxLines(counts));
  if (existsSync(join(root, RETIRED_BASELINE_PATH))) problems.push(`${RETIRED_BASELINE_PATH}: the gate has no baseline (W10.E31); delete it and split the file instead`);
  for (const p of problems) console.error(`[max-lines]  ${p}`);
  if (problems.length) {
    console.error(`\n✖ max lines: ${problems.length} problem(s). No production file may pass ${MAX_LINES} lines.`);
    process.exit(1);
  }
  console.error(`✓ max lines: ${Object.keys(counts).length} production files, none over ${MAX_LINES}; no baseline.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
