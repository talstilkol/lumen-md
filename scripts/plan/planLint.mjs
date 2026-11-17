#!/usr/bin/env node
/**
 * Check a run plan before a night run (plan R12.14): every step's
 * interpreter is installed, every script and path it names exists, and its
 * working folder is there — so a night is not lost to a typo found at 03:00.
 *
 *   { "steps": [{ "name": "evals", "cmd": ["node", "scripts/eval/run.mjs", "--suite", "he"], "cwd": ".", "paths": ["data/x.json"] }] }
 *
 *   node scripts/plan/planLint.mjs <run-plan.json>   # exit 1 with the problems
 *
 * Clean reimplementation (design reference only: israelconnect's plan
 * lint, AGPL; no code taken).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_EXT = /\.(?:m?js|cjs|ts|mts|py|sh|R)$/;

export function defaultWhich(cmd) {
  try {
    execFileSync("sh", ["-c", `command -v "$1"`, "sh", cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Problems in `plan` (strings; [] = ready), relative to `root`. */
export function lintRunPlan(plan, { root = process.cwd(), which = defaultWhich, exists = existsSync } = {}) {
  const out = [];
  if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) return ["the plan has no steps"];
  const names = new Set();
  plan.steps.forEach((s, i) => {
    const name = s?.name ?? `#${i + 1}`;
    if (names.has(name)) out.push(`${name}: the name is used twice`);
    names.add(name);
    if (!Array.isArray(s?.cmd) || !s.cmd.length || s.cmd.some((x) => typeof x !== "string")) return out.push(`${name}: cmd must be a list of strings`);
    const cwd = resolve(root, s.cwd ?? ".");
    if (!exists(cwd)) out.push(`${name}: working folder ${s.cwd} does not exist`);
    const [interp, ...args] = s.cmd;
    if (!(interp.includes("/") ? exists(resolve(cwd, interp)) : which(interp))) out.push(`${name}: interpreter "${interp}" is not installed`);
    for (const a of args) if (SCRIPT_EXT.test(a) && !a.startsWith("-") && !exists(isAbsolute(a) ? a : join(cwd, a))) out.push(`${name}: script ${a} does not exist`);
    for (const p of s.paths ?? []) if (!exists(isAbsolute(p) ? p : join(cwd, p))) out.push(`${name}: path ${p} does not exist`);
  });
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    console.error("usage: planLint.mjs <run-plan.json>");
    process.exit(2);
  }
  const problems = lintRunPlan(JSON.parse(readFileSync(file, "utf8")));
  for (const p of problems) console.error(`plan-lint: ${p}`);
  process.exit(problems.length ? 1 : 0);
}
