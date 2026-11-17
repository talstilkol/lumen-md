#!/usr/bin/env node
/**
 * Plan W13.W18 — agreement between two annotators of the writing held-out
 * set: Cohen's kappa over the items both labelled.
 *
 *   node scripts/writing-agreement.mjs a.jsonl b.jsonl [--set writing-he] [--record]
 *
 * Each file: one JSON object per line, `{ "id": "...", "label": ... }`.
 * The files hold the items' ids and labels only and stay outside the repo
 * (a held-out item never enters git). `--record` writes
 * `agreement: { annotators: 2, items, kappa, ruleAuthors: false }` on the set
 * in eval/heldout/manifest.json — only the owner runs it, after checking
 * that neither annotator wrote the rules.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cohenKappa } from "./lib/evalCard.mjs";

/** @param {string} text */
export function readLabels(text) {
  const out = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (typeof j.id !== "string") throw new Error(`a line without an id: ${line.slice(0, 80)}`);
    out.set(j.id, JSON.stringify(j.label));
  }
  return out;
}

/** @param {Map<string,string>} a @param {Map<string,string>} b */
export function agreement(a, b) {
  const ids = [...a.keys()].filter((id) => b.has(id)).sort();
  if (!ids.length) throw new Error("no item labelled by both annotators");
  const kappa = cohenKappa(ids.map((id) => a.get(id)), ids.map((id) => b.get(id)));
  return { annotators: 2, items: ids.length, kappa: Math.round(kappa * 1000) / 1000, ruleAuthors: false };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  const files = args.filter((x) => !x.startsWith("--") && args[args.indexOf(x) - 1] !== "--set");
  if (files.length !== 2) {
    console.error("usage: node scripts/writing-agreement.mjs a.jsonl b.jsonl [--set writing-he] [--record]");
    process.exit(2);
  }
  const r = agreement(readLabels(readFileSync(files[0], "utf8")), readLabels(readFileSync(files[1], "utf8")));
  console.log(`kappa ${r.kappa} over ${r.items} items${r.kappa >= 0.6 ? "" : " — below 0.6: the labels need a guideline round"}`);
  if (args.includes("--record")) {
    const set = args[args.indexOf("--set") + 1];
    const path = resolve(new URL("..", import.meta.url).pathname, "eval/heldout/manifest.json");
    const m = JSON.parse(readFileSync(path, "utf8"));
    const s = m.sets.find((x) => x.id === set);
    if (!s) {
      console.error(`no set "${set}" in the manifest`);
      process.exit(1);
    }
    s.agreement = r;
    writeFileSync(path, JSON.stringify(m, null, 2) + "\n");
    console.log(`recorded on ${set}`);
  }
  process.exit(r.kappa >= 0.6 ? 0 : 1);
}
