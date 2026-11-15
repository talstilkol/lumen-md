#!/usr/bin/env node
/**
 * `npm run eval:ingest` (plan 7.9, W10.E12): take the real eval runs in
 * eval/results/ into the app.
 *
 *   npm run eval:agents -- --model qwen3:8b      # on a machine with Ollama (writes eval/results/agents-*.json)
 *   npm run eval:ingest                           # measured → models/registry.json, defaults → src/ai/defaults.ts
 *   npm run eval:ingest -- --check                # exit 1 when the committed files are not what the runs give
 *
 * A run is taken only when it is acceptable (scripts/lib/evalIngest.mjs
 * `acceptRun`: a real model listed in the registry, kind "model", a full
 * record); the others are listed with the reason. Agents no model passes
 * go to eval/failures.md, as work for the next wave.
 *
 * Options: --results <dir> --registry <file> --defaults <file> --acceptance <file> --report <file> --check
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultsModule, failuresReport, pickDefaults, selectRuns, withMeasured } from "../lib/evalIngest.mjs";
import { upsertEntries } from "../models/registry-edit.mjs";

const ROOT = resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "../..");

export function parseArgs(argv) {
  const opt = (n, d) => (argv.includes(n) ? resolve(argv[argv.indexOf(n) + 1]) : d);
  return {
    results: opt("--results", join(ROOT, "eval/results")),
    registry: opt("--registry", join(ROOT, "models/registry.json")),
    defaults: opt("--defaults", join(ROOT, "src/ai/defaults.ts")),
    acceptance: opt("--acceptance", join(ROOT, "eval/acceptance.json")),
    report: opt("--report", join(ROOT, "eval/failures.md")),
    check: argv.includes("--check"),
  };
}

export function ingest(o) {
  const registrySource = readFileSync(o.registry, "utf8");
  const registry = JSON.parse(registrySource);
  const acceptance = JSON.parse(readFileSync(o.acceptance, "utf8"));
  const known = new Set(registry.models.map((m) => m.id));
  const files = (existsSync(o.results) ? readdirSync(o.results) : [])
    .filter((f) => /^agents-.*\.json$/.test(f))
    .sort()
    .map((f) => {
      const path = relative(ROOT, join(o.results, f)).replace(/\\/g, "/");
      try {
        return { path, run: JSON.parse(readFileSync(join(o.results, f), "utf8")) };
      } catch (e) {
        return { path, run: null, error: String(e.message) };
      }
    });
  const { accepted, rejected } = selectRuns(files, known);
  const { defaults, failed } = pickDefaults(accepted, registry, acceptance);
  return {
    accepted,
    rejected,
    defaults,
    failed,
    // In the file's own format (scripts/models/registry-edit.mjs), so the conversion tooling's in-place
    // edits and this ingest agree on the text (W10.E62 #752 + plan 7.9 #727 on train 6).
    registryText: (() => {
      const next = withMeasured(registry, accepted);
      const text = upsertEntries(registrySource, next.models, undefined);
      return JSON.stringify(JSON.parse(text)) === JSON.stringify(next) ? text : JSON.stringify(next, null, 2) + "\n";
    })(),
    defaultsText: defaultsModule(defaults, accepted),
    reportText: failuresReport(failed, rejected, accepted),
  };
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const r = ingest(o);
  for (const x of r.rejected) console.log(`✗ not taken: ${x.path}: ${x.reasons.join("; ")}`);
  for (const a of r.accepted) console.log(`✓ taken: ${a.path} (${a.run.model}, ${a.run.date})`);
  for (const [agent, d] of Object.entries(r.defaults)) console.log(`  default ${agent}: ${d.model} (${d.score})`);
  for (const f of r.failed) console.log(`  no model passes ${f.agent}`);
  const outputs = [
    [o.registry, r.registryText],
    [o.defaults, r.defaultsText],
    [o.report, r.reportText],
  ];
  if (o.check) {
    const stale = outputs.filter(([p, text]) => !existsSync(p) || readFileSync(p, "utf8") !== text).map(([p]) => relative(ROOT, p));
    if (stale.length) {
      console.error(`✗ eval:ingest --check: ${stale.join(", ")} differ from what eval/results gives. Run npm run eval:ingest.`);
      process.exit(1);
    }
    console.log("✓ eval:ingest --check: the registry and the defaults match eval/results");
    return;
  }
  for (const [p, text] of outputs) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  console.log(`wrote ${relative(ROOT, o.registry)}, ${relative(ROOT, o.defaults)}, ${relative(ROOT, o.report)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
