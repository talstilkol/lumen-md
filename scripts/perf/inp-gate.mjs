#!/usr/bin/env node
/**
 * The local responsiveness gate (plan W1.22).
 *
 *   npm run perf:inp                 # measure (Playwright "inp" project) and gate
 *   node scripts/perf/inp-gate.mjs   # gate reports/perf/inp-latest.json against the baseline
 *     --record    also append the run to reports/perf/inp-trend.jsonl (one line per merge)
 *     --update    make the latest run the new baseline (reports/perf/inp-baseline.json)
 *
 * Fails (exit 1) when a metric is 10 % or more slower than the baseline:
 * INP p75 over the 20 interactions, keypress → paint p95 in the 50 KB
 * and the 2 MB note, and (W11.Q5) in Moby-Dick and 2 MB of Ben-Yehuda in the
 * source editor and Moby-Dick in WYSIWYG. Lower is better for all three. The absolute budgets
 * (p75 < 100 ms, p95 < 16 / 33 ms) are asserted by e2e/inp-budget.spec.ts
 * itself.
 *
 *     --engines   (plan W13.V1, `npm run perf:inp`) also gate INP in Chromium,
 *                 Firefox and WebKit from reports/perf/inp-<engine>.json
 *                 (e2e/inp-engines.spec.ts): p75 ≤ 200 ms in each, all three
 *                 present, and every interaction over 200 ms in Chromium named
 *                 by its long-animation-frame script (file and function).
 *                 The table goes to reports/perf/inp-engines.md.
 */
import { engineGate, ENGINES, renderEngines } from "./inpAttribution.mjs";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REGRESSION = 0.1;

/** The gated numbers of a run, by name. */
export function gatedMetrics(run) {
  return {
    "INP p75": run?.inpP75,
    "keypress→paint p95 (50KB)": run?.keyToPaintP95?.["50KB"],
    "keypress→paint p95 (2MB)": run?.keyToPaintP95?.["2MB"],
    // W11.Q5: real text. A WYSIWYG run that fell back to the source editor is "fallback", not a number, and is not compared.
    "keypress→paint p95 (Moby-Dick, source)": run?.realText?.mobyDick,
    "keypress→paint p95 (Ben-Yehuda 2MB, source)": run?.realText?.benYehuda2MB,
    "keypress→paint p95 (Moby-Dick, WYSIWYG)": run?.realText?.wysiwyg?.mobyDick,
  };
}

/**
 * Compare `latest` with `baseline`: one row per metric present in both,
 * `regressed` when latest ≥ baseline × (1 + REGRESSION). A baseline under
 * 1 ms is compared against 1 ms, so noise at the floor never fails.
 */
export function compare(baseline, latest, threshold = REGRESSION) {
  const b = gatedMetrics(baseline);
  const l = gatedMetrics(latest);
  return Object.keys(b)
    .filter((k) => typeof b[k] === "number" && typeof l[k] === "number")
    .map((k) => {
      const base = Math.max(b[k], 1);
      const change = (l[k] - base) / base;
      return { metric: k, baseline: b[k], latest: l[k], change, regressed: change >= threshold };
    });
}

/** W13.V1: the three engines' reports, gated; returns the exit code. */
export function gateEngines(dir) {
  const runs = {};
  for (const e of ENGINES) {
    const p = join(dir, `inp-${e}.json`);
    runs[e] = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  }
  const gate = engineGate(runs);
  const md = renderEngines(gate);
  writeFileSync(join(dir, "inp-engines.md"), `# INP in three engines (W13.V1)\n\n${md}\n`);
  console.log(md);
  if (!gate.ok) console.error(`inp-gate: ${gate.problems.length} engine problem(s)`);
  return gate.ok ? 0 : 1;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const dir = join(root, "reports", "perf");
  if (process.argv.includes("--engines") && gateEngines(dir) !== 0) process.exit(1);
  const latestPath = join(dir, "inp-latest.json");
  const basePath = join(dir, "inp-baseline.json");
  const args = process.argv.slice(2);
  if (!existsSync(latestPath)) {
    console.error("inp-gate: no reports/perf/inp-latest.json — run `npm run perf:inp` first");
    process.exit(2);
  }
  const latest = JSON.parse(readFileSync(latestPath, "utf8"));
  if (args.includes("--record")) appendFileSync(join(dir, "inp-trend.jsonl"), JSON.stringify(latest) + "\n");
  if (args.includes("--update") || !existsSync(basePath)) {
    const first = !existsSync(basePath);
    writeFileSync(basePath, JSON.stringify(latest, null, 2) + "\n");
    console.log(first ? "inp-gate: no baseline yet — this run is now reports/perf/inp-baseline.json; commit it" : "inp-gate: reports/perf/inp-baseline.json updated");
    return;
  }
  const rows = compare(JSON.parse(readFileSync(basePath, "utf8")), latest);
  for (const r of rows) {
    const pct = `${r.change >= 0 ? "+" : ""}${(r.change * 100).toFixed(1)} %`;
    console.log(`${r.regressed ? "✗" : "✓"} ${r.metric.padEnd(28)} ${r.baseline.toFixed(1).padStart(7)} → ${r.latest.toFixed(1).padStart(7)} ms  ${pct}`);
  }
  const bad = rows.filter((r) => r.regressed);
  if (bad.length) {
    console.error(`inp-gate: ${bad.length} metric(s) ${REGRESSION * 100} % or more slower than the baseline`);
    process.exit(1);
  }
  console.log("inp-gate: no regression");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
