#!/usr/bin/env node
/**
 * File leases for parallel lanes (plan R12.13). Before a session starts, the
 * coordinator gives its lane a set of globs in plan/LEASES.json; the
 * pre-commit hook (.githooks/pre-commit) refuses a commit that stages a file
 * outside the lane's lease and the shared globs, with the reason in Hebrew
 * (and English). Leases that overlap are reported by `lint`, so two lanes
 * are not given the same files.
 *
 *   node scripts/lanes/leases.mjs check --staged   # the hook (lane from $LUMEN_LANE)
 *   node scripts/lanes/leases.mjs check <path…>    # any paths
 *   node scripts/lanes/leases.mjs lint             # overlapping leases
 *
 * No lane set ($LUMEN_LANE empty) or no lease file: nothing is checked, so
 * a normal checkout is not affected.
 *
 * Clean reimplementation (design reference only: israelconnect's lane
 * leases, AGPL; no code taken).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { globToRegExp, matchesAny } from "./globs.mjs";

export const LEASES_PATH = "plan/LEASES.json";

export function loadLeases(root = process.cwd()) {
  const p = join(root, LEASES_PATH);
  if (!existsSync(p)) return null;
  const raw = JSON.parse(readFileSync(p, "utf8"));
  return { shared: raw.shared ?? [], lanes: raw.lanes ?? {}, merge: raw.merge ?? [] };
}

/** Paths outside `lane`'s lease and the shared globs. An unknown lane holds no lease: every path is outside. */
export function outsideLease(leases, lane, paths) {
  const own = leases.lanes[lane]?.globs ?? [];
  return paths.filter((p) => !matchesAny(p, own) && !matchesAny(p, leases.shared));
}

export function refusalMessage(lane, outside) {
  const list = outside.map((p) => `  - ${p}`).join("\n");
  return [
    `הקומיט נדחה: ${outside.length === 1 ? "הקובץ הזה לא בחכירה" : `${outside.length} הקבצים האלה לא בחכירה`} של המסלול ${lane} (plan/LEASES.json):`,
    list,
    "בקשו מהמתאם להרחיב את החכירה, או הוציאו את הקבצים מה-stage (git restore --staged <קובץ>).",
    "",
    `Commit refused: outside lane ${lane}'s lease in plan/LEASES.json. Ask the coordinator to extend the lease, or unstage the files.`,
  ].join("\n");
}

/** Pairs of lanes whose globs can claim the same path (checked on sample paths: each glob's literal stem). */
export function overlaps(leases, samplePaths = []) {
  const lanes = Object.entries(leases.lanes);
  const out = [];
  for (let i = 0; i < lanes.length; i++)
    for (let j = i + 1; j < lanes.length; j++) {
      const [a, la] = lanes[i];
      const [b, lb] = lanes[j];
      const probes = [...samplePaths, ...[...la.globs, ...lb.globs].map((g) => g.replace(/\*\*.*$/, "x/y").replace(/\*/g, "x").replace(/\/$/, "/x"))];
      const shared = probes.filter((p) => matchesAny(p, la.globs) && matchesAny(p, lb.globs));
      if (shared.length) out.push({ a, b, paths: [...new Set(shared)] });
    }
  return out;
}

function stagedPaths(cwd) {
  return execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMRD", "-z"], { cwd, encoding: "utf8" }).split("\0").filter(Boolean);
}

/** The hooks folder the lease check lives in, relative to the checkout. */
export const HOOKS_PATH = ".githooks";

/**
 * Turn the pre-commit lease check on for this checkout (and its worktrees):
 * core.hooksPath = .githooks. Idempotent; never replaces another hooksPath
 * the user set (returns "other" and leaves it). scripts/lane.sh runs this for
 * every lane it opens, so a lane's hook is on without a manual step.
 * @returns {"installed" | "already" | "other"}
 */
export function installHook(cwd = process.cwd()) {
  let current = "";
  try {
    current = execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd, encoding: "utf8" }).trim();
  } catch {
    /* why: unset (git exits 1) */
  }
  if (current === HOOKS_PATH) return "already";
  if (current) return "other";
  execFileSync("git", ["config", "core.hooksPath", HOOKS_PATH], { cwd });
  return "installed";
}

export function main(argv, env = process.env, cwd = process.cwd()) {
  const [cmd, ...rest] = argv;
  if (cmd === "install-hook") {
    const r = installHook(cwd);
    if (r === "other") console.error(`leases: core.hooksPath is already set to another folder; not changed. Add ".githooks/pre-commit" to it, or: git config core.hooksPath ${HOOKS_PATH}`);
    else console.log(r === "installed" ? `leases: pre-commit lease check on (core.hooksPath=${HOOKS_PATH})` : "leases: pre-commit lease check already on");
    return r === "other" ? 1 : 0;
  }
  const leases = loadLeases(cwd);
  if (cmd === "lint") {
    if (!leases) return 0;
    const o = overlaps(leases);
    for (const x of o) console.error(`leases: ${x.a} and ${x.b} both hold ${x.paths.join(", ")}`);
    return o.length ? 1 : 0;
  }
  if (cmd === "check") {
    const lane = env.LUMEN_LANE?.trim();
    if (!lane || !leases) return 0;
    const paths = rest[0] === "--staged" ? stagedPaths(cwd) : rest;
    const outside = outsideLease(leases, lane, paths);
    if (outside.length) {
      console.error(refusalMessage(lane, outside));
      return 1;
    }
    return 0;
  }
  console.error("usage: leases.mjs check --staged | check <path…> | lint | install-hook");
  return 2;
}

export { globToRegExp };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
