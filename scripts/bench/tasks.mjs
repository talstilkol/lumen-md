/**
 * Per golden set (plan 7.8): what the page gets for each item and how its
 * outputs are scored. The scoring is the set's own metric (manifest.metric).
 */
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { ndcgAt } from "../golden/evals/retrieval.mjs";
import { chrF } from "../golden/evals/mt.mjs";
import { metrics as imageMetrics } from "../golden/evals/image-search.mjs";
import { errorRate, normalizeAsr, normalizeOcr, round } from "./metrics.mjs";

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac", ".m4a": "audio/mp4", ".webm": "audio/webm" };

/** An asset path (loadSet makes it absolute) → a data: URL the page can fetch. */
export function dataUrl(path) {
  const type = MIME[extname(path).toLowerCase()];
  if (!type) throw new Error(`no media type for ${extname(path)}`);
  if (!existsSync(path)) throw new Error(`asset not here: ${path.split("/").slice(-2).join("/")} (the set's image workflow has not fetched it)`);
  return `data:${type};base64,${readFileSync(path).toString("base64")}`;
}

/** chrF (0–100) per part and over all items; `ref` picks an item's reference. */
function chrfByPart(items, outputs, ref) {
  const out = {};
  const text = (v) => (typeof v === "string" ? v : "");
  for (const [part, list] of byPart(items)) out[`chrf.${part}`] = round(chrF(list.map((it) => text(outputs[it.id])), list.map(ref)), 2);
  out.chrf = round(chrF(items.map((it) => text(outputs[it.id])), items.map(ref)), 2);
  return out;
}

const byPart = (items) => {
  const m = new Map();
  for (const it of items) m.set(it.part, [...(m.get(it.part) ?? []), it]);
  return m;
};

export const TASKS = {
  retrieval: {
    payload: ({ items, corpus }) => ({
      shared: corpus,
      items: items.map((it) => ({ id: it.id, part: it.part, input: { query: it.query, skip: it.sameArticle ?? [] } })),
    }),
    /** nDCG@10 per part and over all items. */
    score(items, outputs) {
      const out = {};
      let all = 0;
      for (const [part, list] of byPart(items)) {
        let sum = 0;
        for (const it of list) sum += ndcgAt(Array.isArray(outputs[it.id]) ? outputs[it.id] : [], it.relevant, 10);
        out[`ndcg@10.${part}`] = round(sum / list.length);
        all += sum;
      }
      out["ndcg@10"] = round(all / (items.length || 1));
      return out;
    },
  },
  "ocr-he": {
    payload: ({ items }) => ({ items: items.map((it) => ({ id: it.id, part: it.part, input: { image: dataUrl(it.image) } })) }),
    /** CER per part and per condition (clean, degraded, nikud — nikud is report only, so `cer` leaves it out). */
    score(items, outputs) {
      const rates = new Map();
      const get = (k) => (rates.has(k) ? rates.get(k) : (rates.set(k, errorRate()), rates.get(k)));
      for (const it of items) {
        const ref = [...normalizeOcr(it.text)];
        const hyp = [...normalizeOcr(typeof outputs[it.id] === "string" ? outputs[it.id] : "")];
        get(`cer.${it.part}`).add(ref, hyp);
        get(`cer.${it.condition ?? "all"}`).add(ref, hyp);
        if (it.condition !== "nikud") get("cer").add(ref, hyp);
      }
      return Object.fromEntries([...rates].map(([k, r]) => [k, round(r.value)]));
    },
  },
  "asr-he": {
    payload: ({ items }) => ({ items: items.map((it) => ({ id: it.id, part: it.part, input: { audio: dataUrl(it.audio) } })) }),
    /** WER and CER per part and over all items, after the set's normalisation. */
    score(items, outputs) {
      const rates = new Map();
      const get = (k) => (rates.has(k) ? rates.get(k) : (rates.set(k, errorRate()), rates.get(k)));
      for (const it of items) {
        const ref = normalizeAsr(it.text);
        const hyp = normalizeAsr(typeof outputs[it.id] === "string" ? outputs[it.id] : "");
        const words = (s) => (s ? s.split(" ") : []);
        for (const k of ["", `.${it.part}`]) {
          get(`wer${k}`).add(words(ref), words(hyp));
          get(`cer${k}`).add([...ref.replace(/ /g, "")], [...hyp.replace(/ /g, "")]);
        }
      }
      return Object.fromEntries([...rates].map(([k, r]) => [k, round(r.value)]));
    },
  },
  // W10.E34: the translation engines (web-llm, Ollama, M2M100), Hebrew → English.
  "mt-he-en": {
    payload: ({ items }) => ({ items: items.filter((it) => it.he && it.en).map((it) => ({ id: it.id, part: it.part, input: { text: it.he } })) }),
    /** chrF2 against the English reference, per part and overall (the set's metric). */
    score: (items, outputs) => chrfByPart(items.filter((it) => it.he && it.en), outputs, (it) => it.en),
  },
  // W10.E35: captions; chrF against the first English reference (the owner's rating stays manual).
  caption: {
    payload: ({ items }) => ({ items: items.map((it) => ({ id: it.id, part: it.part, input: { image: dataUrl(it.image) } })) }),
    score: (items, outputs) => chrfByPart(items, outputs, (it) => (Array.isArray(it.refs_en) ? it.refs_en[0] : "") ?? ""),
  },
  // W10.E35: image search; each query's one relevant image among its split's images.
  "image-search": {
    payload: ({ items }) => {
      const shared = {};
      for (const [part, list] of byPart(items)) shared[part] = { images: list.map((it) => ({ id: it.id, image: dataUrl(it.image) })) };
      return { shared, items: items.map((it) => ({ id: it.id, part: it.part, input: { query: it.query, query_he: it.query_he ?? "" } })) };
    },
    /** recall@1 and nDCG@10 per query language: the rank of the item's own image in the engine's top 10. */
    score(items, outputs) {
      const out = {};
      for (const lang of ["en", "he"]) {
        const ranks = items.map((it) => {
          const list = outputs[it.id]?.[lang];
          const i = Array.isArray(list) ? list.indexOf(it.id) : -1;
          return i < 0 ? null : i + 1;
        });
        const m = imageMetrics(ranks);
        out[`recall@1.${lang}`] = round(m.recallAt1);
        out[`ndcg@10.${lang}`] = round(m.ndcg10);
      }
      return out;
    },
  },
};
