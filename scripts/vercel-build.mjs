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
    const r = spawnSync(npm, GATES[gate], { stdio: "inherit", env: process.env });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (r.status !== 0) {
      console.error(`\n✗ vercel-build: the ${gate} gate failed (${secs} s, exit ${r.status ?? r.signal}). Passed before it: ${done.join(", ") || "none"}.`);
      process.exit(1);
    }
    done.push(`${gate} ${secs} s`);
  }
  console.log(`\n✓ vercel-build: ${done.join(" · ")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
