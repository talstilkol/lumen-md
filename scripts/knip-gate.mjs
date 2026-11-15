#!/usr/bin/env node
/**
 * The knip gate (plan 0.16, W10.E24): unused exports, types and
 * dependencies, on top of scripts/check-unused-files.mjs (unused files,
 * which runs everywhere without knip). An issue that is not in
 * scripts/knip-baseline.json fails; the baseline only goes down.
 *
 *   node scripts/knip-gate.mjs                    # check (Buildkite `deadcode`, ci:local)
 *   node scripts/knip-gate.mjs --write-baseline   # drop the fixed issues from the baseline (never adds one)
 *   node scripts/knip-gate.mjs --init             # the first baseline, once (the owner, W10.E24)
 *
 * knip must be installed (a devDependency, `npx --no-install`): it is not
 * fetched at run time. Without it, or without a baseline, the gate fails
 * and says what to run; it never passes for want of a measurement.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BASELINE = "scripts/knip-baseline.json";
/** knip's issue kinds the gate counts (files are check-unused-files.mjs's). */
export const KINDS = ["dependencies", "devDependencies", "optionalPeerDependencies", "unlisted", "binaries", "unresolved", "exports", "nsExports", "types", "nsTypes", "enumMembers", "classMembers", "duplicates"];

/** knip's JSON reporter output → sorted "kind file name" keys. */
export function issueKeys(report) {
  const keys = new Set();
  for (const issue of report?.issues ?? []) {
    for (const kind of KINDS) {
      const v = issue[kind];
      const list = Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v).flat() : [];
      for (const item of list) {
        const name = Array.isArray(item) ? item.map((x) => x?.name ?? x).join("|") : (item?.name ?? String(item));
        keys.add(`${kind} ${issue.file} ${name}`);
      }
    }
  }
  return [...keys].sort();
}

/** New issues (fail) and fixed ones (the baseline can shrink). */
export function compare(current, baseline) {
  const base = new Set(baseline);
  const now = new Set(current);
  return { added: current.filter((k) => !base.has(k)), fixed: baseline.filter((k) => !now.has(k)) };
}

/** The next baseline: only ever a subset of the old one. */
export const shrink = (current, baseline) => baseline.filter((k) => current.includes(k));

function main() {
  const argv = process.argv.slice(2);
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const r = spawnSync(npx, ["--no-install", "knip", "--reporter", "json", "--no-exit-code"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout.trim().startsWith("{")) {
    console.error(`✗ knip gate: knip did not run (${(r.stderr || r.error?.message || "").trim().slice(0, 200) || `exit ${r.status}`}). Install it as a devDependency (W10.E24 owner command).`);
    process.exit(2);
  }
  const current = issueKeys(JSON.parse(r.stdout));
  const file = join(root, BASELINE);
  const write = (keys) => writeFileSync(file, `${JSON.stringify({ about: "knip issues that predate the gate (plan 0.16, W10.E24). Only goes down: scripts/knip-gate.mjs --write-baseline drops fixed ones and never adds.", issues: keys }, null, 2)}\n`);
  if (argv.includes("--init")) {
    if (existsSync(file)) {
      console.error(`✗ knip gate: ${BASELINE} exists; --init is for the first baseline only`);
      process.exit(1);
    }
    write(current);
    return console.log(`knip gate: ${BASELINE} written with ${current.length} issues`);
  }
  if (!existsSync(file)) {
    console.error(`✗ knip gate: no ${BASELINE} yet (run node scripts/knip-gate.mjs --init once)`);
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(file, "utf8")).issues ?? [];
  const { added, fixed } = compare(current, baseline);
  if (argv.includes("--write-baseline")) {
    write(shrink(current, baseline));
    return console.log(`knip gate: ${fixed.length} fixed issue(s) dropped from ${BASELINE}`);
  }
  for (const k of added) console.error(`  ✗ new: ${k}`);
  if (fixed.length) console.log(`knip gate: ${fixed.length} issue(s) in the baseline are fixed: run --write-baseline to lower it`);
  if (added.length) {
    console.error(`✗ knip gate: ${added.length} new unused export(s) / dependenc(ies) (plan 0.16)`);
    process.exit(1);
  }
  console.log(`✓ knip gate: no new issues (${current.length} known, baseline ${baseline.length})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
