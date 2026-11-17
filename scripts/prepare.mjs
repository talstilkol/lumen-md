#!/usr/bin/env node
/**
 * npm's `prepare` script: what `npm install` / `npm ci` run in a checkout of
 * this repo. One script for both clone set-ups that used to want the slot:
 *
 *   1. scripts/install-git-hooks.mjs   the reference-transaction hook, and the
 *                                      pre-push hook when opted in (W10.E56 / W10.E57)
 *   2. scripts/git-setup.mjs           the lumen-help and lumen-lanes merge
 *                                      drivers in the clone's local config (W8.11)
 *
 * Rules:
 *   - never fails the install: a step that fails, hangs or is missing is one
 *     line, and this exits 0;
 *   - nothing at all in CI ($CI set and not "false"/"0");
 *   - no network, and no process left running when it returns: each step is
 *     a node child process that it waits for (git is run to read the hooks
 *     path and the config), and they only write files under the clone's hooks
 *     folder and keys in its local git config. The ci:local pre-push hook is
 *     written only in a clone that opted in (git config lumen.ciLocalHook true,
 *     or $LUMEN_CI_LOCAL_HOOK=1; review 11, M2). The hourly lane-state watcher is
 *     never started here. The reference-transaction hook starts it on a later
 *     ref change, and only in a clone with a lane state (git config
 *     lumen.laneState / lumen.laneStateDir, or $LUMEN_LANE_STATE(_DIR)); that
 *     watcher does run `git ls-remote` against origin every hour.
 *
 *   node scripts/prepare.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The steps, in order. */
export const STEPS = Object.freeze(["scripts/install-git-hooks.mjs", "scripts/git-setup.mjs"]);
/** A step that takes longer than this is stopped; the install goes on. */
export const STEP_TIMEOUT_MS = 60_000;

export const inCI = (env) => Boolean(env.CI) && env.CI !== "false" && env.CI !== "0";

/**
 * @returns {Array<{ step: string; status: "ok" | "failed" | "absent" | "skipped" }>}
 */
export function runPrepare({ root, env = process.env, log = (m) => console.log(m) } = {}) {
  if (inCI(env)) {
    log("prepare: skipped (CI)");
    return STEPS.map((step) => ({ step, status: "skipped" }));
  }
  const out = [];
  for (const step of STEPS) {
    if (!existsSync(join(root, step))) {
      out.push({ step, status: "absent" });
      continue;
    }
    const r = spawnSync(process.execPath, [step], { cwd: root, env, stdio: ["ignore", "inherit", "inherit"], timeout: STEP_TIMEOUT_MS });
    const ok = r.status === 0 && !r.error;
    if (!ok) log(`prepare: ${step} did not finish (${r.error ? r.error.message : `exit ${r.status ?? r.signal}`}); the install goes on`);
    out.push({ step, status: ok ? "ok" : "failed" });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    runPrepare({ root: resolve(dirname(fileURLToPath(import.meta.url)), "..") });
  } catch (e) {
    // why: `npm install` must never fail on clone set-up; CI does not depend on it
    console.log(`prepare: skipped (${e instanceof Error ? e.message : String(e)})`);
  }
  process.exit(0);
}
