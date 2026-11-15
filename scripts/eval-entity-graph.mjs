#!/usr/bin/env node
/**
 * Entity-graph measurement on public sets (plan W12.E9). Runs with tsx,
 * like eval-public.mjs (the library is TypeScript). Data lives in
 * eval/public/.data/ (git-ignored): NEMO and HeRE are used for local
 * measurement only and never committed (W12.O1).
 *
 *   npx tsx scripts/eval-entity-graph.mjs ner    --test <nemo token-single test> [--engine <m.mjs>] [--sha256 <hex>]
 *   npx tsx scripts/eval-entity-graph.mjs prefix --test-conllu <ud test.conllu> --test-morph <nemo morph test> \
 *                                               --train-conllu <ud train.conllu> --train-morph <nemo morph train> [--sha256 <hex>]
 *   npx tsx scripts/eval-entity-graph.mjs here   --test <HeRE gold test .jsonl|.json> --engine <m.mjs> [--sha256 <hex>]
 *
 * --engine: a module whose default export is an async factory returning
 *   { id, digest, extract(text) → [{start,end,type}] } for ner, or
 *   { executor, model, digest } (a local executor, agents/types Executor) for here.
 * Without --engine, ner runs the rules alone. The card is `public` only
 * when --sha256 matches the test file and a real engine with a digest ran;
 * otherwise `dev`. Results: eval/results/entity-graph/<task>@<engine>.json.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseConll } from "../src/eval/public/adapters/ner.ts";
import { bootstrapCi, evalCard, HERE_REFERENCE, mentionNames, parseHere, parseSegmented, pipelineEngine, scoreBinary, scoreHere, scorePipelineNer, scorePrefixes, verifyTriple } from "../src/eval/public/adapters/entityGraph.ts";
import { ruleHits } from "../src/entities/extract/rules.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const task = argv[0];
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const die = (m) => {
  console.error(`eval-entity-graph: ${m}`);
  process.exit(2);
};
const read = (p) => readFileSync(resolve(p), "utf8");
const pinned = (p) => !!opt("sha256") && createHash("sha256").update(readFileSync(resolve(p))).digest("hex") === opt("sha256");
const engineOf = async () => (opt("engine") ? (await import(pathToFileURL(resolve(opt("engine"))).href)).default() : null);

function write(name, report) {
  const dir = join(root, "eval/results/entity-graph");
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${name}.json`);
  writeFileSync(f, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${f}: ${report.card.tag} ${JSON.stringify(Object.fromEntries(Object.entries(report.card.metrics).map(([k, v]) => [k, v.value])))}`);
}

if (task === "ner") {
  const test = opt("test") ?? die("--test <file>");
  const eng = await engineOf();
  const sentences = parseConll(read(test), "nemo");
  const engine = pipelineEngine(eng?.id ?? "rules", async (text) => [...ruleHits(text).map((h) => ({ start: h.start, end: h.end, type: h.type })), ...(eng ? await eng.extract(text) : [])]);
  const score = await scorePipelineNer(sentences, engine);
  const card = evalCard({
    public: pinned(test) && !!eng?.digest,
    model: { name: eng?.id ?? "lumen-rules@1", digest: eng?.digest ?? "rules" },
    dataset: { name: "NEMO-Corpus test (token-single)", version: opt("version") ?? "unpinned", license: "not stated (W12.O1 / W11.O4): local measurement only", source: "https://github.com/OnlpLab/NEMO-Corpus" },
    n: score.n,
    metrics: { f1: { value: score.metrics.f1, ci95: [score.metrics.f1, score.metrics.f1] } },
  });
  write(`ner@${eng?.id ?? "rules"}`, { task: "entity-ner", ...score, card, note: "ci95 owed: entity F1 is a corpus-level statistic; per-sentence bootstrap comes with the real run (W12.M1)" });
} else if (task === "prefix") {
  const need = (k) => opt(k) ?? die(`--${k} <file>`);
  const test = parseSegmented(read(need("test-conllu")), read(need("test-morph")));
  const train = parseSegmented(read(need("train-conllu")), read(need("train-morph")));
  const s = scorePrefixes(test, mentionNames(train));
  const card = evalCard({
    public: pinned(need("test-conllu")),
    model: { name: "lumen-resolve@1 (rules)", digest: "rules" },
    dataset: { name: "NEMO/UD Hebrew gold morpheme segmentation, test", version: opt("version") ?? "unpinned", license: "not stated (W12.O1 / W11.O4): local measurement only", source: "https://github.com/OnlpLab/NEMO-Corpus" },
    n: s.n,
    metrics: { accuracy: { value: s.accuracy, ci95: bootstrapCi(s.items, (xs) => xs.filter(Boolean).length / Math.max(1, xs.length)) } },
  });
  write("prefix@rules", { task: "entity-prefix", n: s.n, accuracy: s.accuracy, under: s.under, over: s.over, target: 0.95, card });
} else if (task === "here") {
  const test = opt("test") ?? die("--test <file>");
  const eng = (await engineOf()) ?? die("--engine <m.mjs> (a local executor): relations need a model");
  const rows = parseHere(read(test));
  const s = await scoreHere(rows, (r) => verifyTriple(eng.executor, r, eng.model));
  const card = evalCard({
    public: pinned(test) && !!eng.digest,
    model: { name: `${eng.executor.id}:${eng.model}`, digest: eng.digest ?? "" },
    dataset: { name: "HeRE gold test", version: opt("version") ?? "unpinned", license: "CC-BY-SA-4.0 (dataset card); local measurement only until W12.O1", source: "https://huggingface.co/datasets/ronke21/HeRE" },
    n: s.n,
    metrics: { f1: { value: s.f1, ci95: bootstrapCi(s.pairs, (xs) => scoreBinary(xs).f1) } },
  });
  write(`here@${eng.executor.id}`, { task: "entity-relations", ...s, pairs: undefined, reference: HERE_REFERENCE, card });
} else die("task: ner | prefix | here");
