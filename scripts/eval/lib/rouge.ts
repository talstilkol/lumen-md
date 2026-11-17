/**
 * ROUGE-L for the summary eval (plan W10.C9, 6.11 acceptance 3).
 *
 * Two scores, as defined by Lin (2004), "ROUGE: A Package for Automatic
 * Evaluation of Summaries", §3, and as Google's rouge-score package computes
 * them (`rougeL` and `rougeLsum`):
 *
 * - `rougeL`: the longest common subsequence of the whole candidate and the
 *   whole reference, as token sequences.
 * - `rougeLsum`: summary level. Each reference sentence is matched against
 *   every candidate sentence, and the UNION of the LCS tokens counts (Lin's
 *   LCS∪), clipped so a token is never counted more often than it occurs in
 *   either text.
 *
 * Precision, recall and F1 (β = 1, rouge-score's default).
 *
 * Tokens: lower-cased, niqqud and cantillation removed, every run of letters
 * or digits in any script is a token (rouge-score's default tokenizer drops
 * every non-ASCII letter, which would score every Hebrew summary 0). With
 * `hebrewPrefixes`, two Hebrew tokens also match when one is the other with
 * up to three leading one-letter prefixes (ו ה ב ל מ ש כ, the search's
 * prefixVariants, keeping at least three letters), so "והממשלה", "הממשלה"
 * match "ממשלה" (but "בממשלה" does not match "הממשלה"). The text itself is never rewritten. Off by
 * default; the summary report turns it on for Hebrew references and says so.
 */
import { prefixVariants, stripNiqqud } from "../../../src/text/hebrew";

export interface RougeScore {
  precision: number;
  recall: number;
  f1: number;
}

export interface RougeOptions {
  /** Strip one leading Hebrew one-letter prefix from Hebrew tokens of 4+ letters. */
  hebrewPrefixes?: boolean;
}

/** The tokens ROUGE compares (prefix matching, when on, happens in tokenMatcher; the tokens stay as written). */
export function rougeTokens(text: string): string[] {
  const t = stripNiqqud(text.normalize("NFC")).toLowerCase();
  // Geresh / gershayim inside a word (צ׳יפס, ארה״ב) stay part of it.
  return t.match(/[\p{L}\p{N}]+(?:["'׳״][\p{L}\p{N}]+)*/gu) ?? [];
}

type Eq = (a: string, b: string) => boolean;
const exact: Eq = (a, b) => a === b;

/** Token equality: exact, or (hebrewPrefixes) one token is a prefixed form of the other. */
export function tokenMatcher(opts: RougeOptions = {}): Eq {
  if (!opts.hebrewPrefixes) return exact;
  const memo = new Map<string, string[]>();
  const v = (w: string) => {
    let r = memo.get(w);
    if (!r) memo.set(w, (r = prefixVariants(w)));
    return r;
  };
  return (a, b) => a === b || v(a).includes(b) || v(b).includes(a);
}

/** Sentences for rougeLsum: newline-separated when the text has newlines, else split after . ! ? and the Hebrew sof pasuq. */
export function rougeSentences(text: string): string[] {
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  return text.split(/(?<=[.!?׃])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** The LCS table of a and b (lengths only). */
function lcsTable(a: string[], b: string[], eq: Eq = exact): Uint32Array[] {
  const t: Uint32Array[] = [];
  for (let i = 0; i <= a.length; i++) t.push(new Uint32Array(b.length + 1));
  for (let i = 1; i <= a.length; i++) {
    const row = t[i];
    const prev = t[i - 1];
    for (let j = 1; j <= b.length; j++) row[j] = eq(a[i - 1], b[j - 1]) ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
  }
  return t;
}

/** Length of the longest common subsequence. */
export function lcsLength(a: string[], b: string[], eq: Eq = exact): number {
  if (!a.length || !b.length) return 0;
  return lcsTable(a, b, eq)[a.length][b.length];
}

/** Indexes into `ref` of one longest common subsequence of ref and cand. */
function lcsRefIndexes(ref: string[], cand: string[], eq: Eq): number[] {
  const t = lcsTable(ref, cand, eq);
  const out: number[] = [];
  let i = ref.length;
  let j = cand.length;
  while (i > 0 && j > 0) {
    if (eq(ref[i - 1], cand[j - 1]) && t[i][j] === t[i - 1][j - 1] + 1) {
      out.push(i - 1);
      i--;
      j--;
    } else if (t[i - 1][j] >= t[i][j - 1]) i--;
    else j--;
  }
  return out.reverse();
}

function score(hits: number, candLen: number, refLen: number): RougeScore {
  const precision = candLen ? hits / candLen : 0;
  const recall = refLen ? hits / refLen : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

/** Sentence-agnostic ROUGE-L of a candidate against one reference. */
export function rougeL(candidate: string, reference: string, opts: RougeOptions = {}): RougeScore {
  const c = rougeTokens(candidate);
  const r = rougeTokens(reference);
  return score(lcsLength(r, c, tokenMatcher(opts)), c.length, r.length);
}

/** Summary-level ROUGE-L (Lin's union LCS; rouge-score's rougeLsum). */
export function rougeLsum(candidate: string, reference: string, opts: RougeOptions = {}): RougeScore {
  const cands = rougeSentences(candidate).map((s) => rougeTokens(s));
  const refs = rougeSentences(reference).map((s) => rougeTokens(s));
  const eq = tokenMatcher(opts);
  const count = (sents: string[][]) => {
    const m = new Map<string, number>();
    for (const s of sents) for (const w of s) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const candLeft = count(cands);
  const refLeft = count(refs);
  const candLen = cands.reduce((a, s) => a + s.length, 0);
  const refLen = refs.reduce((a, s) => a + s.length, 0);
  // A hit uses up one occurrence of the reference token and one matching candidate token.
  const takeCand = (w: string): boolean => {
    if ((candLeft.get(w) ?? 0) > 0) return (candLeft.set(w, candLeft.get(w)! - 1), true);
    for (const [c, n] of candLeft) if (n > 0 && eq(w, c)) return (candLeft.set(c, n - 1), true);
    return false;
  };
  let hits = 0;
  for (const ref of refs) {
    const union = new Set<number>();
    for (const cand of cands) for (const i of lcsRefIndexes(ref, cand, eq)) union.add(i);
    for (const i of [...union].sort((a, b) => a - b)) {
      const w = ref[i];
      if ((refLeft.get(w) ?? 0) > 0 && takeCand(w)) {
        hits++;
        refLeft.set(w, refLeft.get(w)! - 1);
      }
    }
  }
  return score(hits, candLen, refLen);
}

/** Mean of a list of scores (macro average, as rouge-score's aggregator reports the mid value). */
export function meanRouge(scores: RougeScore[]): RougeScore {
  if (!scores.length) return { precision: 0, recall: 0, f1: 0 };
  const sum = (k: keyof RougeScore) => scores.reduce((a, s) => a + s[k], 0) / scores.length;
  return { precision: sum("precision"), recall: sum("recall"), f1: sum("f1") };
}
