#!/usr/bin/env node
/**
 * W13.W10 (Mac step): Harper on the 150-sentence English set
 * (eval/fixtures/writing/harperGrammar/en.jsonl, written by
 * src/__tests__/harperGrammar.test.ts with LUMEN_WRITE_CARDS=1).
 *
 *   node scripts/writing/harper-eval.mjs [--lt http://localhost:8010]
 *
 * Measures recall on the 150 errors, false alarms on the 50 clean
 * sentences and latency per paragraph (p50/p95), and writes the card
 * eval/cards/writing/harperGrammar.json (tag dev: the set is synthetic).
 * With --lt, a LanguageTool server on this machine is measured on the same
 * set for the comparison; any other address is refused (no network).
 * Exit 2 when harper.js is not installed; 1 when recall < 0.7 or p95 > 50 ms.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapCi, validateCard } from "../lib/evalCard.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let harper;
try {
  harper = await import("harper.js");
} catch {
  console.error("harper-eval: harper.js is not installed (npm i -D harper.js on the Mac) — not run");
  process.exit(2);
}
const items = readFileSync(join(ROOT, "eval/fixtures/writing/harperGrammar/en.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const linter = new harper.LocalLinter({ binary: harper.binary });
await linter.setup();
/** Harper's spans count code points; offsets here are UTF-16. */
const cps = (t) => {
  const o = [];
  let i = 0;
  for (const ch of t) {
    o.push(i);
    i += ch.length;
  }
  o.push(i);
  return o;
};
const hits = (spans, e) => spans.some((s) => s.from < e.to && e.from < s.to);
const recall = [];
const clean = [];
const ms = [];
for (const it of items) {
  const t0 = performance.now();
  const lints = await linter.lint(it.text, { language: "plaintext" });
  ms.push(performance.now() - t0);
  const o = cps(it.text);
  const spans = lints.map((l) => ({ from: o[l.span().start], to: o[l.span().end] }));
  if (it.error) recall.push(hits(spans, it.error) ? 1 : 0);
  else clean.push(spans.length ? 0 : 1);
}
ms.sort((a, b) => a - b);
const p = (q) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))];
const strip = (b) => {
  delete b.resamples;
  return b;
};
let lt = null;
const ai = process.argv.indexOf("--lt");
if (ai > 0) {
  const url = new URL(process.argv[ai + 1]);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    console.error("harper-eval: --lt must be a LanguageTool on this machine");
    process.exit(1);
  }
  const r = [];
  for (const it of items.filter((x) => x.error)) {
    // privacy-ledger: a LanguageTool server on this machine only (checked above)
    const res = await fetch(new URL("/v2/check", url), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ text: it.text, language: "en-US" }) });
    const j = await res.json();
    r.push(hits(j.matches.map((m) => ({ from: m.offset, to: m.offset + m.length })), it.error) ? 1 : 0);
  }
  lt = strip(bootstrapCi(r, { seed: 10 }));
}
const card = {
  schema: 1,
  tag: "dev",
  agent: "harperGrammar",
  model: { name: `harper.js@${harper.version ?? "?"}`, digest: "see public/vendor/harper/MANIFEST.json" },
  seed: 10,
  temperature: 0,
  dataset: { name: "eval/fixtures/writing/harperGrammar/en.jsonl", version: "1", license: "MIT (written for lumen-md; synthetic)", origin: "synthetic" },
  n: recall.length,
  metrics: { recall: strip(bootstrapCi(recall, { seed: 10 })), cleanNoAlarm: strip(bootstrapCi(clean, { seed: 10 })), ...(lt ? { languageToolRecall: lt } : {}) },
  latencyMs: { p50: Math.round(p(0.5) * 100) / 100, p95: Math.round(p(0.95) * 100) / 100 },
};
const problems = validateCard(card);
if (problems.length) throw new Error(problems.join("; "));
mkdirSync(join(ROOT, "eval/cards/writing"), { recursive: true });
writeFileSync(join(ROOT, "eval/cards/writing/harperGrammar.json"), `${JSON.stringify({ card }, null, 1)}\n`);
console.log(`harper-eval: recall ${card.metrics.recall.value} · clean ${card.metrics.cleanNoAlarm.value} · p50 ${card.latencyMs.p50} ms · p95 ${card.latencyMs.p95} ms${lt ? ` · LanguageTool recall ${lt.value}` : ""}`);
process.exit(card.metrics.recall.value >= 0.7 && card.latencyMs.p95 <= 50 ? 0 : 1);
