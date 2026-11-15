/**
 * "Matched as …" (plan R12.16): why a search result matched the query word,
 * one tier per word, from the strictest to the loosest:
 *
 *   exact     the same word as typed
 *   niqqud    the same letters, with or without niqqud (שָׁלוֹם / שלום)
 *   finals    the same word with a final / regular letter (שלומ / שלום)
 *   prefix    the word without its prefix letters (ולפיד → לפיד, "ו")
 *   ktiv      full / defective spelling (תוכנית / תכנית)
 *   lemma     another inflection (אבודות / אבודה)
 *   synonym   another word for the same thing (רכב / מכונית)
 *   english   a Hebrew word's English equivalent (מתכון / recipe)
 *   translit  a transliteration, either way (Kohen / כהן)
 *
 * It reuses the search's own rules (text/hebrew, text/hebrewMorph,
 * text/translit), so the explanation is what the index did, not a guess
 * next to it. Pure; nothing here touches the index.
 */
import { hasHebrew, normalizeForMatch, prefixVariants, stripNiqqud, words } from "./hebrew";
import { englishOf, ktivKey, lemmaKeys, synonymsOf } from "./hebrewMorph";
import { isTransliteration } from "./translit";

export type MatchTier = "exact" | "niqqud" | "finals" | "prefix" | "ktiv" | "lemma" | "synonym" | "english" | "translit";

export interface MatchedAs {
  tier: MatchTier;
  /** The query word, as typed. */
  query: string;
  /** The word of the note it matched, as written there. */
  word: string;
  /** For "prefix": the prefix letters that came off ("ו", "וה"). */
  prefix?: string;
}

const lowerFold = (s: string) => s.normalize("NFC").toLowerCase();
const finalsOnly = (s: string) => lowerFold(stripNiqqud(s));
const clean = (s: string) => s.replace(/['"]/g, "");

/** The tier at which `docWord` matches `queryWord`, or null when it does not. */
export function matchTier(queryWord: string, docWord: string): { tier: MatchTier; prefix?: string } | null {
  if (lowerFold(queryWord) === lowerFold(docWord)) return { tier: "exact" };
  if (finalsOnly(queryWord) === finalsOnly(docWord)) return { tier: "niqqud" };
  const q = clean(normalizeForMatch(queryWord));
  const d = clean(normalizeForMatch(docWord));
  if (!q || !d) return null;
  if (q === d) return { tier: "finals" };
  if (hasHebrew(q) && hasHebrew(d)) {
    // Either side may carry the prefix: "ולפיד" finds "לפיד", "לפיד" finds "ולפיד".
    const qv = prefixVariants(q);
    const dv = prefixVariants(d);
    const i = qv.indexOf(d);
    if (i > 0) return { tier: "prefix", prefix: q.slice(0, q.length - d.length) };
    const j = dv.indexOf(q);
    if (j > 0) return { tier: "prefix", prefix: d.slice(0, d.length - q.length) };
    const kq = new Set(qv.map(ktivKey).filter((k): k is string => !!k && k.length >= 3));
    if (dv.some((v) => { const k = ktivKey(v); return !!k && kq.has(k); })) return { tier: "ktiv" };
    const lq = new Set(qv.flatMap(lemmaKeys).filter((k) => k.length >= 3));
    if (dv.some((v) => lemmaKeys(v).some((k) => lq.has(k)))) return { tier: "lemma" };
    if (qv.some((v) => synonymsOf(v).some((s) => dv.includes(s)))) return { tier: "synonym" };
    return null;
  }
  if (hasHebrew(q) && prefixVariants(q).some((v) => englishOf(v).includes(d))) return { tier: "english" };
  const bare = (w: string) => (hasHebrew(w) ? prefixVariants(w) : [w]);
  if (bare(q).some((x) => bare(d).some((y) => isTransliteration(x, y)))) return { tier: "translit" };
  return null;
}

const RANK: Record<MatchTier, number> = { exact: 0, niqqud: 1, finals: 2, prefix: 3, ktiv: 4, lemma: 5, synonym: 6, english: 7, translit: 8 };

/**
 * For each word of the query, the best way the text matched it (null for a
 * word the text does not match). `text` is what the result shows: its
 * marked span or snippet.
 */
export function explainMatch(query: string, text: string): Array<MatchedAs | null> {
  const docWords = [...new Set(words(text))];
  return words(query).map((qw) => {
    let best: MatchedAs | null = null;
    for (const dw of docWords) {
      const m = matchTier(qw, dw);
      if (m && (!best || RANK[m.tier] < RANK[best.tier])) best = { query: qw, word: dw, ...m };
      if (best?.tier === "exact") break;
    }
    return best;
  });
}

/** The explanations worth a line under a result: every word that did not match exactly. */
export function looseMatches(query: string, text: string): MatchedAs[] {
  return explainMatch(query, text).filter((m): m is MatchedAs => !!m && m.tier !== "exact");
}
