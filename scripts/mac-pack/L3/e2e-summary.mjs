#!/usr/bin/env node
/**
 * Mac pack L3 (wave g6): one e2e run, many checks. The full nightly e2e run
 * (scripts/nightly/plan.mjs --run --only build,e2e: every spec on chromium,
 * firefox and webkit in E2E_SHARDS shards, Playwright JSON per shard in
 * reports/nightly/e2e-<project>-<i>of<n>.json) is read once, and each plan
 * item asks only about its own specs:
 *
 *   node scripts/mac-pack/L3/e2e-summary.mjs --all [--max-shard-min 40]
 *       the whole run: every project there with all its shards, 0 failed,
 *       0 flaky, every shard step ≤ --max-shard-min (from the newest
 *       reports/nightly/full-*.json)
 *   node scripts/mac-pack/L3/e2e-summary.mjs --specs e2e/plugins.spec.ts,e2e/x.spec.ts [--projects chromium,webkit]
 *       those specs: ≥ 1 passed and 0 failed or flaky in each project
 *
 *   --dir D        where the shard files are (default reports/nightly)
 *   --out F        also write the verdict as JSON (default reports/mac-pack/L3-e2e[-<label>].json)
 *   --label L      names the default --out
 *   --skip-only P  projects where a spec may only skip (a Chromium-only spec in webkit)
 *
 * Exit 0 when the verdict is ok, 1 when not, 2 on bad arguments.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_BROWSERS, E2E_SHARDS } from "../../test-tiers.mjs";
import { specVerdict, summarizePlaywright } from "./lib.mjs";

const SHARD_FILE = /^e2e-([a-z0-9-]+)-(\d+)of(\d+)\.json$/;

export function readShards(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const m = SHARD_FILE.exec(f);
    if (!m) continue;
    let json = null;
    try {
      json = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch {
      /* a shard that never finished: counted as missing */
    }
    out.push({ project: m[1], index: Number(m[2]), total: Number(m[3]), file: f, json });
  }
  return out;
}

/** The newest full-*.json of the nightly plan: { "e2e-chromium-1of4": minutes, … }. */
export function stepMinutes(dir) {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^full-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : [];
  if (!files.length) return null;
  const j = JSON.parse(readFileSync(join(dir, files.at(-1)), "utf8"));
  return Object.fromEntries((j.results ?? []).map((r) => [r.id, r.minutes]));
}

/** The verdict of the whole run (--all). */
export function wholeRun(shards, minutes, { projects = E2E_BROWSERS, total = E2E_SHARDS, maxShardMin = 40 } = {}) {
  const problems = [];
  const summary = summarizePlaywright(shards.filter((s) => s.json).map((s) => ({ project: s.project, json: s.json })));
  for (const p of projects) {
    for (let i = 1; i <= total; i++) {
      const s = shards.find((x) => x.project === p && x.index === i && x.total === total);
      if (!s) problems.push(`${p} shard ${i}/${total}: no report`);
      else if (!s.json) problems.push(`${p} shard ${i}/${total}: report is not JSON`);
      const m = minutes?.[`e2e-${p}-${i}of${total}`];
      if (m === undefined) problems.push(`${p} shard ${i}/${total}: no time in full-*.json`);
      else if (!(m <= maxShardMin)) problems.push(`${p} shard ${i}/${total}: ${m} min > ${maxShardMin}`);
    }
    const c = summary.projects[p];
    if (!c) continue;
    if (c.failed || c.flaky) problems.push(`${p}: ${c.failed} failed, ${c.flaky} flaky`);
    if (!c.passed) problems.push(`${p}: 0 passed`);
  }
  return { ok: problems.length === 0, problems, summary };
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
  const list = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
  const all = argv.includes("--all");
  const specs = list(opt("specs"));
  if (!all && !specs.length) {
    console.error("usage: e2e-summary.mjs --all [--max-shard-min 40] | --specs a,b [--projects chromium,firefox,webkit]");
    process.exit(2);
  }
  const dir = resolve(opt("dir", "reports/nightly"));
  const projects = list(opt("projects")).length ? list(opt("projects")) : E2E_BROWSERS;
  const shards = readShards(dir);
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim() || null;
  let verdict;
  if (all) {
    const v = wholeRun(shards, stepMinutes(dir), { projects, maxShardMin: Number(opt("max-shard-min", 40)) });
    verdict = { mode: "all", ok: v.ok, problems: v.problems, projects: v.summary.projects };
  } else {
    const summary = summarizePlaywright(shards.filter((s) => s.json).map((s) => ({ project: s.project, json: s.json })));
    const v = specVerdict(summary, specs, projects, { allowSkipOnly: list(opt("skip-only")) });
    verdict = { mode: "specs", specs, ok: v.ok, problems: v.problems, perSpec: Object.fromEntries(specs.map((s) => [s, summary.specs[s] ?? null])) };
  }
  const label = opt("label");
  const out = resolve(opt("out", `reports/mac-pack/L3-e2e${label ? `-${label}` : ""}.json`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ schema: "lumen.mac-pack.e2e/1", lane: "L3", at: new Date().toISOString(), sha, dir, shards: shards.length, projects, ...verdict }, null, 2)}\n`);
  console.log(`[e2e-summary] ${verdict.ok ? "✓" : "✗"} ${all ? "whole run" : specs.join(" ")} on ${projects.join(", ")} (${shards.length} shard files) → ${out}`);
  for (const p of verdict.problems.slice(0, 40)) console.log(`  ${p}`);
  process.exit(verdict.ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
