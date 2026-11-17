#!/usr/bin/env node
/**
 * W13.H6: the recorded RTL test is complete and every claim has its video.
 *
 *   node scripts/rtl-benchmark-audit.mjs            all 60 cells (12 scenarios × 5 apps), each with a
 *                                                   version, a date and a video in docs/public — exit 1 otherwise
 *   node scripts/rtl-benchmark-audit.mjs --partial  only that the recorded cells are valid (a run on the way)
 *
 * Part of `npm run docs:audit`. The ledger: launch/rtl-benchmark.json; the script: docs/rtl-benchmark.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RTL_APPS, RTL_SCENARIOS, rtlMissing, rtlProblems } from "../src/eval/public/rtlBenchmark.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function audit(root = ROOT, { partial = false } = {}) {
  const p = join(root, "launch/rtl-benchmark.json");
  if (!existsSync(p)) return { ok: false, lines: ["✗ rtl-benchmark: launch/rtl-benchmark.json is missing"] };
  const ledger = JSON.parse(readFileSync(p, "utf8"));
  const problems = rtlProblems(ledger, (v) => existsSync(join(root, "docs/public", v)));
  const missing = partial ? [] : rtlMissing(ledger);
  const lines = [...problems.map((x) => `✗ rtl-benchmark: ${x}`)];
  if (missing.length) lines.push(`✗ rtl-benchmark: ${missing.length} of ${RTL_SCENARIOS.length * RTL_APPS.length} cells not recorded yet (docs/rtl-benchmark.md), e.g. ${missing.slice(0, 3).join(", ")}`);
  if (!problems.length && !missing.length) lines.push(`✓ rtl-benchmark: ${ledger.cells.length} recorded cells, each with a version, a date and its video`);
  return { ok: !problems.length && !missing.length, lines };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = audit(ROOT, { partial: process.argv.includes("--partial") });
  for (const l of r.lines) (r.ok ? console.log : console.error)(l);
  process.exit(r.ok ? 0 : 1);
}
