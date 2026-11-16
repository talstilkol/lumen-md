#!/usr/bin/env node
/**
 * Plan W8.11 — the merge drivers turn themselves on in every clone.
 *
 * .gitattributes routes the generated help shards to `merge=lumen-help`
 * (scripts/help-merge-driver.mjs) and the lane files to `merge=lumen-lanes`
 * (scripts/lanes/merge-driver.mjs). Git ignores a driver that the clone's own
 * config does not define, so until now each clone needed `--install` by hand,
 * and a clone that skipped it got conflict markers in generated files again.
 *
 * This runs from `npm install` (the `prepare` script), so a clone that installs
 * its dependencies has both drivers. It:
 *   - writes only `merge.lumen-help.*` and `merge.lumen-lanes.*`, in the
 *     repository's local config (never --global), and only when they differ;
 *   - does nothing outside a git work tree (a tarball, a Docker or Vercel build
 *     without .git), with LUMEN_NO_GIT_SETUP=1, or when the driver script is absent;
 *   - never fails the install: any problem is one line on stderr and exit 0.
 *
 *   node scripts/git-setup.mjs           set up this clone (what `npm install` runs)
 *   node scripts/git-setup.mjs --check   exit 1 when a driver is missing or differs
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The drivers .gitattributes names, and what each one runs. */
export const DRIVERS = Object.freeze([
  { name: "lumen-help", script: "scripts/help-merge-driver.mjs", title: "rebuild the in-app help bundle after the merge (scripts/help-bundle.mjs)" },
  { name: "lumen-lanes", script: "scripts/lanes/merge-driver.mjs", title: "lane merge rules by file kind (plan/LEASES.json)" },
]);
export const driverCommand = (d) => `node ${d.script} %O %A %B %P`;

/** What to set: [{ key, value }] for every driver config entry that is missing or different. */
export function plan(get, { root }) {
  const out = [];
  for (const d of DRIVERS) {
    if (!existsSync(join(root, d.script))) continue;
    for (const [key, value] of [
      [`merge.${d.name}.name`, d.title],
      [`merge.${d.name}.driver`, driverCommand(d)],
    ])
      if (get(key) !== value) out.push({ key, value });
  }
  return out;
}

/** @returns {{ code: number, set: string[], note?: string }} */
export function setup({ root, check = false, env = process.env } = {}) {
  if (env.LUMEN_NO_GIT_SETUP === "1") return { code: 0, set: [], note: "LUMEN_NO_GIT_SETUP=1" };
  const git = (...a) => spawnSync("git", a, { cwd: root, encoding: "utf8", env });
  const inside = git("rev-parse", "--is-inside-work-tree");
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return { code: 0, set: [], note: "not a git work tree" };
  const top = git("rev-parse", "--show-toplevel").stdout.trim();
  if (resolve(top) !== resolve(root)) return { code: 0, set: [], note: `the work tree is ${top}, not this package` };
  const get = (key) => {
    const r = git("config", "--local", "--get", key);
    return r.status === 0 ? r.stdout.replace(/\n$/, "") : null;
  };
  const todo = plan(get, { root });
  if (check) return { code: todo.length ? 1 : 0, set: todo.map((t) => t.key) };
  const set = [];
  for (const { key, value } of todo) {
    const r = git("config", "--local", key, value);
    if (r.status !== 0) return { code: 0, set, note: `git config ${key} failed: ${r.stderr.trim()}` };
    set.push(key);
  }
  return { code: 0, set };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const check = process.argv.includes("--check");
  let res;
  try {
    res = setup({ root, check });
  } catch (e) {
    res = { code: 0, set: [], note: String(e?.message ?? e) };
  }
  if (check && res.code) console.error(`git-setup: not set in this clone: ${res.set.join(", ")} (run: node scripts/git-setup.mjs)`);
  else if (res.set.length) console.error(`git-setup: merge drivers on in this clone (${res.set.join(", ")})`);
  else if (res.note && process.env.LUMEN_GIT_SETUP_VERBOSE) console.error(`git-setup: skipped — ${res.note}`);
  process.exit(res.code);
}
