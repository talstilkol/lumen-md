#!/usr/bin/env node
/**
 * The Vercel build, and the project's gates without GitHub Actions (W1.35).
 *
 * Vercel builds every branch and reports the result to GitHub as the
 * "Vercel" commit status. A preview build therefore runs the checks CI
 * used to run, and any failing gate fails the build, so a pull request with
 * a failing test gets a red status. Production (main) builds as before:
 * the app and its bundle budget, nothing else.
 *
 *   VERCEL_ENV=preview      build, budget, vitest, i18n:check, hygiene,
 *                           docs:sync, the licence gate
 *   VERCEL_ENV=production   build, budget
 *   (not on Vercel)         the preview set, so `node scripts/vercel-build.mjs`
 *                           reproduces a preview build locally
 *
 * The gates run in that order and stop at the first failure (exit code
 * 1), with one line per gate and its time. Playwright e2e does not run
 * here: it needs browsers and runs in the Vercel Sandbox (W1.1).
 *
 * Usage: node scripts/vercel-build.mjs [--production | --preview] [--dry-run]
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** Every gate: its name and the npm script that runs it. */
export const GATES = {
  build: ["run", "build"],
  budget: ["run", "budget"],
  vitest: ["run", "test"],
  "i18n:check": ["run", "-s", "i18n:check"],
  hygiene: ["run", "-s", "hygiene"],
  "docs:sync": ["run", "-s", "docs:sync"],
  licenses: ["run", "-s", "licenses"],
};

/**
 * Arguments a gate's npm script gets on top. Vitest also writes its JSON
 * report, so a failed run ends with one short block naming every failing
 * file: the build log shows only its tail, and the failure dump of a big run
 * is thousands of lines (W1.1).
 */
export const VITEST_REPORT = "reports/vitest.json";
export const GATE_EXTRA = {
  vitest: ["--", "--reporter=default", "--reporter=json", `--outputFile.json=${VITEST_REPORT}`],
};

/**
 * The end-of-log summary of a vitest JSON report (its jest-style shape):
 * the counts, then each failing file with up to three failing tests and the
 * first line of the first error. Lines, or null when there is no report.
 */
export function vitestSummary(report, { maxFiles = 80 } = {}) {
  if (!report || !Array.isArray(report.testResults)) return null;
  const firstLine = (m) => String(m ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const cut = (t, n = 220) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  const rel = (f) => String(f).replace(/^.*?(?=src\/|scripts\/|e2e\/)/, "");
  const failed = report.testResults.filter((f) => f.status === "failed");
  const out = [
    `✗ vitest summary: files ${report.numFailedTestSuites ?? failed.length} failed / ${report.numTotalTestSuites ?? report.testResults.length}; tests ${report.numFailedTests ?? 0} failed, ${report.numPassedTests ?? 0} passed / ${report.numTotalTests ?? 0}`,
  ];
  for (const f of failed.slice(0, maxFiles)) {
    const tests = (f.assertionResults ?? []).filter((a) => a.status === "failed");
    out.push(`  ${rel(f.name)}: ${tests.length ? `${tests.length} failed` : "the file failed to run"}`);
    if (!tests.length && f.message) out.push(`      ${cut(firstLine(f.message))}`);
    for (const a of tests.slice(0, 3)) out.push(`    × ${cut(a.fullName ?? a.title ?? "?", 160)}`, `      ${cut(firstLine(a.failureMessages?.[0]))}`);
    if (tests.length > 3) out.push(`    … ${tests.length - 3} more`);
  }
  if (failed.length > maxFiles) out.push(`  … ${failed.length - maxFiles} more files`);
  return out;
}

export const PRODUCTION_GATES = ["build", "budget"];
export const PREVIEW_GATES = ["build", "budget", "vitest", "i18n:check", "hygiene", "docs:sync", "licenses"];

/** Which gates a build runs: production only for VERCEL_ENV=production (or --production). */
export function gatesFor(env = process.env, argv = []) {
  if (argv.includes("--production")) return PRODUCTION_GATES;
  if (argv.includes("--preview")) return PREVIEW_GATES;
  return env.VERCEL_ENV === "production" ? PRODUCTION_GATES : PREVIEW_GATES;
}

function main() {
  const argv = process.argv.slice(2);
  const gates = gatesFor(process.env, argv);
  const where = process.env.VERCEL_ENV ? `VERCEL_ENV=${process.env.VERCEL_ENV}` : "local";
  console.log(`vercel-build (${where}): ${gates.join(" → ")}`);
  if (argv.includes("--dry-run")) return;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const done = [];
  for (const gate of gates) {
    const started = Date.now();
    console.log(`\n▶ ${gate}`);
    const r = spawnSync(npm, [...GATES[gate], ...(GATE_EXTRA[gate] ?? [])], { stdio: "inherit", env: process.env });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (r.status !== 0) {
      if (gate === "vitest") {
        let report = null;
        try {
          report = JSON.parse(readFileSync(VITEST_REPORT, "utf8"));
        } catch {
          /* no report: vitest did not get that far */
        }
        const lines = vitestSummary(report);
        if (lines) console.error(`\n${lines.join("\n")}`);
      }
      console.error(`\n✗ vercel-build: the ${gate} gate failed (${secs} s, exit ${r.status ?? r.signal}). Passed before it: ${done.join(", ") || "none"}.`);
      process.exit(1);
    }
    done.push(`${gate} ${secs} s`);
  }
  console.log(`\n✓ vercel-build: ${done.join(" · ")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
