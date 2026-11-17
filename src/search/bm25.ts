/**
 * BM25 over the workspace (plan 5.2).
 *
 * An inverted index that is updated one document at a time — `set` adds
 * or replaces a document, `remove` takes it out — so a saved note costs
 * one re-tokenisation, never a rebuild. Scores are Okapi BM25 (k1 = 1.2,
 * b = 0.75) with the note's name as a boosted field (its terms count
 * `NAME_BOOST` times, BM25F-style, inside the same length-normalised tf),
 * and weighted query terms (`text/searchTokens`: exact forms 1, Hebrew
 * prefix-less stems less).
 *
 * Loaded lazily by `storage/workspaceIndex` the first time a search runs;
 * nothing here is in the startup bundle.
 */

import { documentTerms, queryTerms, STEM, TRANSLIT_WEIGHT, type QueryTerm } from "../text/searchTokens";
import { phoneticKeys, translitScript } from "../text/translit";

export const K1 = 1.2;
export const B = 0.75;
/** A term in the note's name counts this many times. */
export const NAME_BOOST = 3;
/** A term the last query word is the start of (typing ahead: "gard" → "garden") counts this much. */
export const PREFIX_WEIGHT = 0.5;
/**
 * How many postings the completions of the last word may add to one search.
 * Rare completions come first: a note whose only match is a rare word being
 * typed (`pro` → `protolanguage`) must not lose to thirty common ones, and a
 * rare word costs little. Only a very short, very common prefix reaches the
 * cap, and then it is the most common completions that are left out
 * (W1.32, Codex on #232; it used to keep the 30 most frequent terms).
 */
export const MAX_PREFIX_POSTINGS = 50_000;

/** At most this many words in the other script stand for one query word (R12.16). */
export const MAX_TRANSLIT_TERMS = 8;

/** A word's length without Latin vowels (Hebrew writes few vowels: "kohen" is as long as "כהנ"). */
const consonants = (w: string) => w.replace(/[aeiouy]/g, "").length;

interface Doc {
  id: string;
  /** Internal number: postings are keyed by it (small integers are V8's fastest Map keys). */
  num: number;
  /** What the document was indexed from (identity: an unchanged note is not re-indexed). */
  source: string;
  name: string;
  /** Weighted length (name terms count NAME_BOOST times). */
  length: number;
  /** Its distinct terms (for removal). */
  terms: string[];
  /** The extra terms it was indexed with (W11.H12: model lemmas), joined; "" for none. */
  extra: string;
}

export interface Bm25Hit {
  id: string;
  score: number;
  /** The query terms found in the document (exact or stem), best first. */
  matched: string[];
  /** Every word of the query matched (only then can the query occur in it as a phrase). */
  complete: boolean;
}

export class Bm25Index {
  private docs = new Map<string, Doc>();
  private byNum = new Map<number, Doc>();
  private postings = new Map<string, Map<number, number>>();
  private totalLength = 0;
  private nextNum = 0;
  /**
   * Phonetic key → the index's words with that key (R12.16). Built the first
   * time a query needs it, then kept up to date by set / remove, so an index
   * nobody searches across scripts never pays for it.
   */
  private translit: Map<string, Set<string>> | null = null;

  get size(): number {
    return this.docs.size;
  }

  has(id: string): boolean {
    return this.docs.has(id);
  }

  /** True when `id` is indexed from exactly this text and name. */
  isCurrent(id: string, text: string, name = ""): boolean {
    const d = this.docs.get(id);
    return !!d && d.source === text && d.name === name;
  }

  /**
   * Add or replace one document. `extra`: terms computed elsewhere, each
   * counted once like a word of the text (W11.H12: the `≃` lemma terms a
   * lemmatizer model gives, ./lemma/lemmaIndex.ts).
   */
  set(id: string, text: string, name = "", extra: readonly string[] = []): void {
    const key = extra.join("\u0000");
    if (this.isCurrent(id, text, name) && this.docs.get(id)!.extra === key) return;
    this.remove(id);
    const counts = new Map<string, number>();
    let length = 0;
    for (const t of documentTerms(text)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
      length++;
    }
    for (const t of extra) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
      length++;
    }
    for (const t of documentTerms(name)) {
      counts.set(t, (counts.get(t) ?? 0) + NAME_BOOST);
      length += NAME_BOOST;
    }
    const num = this.nextNum++;
    const doc: Doc = { id, num, source: text, name, length, terms: [...counts.keys()], extra: key };
    this.docs.set(id, doc);
    this.byNum.set(num, doc);
    this.totalLength += length;
    for (const [t, tf] of counts) {
      let p = this.postings.get(t);
      if (!p) {
        this.postings.set(t, (p = new Map()));
        if (this.translit) this.addTranslit(t);
      }
      p.set(num, tf);
    }
  }

  private addTranslit(term: string): void {
    const map = this.translit;
    if (!map || !translitScript(term)) return;
    for (const k of phoneticKeys(term)) {
      let s = map.get(k);
      if (!s) map.set(k, (s = new Set()));
      s.add(term);
    }
  }

  private dropTranslit(term: string): void {
    const map = this.translit;
    if (!map || !translitScript(term)) return;
    for (const k of phoneticKeys(term)) {
      const s = map.get(k);
      if (!s) continue;
      s.delete(term);
      if (!s.size) map.delete(k);
    }
  }

  /**
   * For each query word, the index's words in the other script that share a
   * phonetic key with it ("Kohen" → "כהנ"), as weaker forms of that word.
   */
  private transliterations(terms: QueryTerm[]): QueryTerm[] {
    const exact = terms.filter((t) => t.weight === 1 && translitScript(t.term) && t.term.replace(/['"]/g, "").length >= 3);
    if (!exact.length) return [];
    if (!this.translit) {
      this.translit = new Map();
      for (const term of this.postings.keys()) this.addTranslit(term);
    }
    const out: QueryTerm[] = [];
    for (const { term, group } of exact) {
      const script = translitScript(term);
      const found = new Set<string>();
      for (const k of phoneticKeys(term)) for (const w of this.translit.get(k) ?? []) if (translitScript(w) !== script) found.add(w);
      // The closest in consonants first (a name, not a longer word that happens to share its sounds).
      const len = consonants(term);
      const best = [...found].sort((a, b) => Math.abs(consonants(a) - len) - Math.abs(consonants(b) - len) || (a < b ? -1 : 1)).slice(0, MAX_TRANSLIT_TERMS);
      for (const w of best) out.push({ term: w, weight: TRANSLIT_WEIGHT, group });
    }
    return out;
  }

  remove(id: string): void {
    const d = this.docs.get(id);
    if (!d) return;
    this.docs.delete(id);
    this.byNum.delete(d.num);
    this.totalLength -= d.length;
    for (const t of d.terms) {
      const p = this.postings.get(t);
      if (!p) continue;
      p.delete(d.num);
      if (!p.size) {
        this.postings.delete(t);
        this.dropTranslit(t);
      }
    }
  }

  /** Ids currently indexed. */
  ids(): IterableIterator<string> {
    return this.docs.keys();
  }

  /** Inverse document frequency (BM25+'s non-negative form). */
  idf(term: string): number {
    const df = this.postings.get(term)?.size ?? 0;
    const n = this.docs.size;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /** The best `limit` documents for `query` (or for pre-built weighted terms). */
  /**
   * Terms the last query word is the start of, as weaker forms of that word
   * (search as you type: the word may not be finished).
   */
  private completions(terms: QueryTerm[]): QueryTerm[] {
    const last = Math.max(...terms.map((t) => t.group));
    const base = terms.find((t) => t.group === last && t.weight === 1)?.term;
    if (!base || base.length < 2 || base.startsWith(STEM)) return [];
    const found: Array<[string, number]> = [];
    for (const [term, p] of this.postings) if (term.length > base.length && term.startsWith(base)) found.push([term, p.size]);
    found.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
    const out: QueryTerm[] = [];
    let postings = 0;
    for (const [term, df] of found) {
      if (out.length && postings + df > MAX_PREFIX_POSTINGS) break;
      postings += df;
      out.push({ term, weight: PREFIX_WEIGHT, group: last });
    }
    return out;
  }

  /**
   * `expand`: more forms of the query's words, from the query's terms (W11.H12:
   * a lemmatizer's lemmas, ./lemma/lemmaIndex.ts); each keeps its word's group.
   */
  search(query: string | QueryTerm[], opts: { limit?: number; filter?: (id: string) => boolean; prefix?: boolean; expand?: (base: QueryTerm[]) => QueryTerm[] } = {}): Bm25Hit[] {
    const base = typeof query === "string" ? queryTerms(query) : query;
    const n = this.docs.size;
    if (!n || !base.length) return [];
    const expanded = opts.expand ? [...base, ...opts.expand(base)] : base;
    const withTranslit = typeof query === "string" ? [...expanded, ...this.transliterations(base)] : expanded;
    const terms = opts.prefix ? [...withTranslit, ...this.completions(base)] : withTranslit;
    // Query words by index (W13.V3: arrays per document, not a Map each — a word in 5,000 notes allocates 5,000 fewer Maps).
    const groupIndex = new Map<number, number>();
    for (const t of base) if (!groupIndex.has(t.group)) groupIndex.set(t.group, groupIndex.size);
    const groups = groupIndex.size;
    const avg = this.totalLength / n || 1;
    // Per document, per query word: the best of its forms (see QueryTerm.group).
    const scores = new Map<Doc, { s: Float64Array; t: (string | undefined)[] }>();
    const allowed = new Map<Doc, boolean>();
    for (const { term, weight, group } of terms) {
      const p = this.postings.get(term);
      if (!p) continue;
      const gi = groupIndex.get(group);
      if (gi === undefined) continue;
      const idf = this.idf(term) * weight;
      for (const [num, tf] of p) {
        const doc = this.byNum.get(num)!;
        if (opts.filter) {
          let ok = allowed.get(doc);
          if (ok === undefined) allowed.set(doc, (ok = opts.filter(doc.id)));
          if (!ok) continue;
        }
        const len = doc.length;
        const s = (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / avg));
        let e = scores.get(doc);
        if (!e) scores.set(doc, (e = { s: new Float64Array(groups), t: new Array(groups) }));
        if (e.t[gi] === undefined || s > e.s[gi]) {
          e.s[gi] = s;
          e.t[gi] = term;
        }
      }
    }
    const limit = opts.limit ?? 30;
    const hits: Bm25Hit[] = [];
    for (const [doc, e] of scores) {
      let score = 0;
      let found = 0;
      const parts: [string, number][] = [];
      for (let g = 0; g < groups; g++) {
        const term = e.t[g];
        if (term === undefined) continue;
        found++;
        score += e.s[g];
        parts.push([term, e.s[g]]);
      }
      if (parts.length > 1) {
        // The same order of addition as before, so equal scores stay equal to the last bit.
        parts.sort((x, y) => y[1] - x[1]);
        score = parts.reduce((sum, [, v]) => sum + v, 0);
      }
      hits.push({ id: doc.id, score, matched: parts.map(([t]) => t), complete: found === groups });
    }
    hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    return hits.slice(0, limit);
  }
}
