#!/usr/bin/env node
/**
 * The eval card for side-by-side translation (plan W12.H6): chrF on
 * FLORES-200 devtest, heb_Hebr ↔ eng_Latn, for the three local layers
 * (Chrome's Translator API, Opus-MT, M2M100). Numbers come from the Mac
 * (W12.M3): FLORES is gated (terms: do not re-host), so it is read from a
 * local copy and never committed; only scores are written.
 *
 *   node scripts/golden/evals/mt-flores-card.mjs --flores <dir with heb_Hebr.devtest and eng_Latn.devtest>
 *        [--models DIR] [--chrome <hyps.json from the browser run>] [--out reports/eval/mt-flores-card.json]
 *
 * Chrome's layer has no Node equivalent: run it in Chrome (138+, desktop)
 * and pass its outputs as { "he-en": [..], "en-he": [..] } with --chrome.
 * A layer that could not run is null in the card, with the reason.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chrF, PAIRS, scoreLayer } from "./mt.mjs";

export const CARD_LAYERS = ["chrome", "opus", "m2m100"];

/** FLORES-200's plain-text layout: one sentence per line, the same line in each language. */
export function floresItems(heText, enText) {
  const he = heText.split(/\r?\n/);
  const en = enText.split(/\r?\n/);
  const n = Math.min(he.length, en.length);
  const out = [];
  for (let i = 0; i < n; i++) if (he[i].trim() && en[i].trim()) out.push({ he: he[i].trim(), en: en[i].trim() });
  return out;
}

/** The card: every layer and direction, a number or null with why. */
export function evalCard(scores, { n, machine, date }) {
  return {
    kind: "eval-card",
    task: "W12.H6",
    dataset: "FLORES-200 devtest (heb_Hebr, eng_Latn)",
    metric: "chrF2 (sacreBLEU chrF: char 1–6, β 2, corpus)",
    n,
    dev: false,
    measuredOn: date,
    machine,
    layers: Object.fromEntries(CARD_LAYERS.map((l) => [l, Object.fromEntries(PAIRS.map((p) => [`${p.source}-${p.target}`, scores[l]?.[`${p.source}-${p.target}`] ?? { chrF: null, reason: "not run" }]))])),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
  const dir = opt("flores", null);
  if (!dir || !existsSync(join(dir, "heb_Hebr.devtest"))) {
    console.error("--flores <dir> with heb_Hebr.devtest and eng_Latn.devtest is required (gated dataset: download it locally, never commit it)");
    process.exit(2);
  }
  const items = floresItems(readFileSync(join(dir, "heb_Hebr.devtest"), "utf8"), readFileSync(join(dir, "eng_Latn.devtest"), "utf8"));
  const scores = {};
  const chromeHyps = opt("chrome", null) ? JSON.parse(readFileSync(opt("chrome"), "utf8")) : null;
  for (const layer of CARD_LAYERS) {
    scores[layer] = {};
    for (const pair of PAIRS) {
      const key = `${pair.source}-${pair.target}`;
      if (layer === "chrome") {
        const hyp = chromeHyps?.[key];
        scores[layer][key] = Array.isArray(hyp) && hyp.length === items.length ? { chrF: Number(chrF(hyp, items.map((it) => it[pair.target])).toFixed(2)) } : { chrF: null, reason: "run in Chrome 138+ (desktop) and pass --chrome" };
        continue;
      }
      const r = await scoreLayer(layer, pair, items, { models: opt("models", undefined) });
      scores[layer][key] = r.skip ? { chrF: null, reason: r.skip } : { chrF: Number(r.chrF.toFixed(2)) };
    }
  }
  const card = evalCard(scores, { n: items.length, machine: process.env.EVAL_MACHINE ?? null, date: new Date().toISOString().slice(0, 10) });
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const out = resolve(opt("out", join(root, "reports/eval/mt-flores-card.json")));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(card, null, 1) + "\n");
  console.log(`wrote ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
