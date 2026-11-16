#!/usr/bin/env node
/**
 * The repo's git hooks for a clone (W10.E56 / W8.9, W10.E57 / W8.10):
 * `npm install` and `npm ci` run this as the `prepare` script.
 *
 *   reference-transaction  records a push in the lane's STATE.md and keeps the
 *                          lane's hourly tick running (W8.10); does nothing in a
 *                          clone without a lane state
 *                          (the same hook as `node scripts/lane-state.mjs install-hook`)
 *   pre-push               OPT-IN (review 11, M2; #1054's design): lockfile drift (W8.9),
 *                          then `ci:local --changed --skip e2e`, on every push. Written
 *                          only when the clone asked for it: `git config lumen.ciLocalHook true`
 *                          or $LUMEN_CI_LOCAL_HOOK=1 (or by hand: `npm run ci:local -- --install-hook`).
 *
 * Nothing here starts a process that outlives it: the lane watcher is started
 * by the reference-transaction hook on a later ref change, and only in a clone
 * with a lane state set.
 *
 * Never fails the install: a clone whose hook is someone else's keeps it (one
 * line says how to add ours), and nothing is written in CI, outside a git
 * checkout, or with LUMEN_NO_HOOKS=1. A hook of ours from an older checkout
 * is rewritten with the current text.
 *
 *   node scripts/install-git-hooks.mjs [--dry]
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hookPlan } from "./lib/ciLocal.mjs";
import { txnHookPlan } from "./lib/lane-state.mjs";

/** Why nothing is installed here, or null. */
export function skipReason(env, gitHooksDir) {
  if (env.LUMEN_NO_HOOKS === "1") return "LUMEN_NO_HOOKS=1";
  if (env.CI && env.CI !== "false" && env.CI !== "0") return "CI";
  if (env.npm_config_global === "true") return "a global install";
  if (!gitHooksDir) return "not a git checkout";
  return null;
}

/** Did this clone opt in to the ci:local pre-push hook? (`git config lumen.ciLocalHook true`, or $LUMEN_CI_LOCAL_HOOK=1.) */
export function wantsPrePush(env, gitConfigValue) {
  if (env.LUMEN_CI_LOCAL_HOOK === "1") return true;
  return ["true", "1", "yes", "on"].includes(String(gitConfigValue ?? "").trim().toLowerCase());
}

export const PRE_PUSH_OPT_IN = "git config lumen.ciLocalHook true && npm run prepare (or: npm run ci:local -- --install-hook)";

/**
 * What to do with each hook file, given what is there now.
 * @param {Record<string, string | null>} existing  hook name → its current text (null: none)
 * @param {{ prePush?: boolean }} [opts]  prePush: the clone opted in to the ci:local pre-push hook
 * @returns {Array<{ name: string; action: "write" | "same" | "keep" | "opt-in"; content: string; hint?: string }>}
 */
export function installPlan(existing, { prePush = false } = {}) {
  const wanted = [
    { name: "pre-push", plan: hookPlan(existing["pre-push"] ?? null), hint: "npm run ci:local -- --install-hook --force", optIn: true },
    { name: "reference-transaction", plan: txnHookPlan(existing["reference-transaction"] ?? null), hint: "node scripts/lane-state.mjs install-hook --state <STATE.md> --force", optIn: false },
  ];
  return wanted.map(({ name, plan, hint, optIn }) => {
    // The pre-push hook runs the checks on every push: never without the clone asking (#1054).
    if (optIn && !prePush) return { name, action: "opt-in", content: plan.content, hint: PRE_PUSH_OPT_IN };
    if (plan.action !== "write") return { name, action: "keep", content: plan.content, hint };
    return { name, action: existing[name] === plan.content ? "same" : "write", content: plan.content };
  });
}

function main() {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const r = spawnSync("git", ["rev-parse", "--git-path", "hooks"], { cwd: root, encoding: "utf8" });
  const hooks = r.status === 0 && r.stdout.trim() ? resolve(root, r.stdout.trim()) : null;
  const why = skipReason(process.env, hooks);
  if (why) {
    console.log(`git hooks: not installed (${why})`);
    return;
  }
  const names = ["pre-push", "reference-transaction"];
  const existing = Object.fromEntries(names.map((n) => [n, existsSync(join(hooks, n)) ? readFileSync(join(hooks, n), "utf8") : null]));
  const dry = process.argv.includes("--dry");
  const cfg = spawnSync("git", ["config", "--get", "lumen.ciLocalHook"], { cwd: root, encoding: "utf8" });
  const prePush = wantsPrePush(process.env, cfg.status === 0 ? cfg.stdout : null);
  for (const step of installPlan(existing, { prePush })) {
    const file = join(hooks, step.name);
    if (step.action === "opt-in") console.log(`git hooks: ${step.name} not installed (opt-in: ${step.hint})`);
    else if (step.action === "keep") console.log(`git hooks: ${file} is not ours; kept. To use ours instead: ${step.hint}`);
    else if (step.action === "same") console.log(`git hooks: ${step.name} up to date`);
    else if (dry) console.log(`git hooks: would write ${file}`);
    else {
      mkdirSync(hooks, { recursive: true });
      writeFileSync(file, step.content);
      chmodSync(file, 0o755);
      console.log(`git hooks: ${step.name} written to ${file}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    // why: `npm install` must never fail on a hook; the hooks are a convenience on top of CI
    console.log(`git hooks: not installed (${e instanceof Error ? e.message : String(e)})`);
  }
}
