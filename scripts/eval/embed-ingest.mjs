#!/usr/bin/env node
/**
 * Take an embeddings competition run into the app (plan W7.13, W10.E53).
 *
 *   npm run eval:embed-ingest                      the newest eval/results/embed-compete-*.json
 *   npm run eval:embed-ingest -- --file <report>   that one
 *   npm run eval:embed-ingest -- --check           read and judge only; write nothing
 *
 * Writes each row's numbers into eval/models/embedding-candidates.json
 * (`measured`) and the app's model into src/ai/embeddingDefault.json (null
 * keeps the built-in one), by the rules in scripts/lib/embedIngest.mjs. A
 * run whose card is dev or synthetic (review Z6-M5) records its rows as dev
 * numbers and leaves src/ai/embeddingDefault.json untouched.
 * Exit 1 when the run is not taken.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptEmbedRun, embedDefault, withMeasured } from "../lib/embedIngest.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const argv = process.argv.slice(2);
const opt = (n) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : undefined);
// `--manifest` / `--default`: other files to write (tests); the repository's by default.
const MANIFEST = opt("manifest") ? resolve(opt("manifest")) : join(root, "eval/models/embedding-candidates.json");
const DEFAULT = opt("default") ? resolve(opt("default")) : join(root, "src/ai/embeddingDefault.json");

function newest() {
  const dir = join(root, "eval/results");
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).filter((n) => /^embed-compete-\d{4}-\d\d-\d\d.*\.json$/.test(n)).sort().pop();
  return f ? join(dir, f) : null;
}

const file = opt("file") ? resolve(opt("file")) : newest();
if (!file || !existsSync(file)) {
  console.error("embed-ingest: no run (eval/results/embed-compete-*.json); run `npm run eval:embed-compete` first");
  process.exit(1);
}
const report = JSON.parse(readFileSync(file, "utf8"));
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const a = acceptEmbedRun(report, manifest);
if (!a.ok) {
  console.error(`embed-ingest: ${basename(file)} is not taken:\n${a.reasons.map((r) => `  - ${r}`).join("\n")}`);
  process.exit(1);
}
const date = /(\d{4}-\d\d-\d\d)/.exec(basename(file))?.[1] ?? null;
const rel = file.startsWith(root) ? file.slice(root.length + 1) : basename(file);
const { entry, why, keep } = embedDefault(report, manifest, { file: rel, date });
console.log(`embed-ingest: ${rel}: ${keep ? "the app's model is not changed" : entry ? `the app's model becomes ${entry.id} at ${entry.dims} dimensions` : "the built-in model stays"} (${why})`);
if (argv.includes("--check")) process.exit(0);
writeFileSync(MANIFEST, JSON.stringify(withMeasured(manifest, report, { file: rel, date }), null, 2) + "\n");
// Z6-M5: a dev or synthetic card never writes the app's default, not even to null.
if (keep) {
  console.log(`wrote ${basename(MANIFEST)} (measured, as dev numbers); ${basename(DEFAULT)} left as it is`);
  process.exit(0);
}
writeFileSync(DEFAULT, JSON.stringify({ about: "Written by npm run eval:embed-ingest (plan W7.13): the measured winner of the embeddings competition, or null for the built-in multilingual-e5-small. Never by hand.", default: entry }, null, 2) + "\n");
console.log(`wrote ${basename(MANIFEST)} (measured) and ${basename(DEFAULT)}`);
