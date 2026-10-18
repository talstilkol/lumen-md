#!/usr/bin/env node
/**
 * Score every capability on the held-out test split, in CI (plan 7.1).
 *
 *   node scripts/golden/run-evals.mjs --dir DIR [--out scores.json]
 *
 * DIR is the CI-built test split. Each set's harness, when its feature task
 * has written one, is scripts/golden/evals/<set>.mjs exporting
 *   score({ items, manifest }) → { <metric>: number, … }
 * (items as loadSet returns them). Only those numbers are published — to
 * scores.json and the job summary; no item, input or output is printed. A
 * test part whose sha256 does not match the manifest fails the set.
 */
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadSet, validateAll } from "../lib/golden.mjs";
import { GOLDEN, ROOT } from "./common.mjs";

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const dir = opt("--dir");
const outFile = opt("--out") ?? "scores.json";
if (!dir) {
  console.error("usage: run-evals.mjs --dir <test split> [--out scores.json]");
  process.exit(2);
}

const sets = {};
let failed = false;
for (const { name, manifest } of validateAll(GOLDEN)) {
  const harness = join(ROOT, "scripts", "golden", "evals", `${name}.mjs`);
  try {
    const { items, unverified } = loadSet(GOLDEN, name, { split: "test", testDir: dir });
    const parts = Object.fromEntries(manifest.parts.map((p) => [p.id, items.filter((it) => it.part === p.id).length]));
    if (!items.length) {
      sets[name] = { status: "not-built", parts };
      continue;
    }
    if (!existsSync(harness)) {
      sets[name] = { status: "no-harness", parts, unverified, note: `scripts/golden/evals/${name}.mjs is written by the feature task (${manifest.capability})` };
      continue;
    }
    const mod = await import(pathToFileURL(harness).href);
    const raw = await mod.score({ items, manifest });
    const scores = Object.fromEntries(Object.entries(raw ?? {}).filter(([, v]) => typeof v === "number" && Number.isFinite(v)));
    sets[name] = { status: "scored", parts, unverified, scores };
  } catch (e) {
    failed = true;
    sets[name] = { status: "error", error: String(e.message).split("\n")[0].slice(0, 200) };
  }
}

const report = { generatedAt: new Date().toISOString(), split: "test", sets };
writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n");
const lines = ["## Golden sets — test split", "", "| Set | Status | Items per part | Scores |", "|---|---|---|---|"];
for (const [name, r] of Object.entries(sets)) lines.push(`| ${name} | ${r.status}${r.unverified?.length ? ` (sha256 not recorded: ${r.unverified.join(", ")})` : ""} | ${r.parts ? Object.entries(r.parts).map(([p, n]) => `${p} ${n}`).join(", ") : ""} | ${r.scores ? Object.entries(r.scores).map(([k, v]) => `${k} ${v}`).join(", ") : (r.error ?? "")} |`);
const md = lines.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);
process.exit(failed ? 1 : 0);
