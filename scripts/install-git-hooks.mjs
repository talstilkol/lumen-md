#!/usr/bin/env node
/**
 * The repo's git hooks, installed in every clone without anyone doing it
 * (W10.E56 / W8.9, W10.E57 / W8.10): `npm install` and `npm ci` run this as
 * the `prepare` script.
 *
 *   pre-push               lockfile drift (W8.9), then `ci:local --changed --skip e2e`;
 *                          it also notes the push for the lane-state hook
 *                          (the same hook as `npm run ci:local -- --install-hook`)
 *   reference-transaction  records a push in the lane's STATE.md and keeps the
 *                          lane's hourly tick running (W8.10); does nothing in a
 *                          clone without a lane state
 *                          (the same hook as `node scripts/lane-state.mjs install-hook`)
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

/**
 * What to do with each hook file, given what is there now.
 * @param {Record<string, string | null>} existing  hook name → its current text (null: none)
 * @returns {Array<{ name: string; action: "write" | "same" | "keep"; content: string; hint?: string }>}
 */
export function installPlan(existing) {
  const wanted = [
    { name: "pre-push", plan: hookPlan(existing["pre-push"] ?? null), hint: "npm run ci:local -- --install-hook --force" },
    { name: "reference-transaction", plan: txnHookPlan(existing["reference-transaction"] ?? null), hint: "node scripts/lane-state.mjs install-hook --state <STATE.md> --force" },
  ];
  return wanted.map(({ name, plan, hint }) => {
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
  for (const step of installPlan(existing)) {
    const file = join(hooks, step.name);
    if (step.action === "keep") console.log(`git hooks: ${file} is not ours; kept. To use ours instead: ${step.hint}`);
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
