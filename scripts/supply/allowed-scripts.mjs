#!/usr/bin/env node
/**
 * Run the install scripts that are worth running, on purpose (plan W13.X6):
 * .npmrc sets ignore-scripts=true, so `npm ci` runs none. After it:
 *
 *   npm run supply:allowed-scripts            `npm rebuild` the packages in allow-scripts.json "allow"
 *                                             that are installed, then this repo's own `prepare`
 *   npm run supply:allowed-scripts -- --dry-run   say what would run
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** The installed packages (lockfile paths) that the allow list lets run their install script. */
export function allowedToRun(lock, allowScripts) {
  const allow = new Set((allowScripts.allow ?? []).map((e) => e.name));
  return Object.entries(lock.packages ?? {})
    .filter(([k, p]) => k && p?.hasInstallScript && allow.has(p.name ?? k.split("node_modules/").pop()))
    .map(([k]) => k);
}

function main() {
  const dry = process.argv.includes("--dry-run");
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const allowScripts = JSON.parse(readFileSync(join(ROOT, "scripts/supply/allow-scripts.json"), "utf8"));
  const run = allowedToRun(lock, allowScripts).filter((k) => existsSync(join(ROOT, k)));
  for (const k of run) {
    console.log(`${dry ? "would run" : "running"}: install script of ${k}`);
    if (!dry) {
      const r = spawnSync("npm", ["rebuild", "--ignore-scripts=false", k.split("node_modules/").pop()], { cwd: ROOT, stdio: "inherit" });
      if (r.status !== 0) process.exit(r.status ?? 1);
    }
  }
  console.log(`${dry ? "would run" : "running"}: this repo's prepare (git hooks; nothing in CI)`);
  if (!dry) spawnSync(process.execPath, [join(ROOT, "scripts/prepare.mjs")], { cwd: ROOT, stdio: "inherit" });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
