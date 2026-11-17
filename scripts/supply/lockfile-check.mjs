#!/usr/bin/env node
/**
 * Lockfile hygiene (plan W13.X6), the lockfile-lint rules without the
 * dependency: in every package-lock.json of the repo,
 *   - every package is resolved from https://registry.npmjs.org/ (no other
 *     host, no http, no git or file URLs, no tarball links);
 *   - every package has an sha512 `integrity`;
 *   - every package with an install script is listed in
 *     scripts/supply/allow-scripts.json (to run, or reviewed and skipped).
 * Bundled packages (`inBundle`) are covered by their parent's integrity, and
 * workspace links have no tarball; both are skipped. An empty lockfile, or
 * none at all, is a failure, never a pass.
 *
 *   node scripts/supply/lockfile-check.mjs                every lockfile of the repo
 *   node scripts/supply/lockfile-check.mjs <lock.json>…   these
 * Exit 0: clean; 1: problems, one line each; 2: nothing to check.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REGISTRY = "https://registry.npmjs.org/";
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** The problems of one parsed lockfile (v2/v3 `packages`; v1 `dependencies` as well). */
export function checkLockfile(lock, { allowScripts = { allow: [], skip: [] }, file = "package-lock.json" } = {}) {
  const problems = [];
  const listed = new Set([...(allowScripts.allow ?? []), ...(allowScripts.skip ?? [])].map((e) => e.name));
  const entries = lock?.packages
    ? Object.entries(lock.packages).filter(([k]) => k !== "")
    : Object.entries(lock?.dependencies ?? {}).map(([k, v]) => [`node_modules/${k}`, v]);
  let checked = 0;
  for (const [key, p] of entries) {
    if (!p || p.link || p.inBundle || p.bundled) continue;
    checked++;
    const name = p.name ?? key.split("node_modules/").pop();
    if (typeof p.resolved !== "string") problems.push(`${file}: ${name}: no "resolved" URL`);
    else if (!p.resolved.startsWith(REGISTRY)) {
      let host = "?";
      try {
        const u = new URL(p.resolved);
        host = `${u.protocol}//${u.host}`;
      } catch {
        host = p.resolved.slice(0, 40);
      }
      problems.push(`${file}: ${name}: resolved from ${host}, not ${REGISTRY}`);
    }
    if (typeof p.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(p.integrity.split(/\s+/)[0])) problems.push(`${file}: ${name}: integrity is ${p.integrity ? p.integrity.split("-")[0] : "missing"}, not sha512`);
    if (p.hasInstallScript && !listed.has(name)) problems.push(`${file}: ${name} has an install script and is not in scripts/supply/allow-scripts.json (add it to "allow" or, reviewed, to "skip")`);
  }
  // A lockfile with no packages is fine only for a project with no dependencies.
  const root = lock?.packages?.[""] ?? lock ?? {};
  const declares = ["dependencies", "devDependencies", "optionalDependencies"].some((k) => Object.keys(root[k] ?? {}).length);
  if (checked === 0 && (declares || !lock?.packages)) problems.push(`${file}: no packages to check`);
  return { problems, checked };
}

export function findLockfiles(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".git" || name.startsWith("dist")) continue;
      const p = join(dir, name);
      const s = statSync(p, { throwIfNoEntry: false });
      if (s?.isDirectory()) walk(p);
      else if (name === "package-lock.json") out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

export function run(files, { root = ROOT } = {}) {
  const allowScripts = JSON.parse(readFileSync(join(root, "scripts/supply/allow-scripts.json"), "utf8"));
  const problems = [];
  let checked = 0;
  for (const f of files) {
    const r = checkLockfile(JSON.parse(readFileSync(f, "utf8")), { allowScripts, file: relative(root, f) || f });
    problems.push(...r.problems);
    checked += r.checked;
  }
  return { problems, checked, files: files.length };
}

function main() {
  const args = process.argv.slice(2);
  const files = args.length ? args.map((a) => resolve(a)) : findLockfiles();
  if (!files.length || files.some((f) => !existsSync(f))) {
    console.error(`lockfile-check: nothing to check (${files.length ? files.filter((f) => !existsSync(f)).join(", ") + " missing" : "no package-lock.json"})`);
    process.exit(2);
  }
  const r = run(files);
  if (r.checked === 0) r.problems.push("no packages in any lockfile: nothing was checked");
  for (const p of r.problems) console.error(`lockfile-check: ${p}`);
  if (r.problems.length) process.exit(1);
  console.log(`lockfile-check: ${r.checked} packages in ${r.files} lockfiles, every one from ${REGISTRY} over https with sha512 integrity; install scripts all reviewed`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
