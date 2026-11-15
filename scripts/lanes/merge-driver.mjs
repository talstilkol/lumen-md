#!/usr/bin/env node
/**
 * A git merge driver with one rule per kind of file (plan R12.13), so a
 * train merging several lanes stops only on real source conflicts:
 *
 * - `lane`: a lane's own status file goes to the lane's side (theirs, the
 *   branch being merged in);
 * - `train`: a generated file keeps the train's side (ours) and is rebuilt
 *   after the merge (scripts/lane-merge.sh regenerates i18n/keys and the
 *   help bundle; the `regen` note says what to run for the rest);
 * - `union`: a sorted list of lines becomes the sorted union of both sides,
 *   less the lines either side removed since the base.
 *
 * The rules are the `merge` list of plan/LEASES.json ({ glob, rule, regen? }),
 * and .gitattributes routes those files to the driver (`merge=lumen-lanes`).
 *
 *   node scripts/lanes/merge-driver.mjs --install   # this checkout's git config only
 *   git: merge.lumen-lanes.driver = node scripts/lanes/merge-driver.mjs %O %A %B %P
 *
 * A checkout without it installed falls back to git's normal text merge.
 *
 * Clean reimplementation (design reference only: israelconnect's lane
 * sync rules, AGPL; no code taken).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { matchesAny } from "./globs.mjs";
import { loadLeases } from "./leases.mjs";

export const DRIVER = "lumen-lanes";
export const DRIVER_COMMAND = "node scripts/lanes/merge-driver.mjs %O %A %B %P";

export function ruleFor(rules, path) {
  return rules.find((r) => matchesAny(path, [r.glob])) ?? null;
}

const lines = (s) => s.split(/\r?\n/).filter((l, i, a) => l !== "" || i < a.length - 1);

/** Sorted union of both sides, without the lines either side deleted since the base. */
export function unionSorted(base, ours, theirs) {
  const b = new Set(lines(base));
  const o = new Set(lines(ours));
  const t = new Set(lines(theirs));
  const removed = new Set([...b].filter((l) => !o.has(l) || !t.has(l)));
  const out = [...new Set([...o, ...t])].filter((l) => !removed.has(l) || (o.has(l) && t.has(l))).filter((l) => l !== "");
  const head = [];
  const body = [];
  // Comment lines at the top stay in place; the rest is sorted.
  for (const l of out) (body.length === 0 && /^\s*#/.test(l) ? head : body).push(l);
  body.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  return [...head, ...body].join("\n") + "\n";
}

/** Merge one file by its rule; returns the text, or null for "no rule: let git merge it". */
export function mergeByRule(rule, base, ours, theirs) {
  if (!rule) return null;
  if (rule.rule === "lane") return theirs;
  if (rule.rule === "train") return ours;
  if (rule.rule === "union") return unionSorted(base, ours, theirs);
  return null;
}

export function drive([base, ours, theirs, path], cwd = process.cwd()) {
  const rules = loadLeases(cwd)?.merge ?? [];
  const rule = ruleFor(rules, path ?? "");
  const read = (p) => readFileSync(p, "utf8");
  const merged = mergeByRule(rule, read(base), read(ours), read(theirs));
  if (merged === null) {
    // No rule for this path: git's own three-way merge, with conflict markers when it must.
    try {
      execFileSync("git", ["merge-file", "-L", "ours", "-L", "base", "-L", "theirs", ours, base, theirs], { cwd, stdio: "ignore" });
      return 0;
    } catch {
      return 1;
    }
  }
  writeFileSync(ours, merged);
  if (rule.rule === "train" && rule.regen) console.error(`merge-driver: ${path} is generated; kept the train's side. After the merge run: ${rule.regen}`);
  return 0;
}

export function install(cwd = process.cwd()) {
  const git = (...a) => execFileSync("git", a, { cwd, encoding: "utf8" });
  git("config", `merge.${DRIVER}.name`, "lane merge rules by file kind (plan/LEASES.json)");
  git("config", `merge.${DRIVER}.driver`, DRIVER_COMMAND);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--install") {
    install();
    console.error(`merge-driver: merge.${DRIVER}.driver set in this checkout's git config`);
    process.exit(0);
  }
  process.exit(drive(args));
}
