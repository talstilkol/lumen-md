/**
 * W13.W9 — a readability index for Hebrew and English.
 *
 * There is no accepted Hebrew readability formula: Elek-BenMoshe & Rafaeli
 * (UAIS 2025) used word length in letters as the proxy for syllables and
 * concluded that "a unique Hebrew readability formula is required". This is
 * one, built on four features of the text:
 *
 *   wordLen   mean word length in letters (niqqud and punctuation out) —
 *             the 2025 proxy for syllables;
 *   sentLen   mean sentence length in words;
 *   rare      share of words outside the 20,000 most frequent (hebrewFreq,
 *             FrequencyWords he_50k, CC BY-SA 4.0), prefixes peeled;
 *   ambiguous share of unpointed short words (≤ 4 letters, no ו or י) —
 *             the words a reader must disambiguate without niqqud
 *             ("ספר", "דבר", "מלך"); a pointed word is never ambiguous.
 *
 * A linear model on the standardised features is fitted (ridge, closed form)
 * to a graded corpus (./corpusHe.eval.ts) and the coefficients are committed
 * (./hebrewModel.json); the test refits and refuses a drift. The output is a
 * score on the corpus's 1–5 scale, a band (easy / medium / hard), an
 * approximate school stage, and what raises it: each feature's share of the
 * score above the corpus average, in words.
 *
 * English gets Flesch–Kincaid grade level (Kincaid et al. 1975):
 * 0.39·(words/sentences) + 11.8·(syllables/words) − 15.59, with a rule-based
 * syllable count. Used by W13.R2 (focus overlay) and W13.W14 (goals).
 */
import { frequencyKnown, type FrequencyList } from "../../../ai/hebrewFreqKnown";
import { STOP, plain, sentences } from "../textTools";
import model from "./hebrewModel.json";
import { syllables } from "./syllables";

export const FEATURES = ["wordLen", "sentLen", "rare", "ambiguous"] as const;
export type Feature = (typeof FEATURES)[number];
export type Features = Record<Feature, number>;
/** Words outside the TOP_N most frequent are rare. */
export const TOP_N = 20_000;

export interface HebrewModel {
  version: number;
  features: Feature[];
  mean: number[];
  sd: number[];
  intercept: number;
  weights: number[];
  /** The features used when no frequency list is loaded (rare left out). */
  noFreq: { features: Feature[]; mean: number[]; sd: number[]; intercept: number; weights: number[] };
  corpus: string;
}

const NIQQUD = /[ְ-ׇּׁׂ]/;
const HEB_WORD = /[א-ת][א-ת֑-ׇ'"׳״]*/g;

/** A frequency list cut to its TOP_N most frequent words. */
export function topList(list: FrequencyList, n = TOP_N): FrequencyList {
  const top = [...list.counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const counts = new Map(top);
  return { counts, words: new Set(counts.keys()) };
}

/** The four features of a Hebrew text (rare is NaN without a frequency list). */
export function hebrewFeatures(text: string, freq?: FrequencyList): Features & { words: number; sentences: number } {
  const prose = text.replace(/```[\s\S]*?```/g, " ").replace(/^#{1,6}\s.*$/gm, " ");
  const ss = sentences(prose).filter((s) => /[\u05D0-\u05EA]/.test(s.text));
  const ws = [...prose.matchAll(HEB_WORD)].map((m) => m[0].replace(/['"׳״]+$/, ""));
  const n = ws.length;
  if (!n) return { wordLen: 0, sentLen: 0, rare: freq ? 0 : NaN, ambiguous: 0, words: 0, sentences: 0 };
  const letters = ws.map((w) => (w.match(/[א-ת]/g) ?? []).length);
  const wordLen = letters.reduce((a, b) => a + b, 0) / n;
  const sentLen = n / Math.max(1, ss.length);
  let rare = NaN;
  if (freq) rare = ws.filter((w) => !frequencyKnown(freq, w.replace(/[֑-ׇ'"׳״]/g, ""))).length / n;
  const ambiguous =
    ws.filter((w) => {
      if (NIQQUD.test(w)) return false;
      const p = plain(w);
      return p.length >= 2 && p.length <= 4 && !/[וי]/.test(p) && !STOP.has(p);
    }).length / n;
  return { wordLen, sentLen, rare, ambiguous, words: n, sentences: ss.length };
}

/* ─── Fitting ────────────────────────────────────────────────────────── */

/** Solve A x = b (Gaussian elimination with partial pivoting). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || !M[c][c]) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Ridge regression of y on the standardised columns of X (closed form). */
export function fitLinear(X: number[][], y: number[], lambda = 0.5): { mean: number[]; sd: number[]; intercept: number; weights: number[] } {
  const k = X[0].length;
  const mean = Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[j], 0) / X.length);
  const sd = Array.from({ length: k }, (_, j) => Math.sqrt(X.reduce((s, r) => s + (r[j] - mean[j]) ** 2, 0) / X.length) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - mean[j]) / sd[j]));
  const ym = y.reduce((a, b) => a + b, 0) / y.length;
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => Z.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? lambda : 0)));
  const b = Array.from({ length: k }, (_, i) => Z.reduce((s, r, n) => s + r[i] * (y[n] - ym), 0));
  const w = solve(A, b);
  return { mean: mean.map(round), sd: sd.map(round), intercept: round(ym), weights: w.map(round) };
}

/** Fit the Hebrew model on graded texts. */
export function fitHebrewModel(texts: ReadonlyArray<{ text: string; level: number }>, freq: FrequencyList, corpus: string): HebrewModel {
  const feats = texts.map((t) => hebrewFeatures(t.text, freq));
  const y = texts.map((t) => t.level);
  const full = fitLinear(feats.map((f) => FEATURES.map((k) => f[k])), y);
  const nf: Feature[] = ["wordLen", "sentLen", "ambiguous"];
  const noFreq = fitLinear(feats.map((f) => nf.map((k) => f[k])), y);
  return { version: 1, features: [...FEATURES], ...full, noFreq: { features: nf, ...noFreq }, corpus };
}

/* ─── Scoring ────────────────────────────────────────────────────────── */

export type Band = "easy" | "medium" | "hard";

export interface Reason {
  feature: Feature;
  value: number;
  /** Points this feature adds to the score above the corpus average (negative: lowers it). */
  points: number;
}

export interface Readability {
  lang: "he" | "en";
  /** Hebrew: 1–5 (the corpus scale). English: the Flesch–Kincaid grade. */
  score: number;
  band: Band;
  /** Approximate school stage, for the UI ("grade 3–5", "academic"). */
  stage: "grade1-2" | "grade3-5" | "grade6-9" | "grade10-12" | "academic";
  reasons: Reason[];
  words: number;
  sentences: number;
  /** Hebrew features, or the English counts. */
  features: Record<string, number>;
}

const HE_MODEL = model as unknown as HebrewModel;

export function hebrewReadability(text: string, freq?: FrequencyList, m: HebrewModel = HE_MODEL): Readability {
  const f = hebrewFeatures(text, freq);
  const use = freq ? m : { ...m.noFreq };
  let score = use.intercept;
  const reasons: Reason[] = [];
  use.features.forEach((k, j) => {
    const z = (f[k] - use.mean[j]) / use.sd[j];
    const points = use.weights[j] * z;
    score += points;
    reasons.push({ feature: k, value: round(f[k]), points: round(points) });
  });
  score = Math.max(1, Math.min(5, score));
  reasons.sort((a, b) => b.points - a.points);
  const stage = score < 1.5 ? "grade1-2" : score < 2.5 ? "grade3-5" : score < 3.5 ? "grade6-9" : score < 4.5 ? "grade10-12" : "academic";
  return { lang: "he", score: round(score), band: score < 2.5 ? "easy" : score < 3.75 ? "medium" : "hard", stage, reasons, words: f.words, sentences: f.sentences, features: { wordLen: f.wordLen, sentLen: f.sentLen, rare: f.rare, ambiguous: f.ambiguous } };
}

/* ─── English: Flesch–Kincaid ────────────────────────────────────────── */

/** Syllables of an English word (./syllables.ts). */
export { syllables };

const EN_WORD = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;

export function fleschKincaid(text: string): { grade: number; words: number; sentences: number; syllables: number } {
  const prose = text.replace(/```[\s\S]*?```/g, " ").replace(/^#{1,6}\s.*$/gm, " ");
  const ws = prose.match(EN_WORD) ?? [];
  const ss = sentences(prose).filter((s) => /[A-Za-z]/.test(s.text));
  const syl = ws.reduce((a, w) => a + syllables(w), 0);
  if (!ws.length) return { grade: 0, words: 0, sentences: 0, syllables: 0 };
  const grade = 0.39 * (ws.length / Math.max(1, ss.length)) + 11.8 * (syl / ws.length) - 15.59;
  return { grade: Math.round(grade * 100) / 100, words: ws.length, sentences: ss.length, syllables: syl };
}

export function englishReadability(text: string): Readability {
  const fk = fleschKincaid(text);
  const g = fk.grade;
  const wps = fk.words / Math.max(1, fk.sentences);
  const spw = fk.syllables / Math.max(1, fk.words);
  // Points above a plain text (15 words a sentence, 1.4 syllables a word): what raises the grade.
  const reasons: Reason[] = [
    { feature: "sentLen", value: round(wps), points: round(0.39 * (wps - 15)) },
    { feature: "wordLen", value: round(spw), points: round(11.8 * (spw - 1.4)) },
  ].sort((a, b) => b.points - a.points) as Reason[];
  const stage = g < 3 ? "grade1-2" : g < 6 ? "grade3-5" : g < 10 ? "grade6-9" : g < 13 ? "grade10-12" : "academic";
  return { lang: "en", score: g, band: g < 6 ? "easy" : g < 11 ? "medium" : "hard", stage, reasons, words: fk.words, sentences: fk.sentences, features: { wordsPerSentence: wps, syllablesPerWord: spw } };
}

/** The readability of a text in its main language (Hebrew when most letters are Hebrew). */
export function readability(text: string, opts: { freq?: FrequencyList } = {}): Readability {
  const he = (text.match(/[א-ת]/g) ?? []).length;
  const la = (text.match(/[A-Za-z]/g) ?? []).length;
  return he >= la && he > 0 ? hebrewReadability(text, opts.freq) : englishReadability(text);
}

/** Spearman's rank correlation (average ranks for ties). */
export function spearman(a: readonly number[], b: readonly number[]): number {
  const rank = (xs: readonly number[]) => {
    const idx = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
