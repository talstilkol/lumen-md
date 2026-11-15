/**
 * A TypeScript port of Shoshan's lemma step (plan W11.H12): bank retrieval,
 * then a bounded edit script when the retrieval is implausible. The neural
 * parts (the DictaBERT encoder with its POS and edit-script heads) run in
 * ONNX after W11.M3; this file is what happens to their outputs, so it can
 * be tested now with a stand-in encoder.
 *
 * Provenance: Shoshan's model card (read 2026-11-15) describes the bank
 * (bank/lemmas.csv + lemmas.npy, normalised undotted and quote-folded), the
 * per-token pooled encoding, and "a learned, form-relative edit script"
 * from the inventory in model/. The card does not give the inventory's
 * format, so the script form here — strip k letters at the start and m at the
 * end, then add a prefix and a suffix — is the standard form-relative lemma
 * rule (as in UDPipe), and `parseInventory` fails on any other shape. Owed:
 * read model/ at the pinned revision and adapt the parser if it differs.
 */
import type { Lemmatizer } from "./lemmatizer";
import { normalizeLemma } from "./lemmatizer";

export interface EditScript {
  /** Letters removed at the start. */
  dp: number;
  /** Letters removed at the end. */
  ds: number;
  ap: string;
  as: string;
}

export function parseInventory(json: unknown): EditScript[] {
  if (!Array.isArray(json)) throw new Error("edit-script inventory: expected an array");
  return json.map((e, i) => {
    const x = e as Partial<EditScript>;
    if (!Number.isInteger(x.dp) || !Number.isInteger(x.ds) || typeof x.ap !== "string" || typeof x.as !== "string" || x.dp! < 0 || x.ds! < 0) throw new Error(`edit-script inventory entry ${i}: expected {dp, ds, ap, as}`);
    return x as EditScript;
  });
}

/** Apply a script; null when it would remove more than the word has (an invalid prediction). */
export function applyEditScript(word: string, s: EditScript): string | null {
  const w = Array.from(word);
  if (s.dp + s.ds >= w.length) return null;
  return s.ap + w.slice(s.dp, w.length - s.ds).join("") + s.as;
}

/** The edit script that turns `word` into `lemma` (for building and checking inventories). */
export function scriptFor(word: string, lemma: string): EditScript {
  const w = Array.from(word);
  const l = Array.from(lemma);
  // The longest common substring is the stem kept.
  let best = { i: 0, j: 0, n: 0 };
  for (let i = 0; i < w.length; i++)
    for (let j = 0; j < l.length; j++) {
      let n = 0;
      while (i + n < w.length && j + n < l.length && w[i + n] === l[j + n]) n++;
      if (n > best.n) best = { i, j, n };
    }
  return { dp: best.i, ds: w.length - best.i - best.n, ap: l.slice(0, best.j).join(""), as: l.slice(best.j + best.n).join("") };
}

/**
 * "Plausible": the bank lemma is a bounded edit of the word — at most 2
 * letters off the start (prefixes ו ה ב ל מ ש כ and pairs), at most 3 off
 * the end, at most 2 letters added, and a kept stem of 2+ letters. Hebrew
 * final letters count as their plain forms.
 */
const FINAL: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
const plainFinals = (s: string) => s.replace(/[ךםןףץ]/g, (c) => FINAL[c]);
export function plausible(word: string, lemma: string): boolean {
  const s = scriptFor(plainFinals(normalizeLemma(word)), plainFinals(normalizeLemma(lemma)));
  const kept = Array.from(word).length - s.dp - s.ds;
  return kept >= 2 && s.dp <= 2 && s.ds <= 3 && Array.from(s.ap + s.as).length <= 2;
}

export interface ShoshanToken {
  /** The token's pooled vector (L2-normalised), same space as the bank's. */
  vector: Float32Array;
  /** The edit-script head's best index into the inventory. */
  script: number;
}

/** The encoder with its heads: one entry per word of the sentence. ONNX after W11.M3; a stand-in in tests. */
export interface ShoshanEncoder {
  encode(words: readonly string[], sentence: string): Promise<ShoshanToken[]>;
}

export interface ShoshanBank {
  lemmas: readonly string[];
  /** Row-major, lemmas.length × dim, L2-normalised rows. */
  vectors: Float32Array;
  dim: number;
}

function nearest(bank: ShoshanBank, v: Float32Array): number {
  let best = -1;
  let bestScore = -Infinity;
  for (let r = 0; r < bank.lemmas.length; r++) {
    let dot = 0;
    const o = r * bank.dim;
    for (let k = 0; k < bank.dim; k++) dot += bank.vectors[o + k] * v[k];
    if (dot > bestScore) {
      bestScore = dot;
      best = r;
    }
  }
  return best;
}

export interface ShoshanResult {
  lemma: string;
  source: "bank" | "edit" | "word";
}

export function shoshanLemma(word: string, tok: ShoshanToken, bank: ShoshanBank, inventory: readonly EditScript[]): ShoshanResult {
  const r = nearest(bank, tok.vector);
  if (r >= 0 && plausible(word, bank.lemmas[r])) return { lemma: bank.lemmas[r], source: "bank" };
  const s = inventory[tok.script];
  const edited = s ? applyEditScript(normalizeLemma(word), s) : null;
  return edited ? { lemma: edited, source: "edit" } : { lemma: normalizeLemma(word), source: "word" };
}

export function shoshanLemmatizer(encoder: ShoshanEncoder, bank: ShoshanBank, inventory: readonly EditScript[]): Lemmatizer {
  return {
    id: "shoshan",
    async lemmatize(words, sentence) {
      const toks = await encoder.encode(words, sentence);
      if (toks.length !== words.length) throw new Error(`shoshan encoder: ${toks.length} tokens for ${words.length} words`);
      return words.map((w, i) => shoshanLemma(w, toks[i], bank, inventory).lemma);
    },
  };
}
