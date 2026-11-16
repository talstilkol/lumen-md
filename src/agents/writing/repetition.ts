/**
 * Repetition and cliché detector (plan W13.W11): ProWritingAid and
 * Hemingway flag a word used again too soon; in Hebrew, without
 * lemmatization, "ספר", "בספר" and "ספרים" look like three words. Here they
 * are one lemma.
 *
 *  - Repetition: a content word whose lemma comes back within a window of
 *    50 words. Function words (./functionWords) never count; nor do
 *    numbers, words in headings, English names (a capital inside a
 *    sentence) and words shorter than three letters. A topic word — one the
 *    whole note keeps using — must come back three times in the window
 *    before it is flagged: a note about a book says "ספר" often, and that
 *    is the subject, not a style problem.
 *  - Doubled words ("the the", "של של"): a typo, with a fix (delete the
 *    second), except the reduplications Hebrew uses on purpose ("לאט לאט").
 *  - Clichés (./cliches): curated open lists (CC0), Hebrew with prefix
 *    letters allowed on the first word ("ובסופו של יום"), plus the user's
 *    own phrases; each one can be switched off.
 *
 * Lemmas: the W11.H12 lemmatizer seam (search/lemma/lemmatizer.ts) when a
 * model is loaded (`detectRepetitionWith`), otherwise the rule-based Hebrew
 * morphology (text/hebrewMorph.ts: prefix letters, one inflectional suffix,
 * full and defective spelling) and a light English stemmer.
 *
 * Pure and synchronous; ~O(n·w) on n words with a window of w. A 10k-word
 * note runs in a few milliseconds.
 */
import { ktivKey, lemmaKeys } from "../../text/hebrewMorph";
import { isFunctionWord } from "./functionWords";
import { proseTokens, type ProseToken } from "./proseMask";
import { matchCliches, type ClicheOptions } from "./cliches";
import type { WritingSuggestion } from "./writingSuggestion";
import type { Lemmatizer } from "../../search/lemma/lemmatizer";

export const REPETITION_AGENT = "repetition";
export const DEFAULT_WINDOW = 50;

export interface RepetitionOptions extends ClicheOptions {
  /** Words between two uses that still count as "too soon" (default 50). */
  window?: number;
  /** Lemmas (comparison form) the user switched off. */
  ignoredLemmas?: readonly string[];
  /** One lemma per prose token, from a lemmatizer; overrides the rules. */
  lemmas?: readonly string[];
  /** UI language of the messages. */
  lang?: "he" | "en";
  /** Skip clichés (repetition only). */
  noCliches?: boolean;
}

const HEB = /^[א-ת]+$/;
const LATIN = /^[a-z]+$/;
const PREFIX_LETTERS = /^[והבלמשכ]/;

/** Deliberate Hebrew reduplications: never a doubled-word typo. */
const REDUPLICATION = new Set(["לאט", "יומ", "קצת", "רגע", "צעד", "אחד", "שנה", "טוב", "מעט", "פעמ", "כל", "שוב", "מאוד", "ממש", "very", "so", "that", "had", "is", "bye", "no", "yes", "night"]);

/** A light English stem: plural, -ing, -ed, -ly, -ies off; at least four letters left. */
export function englishStem(w: string): string {
  if (w.length <= 4) return w;
  const rules: Array<[RegExp, string]> = [
    [/ies$/, "y"], [/ied$/, "y"], [/(ss)es$/, "$1"], [/([^s])s$/, "$1"],
    [/ingly$/, ""], [/edly$/, ""], [/ing$/, ""], [/ed$/, ""], [/ly$/, ""],
  ];
  for (const [re, rep] of rules) {
    if (!re.test(w)) continue;
    const s = w.replace(re, rep);
    if (s.length >= 4) return s.replace(/(.)\1$/, "$1").replace(/e$/, "");
  }
  return w.replace(/e$/, "");
}

/**
 * The lemma keys of a Hebrew word: the word and its prefix-less forms (at
 * least three letters left), each with one suffix off; then the full /
 * defective spelling key of forms of four letters or more.
 */
export function hebrewKeys(norm: string): string[] {
  const forms = [norm];
  let w = norm;
  for (let i = 0; i < 4 && w.length > 3 && PREFIX_LETTERS.test(w); i++) {
    w = w.slice(1);
    forms.push(w);
  }
  const out = new Set<string>();
  for (const f of forms) {
    out.add(f);
    for (const k of lemmaKeys(f)) if (k.length >= 3) out.add(k);
    if (f.length >= 4) {
      const k = ktivKey(f);
      if (k && k.length >= 3) out.add(`~${k}`);
    }
  }
  return [...out];
}

interface Content {
  tok: ProseToken;
  /** Index among all prose tokens (the window counts every word). */
  at: number;
  keys: string[];
  /** The key two uses share: the shortest (most general) one is reported. */
  display: string;
}

function contentKeys(t: ProseToken, i: number, lemmas: readonly string[] | undefined): string[] | null {
  if (t.heading || /\p{N}/u.test(t.norm)) return null;
  if (isFunctionWord(t.norm)) return null;
  if (lemmas?.[i]) {
    const l = lemmas[i];
    return l.length < 3 || l === t.norm && isFunctionWord(l) ? null : [l];
  }
  if (HEB.test(t.norm)) {
    // A word that is all prefix letters plus two (בגל, ושמ) has too little left to be sure of.
    return t.norm.length >= 3 ? hebrewKeys(t.norm) : null;
  }
  if (LATIN.test(t.norm)) {
    if (t.norm.length < 4) return null;
    if (!t.sentenceStart && /^\p{Lu}/u.test(t.text)) return null; // a name
    return [englishStem(t.norm)];
  }
  return null;
}

const msg = {
  he: {
    rep: (w: string, n: number, d: number) => `״${w}״ חוזרת ${n} פעמים ב-${d} מילים`,
    repWhy: "מילה (או צורה אחרת שלה) שחוזרת בטווח קצר מושכת את עין הקורא. אפשר לגוון, להחליף בכינוי או למחוק.",
    dbl: (w: string) => `״${w}״ כתובה פעמיים ברצף`,
    dblWhy: "נראה כמו שגיאת הקלדה: אותה מילה פעמיים ברצף.",
  },
  en: {
    rep: (w: string, n: number, d: number) => `"${w}" appears ${n} times in ${d} words`,
    repWhy: "A word (or another form of it) repeated within a short span draws the reader's eye. Vary it, use a pronoun or cut it.",
    dbl: (w: string) => `"${w}" is written twice in a row`,
    dblWhy: "Looks like a typo: the same word twice in a row.",
  },
};

/** Repetitions, doubled words and clichés of a note, as suggestions (most of them notes only). */
export function detectRepetition(markdown: string, opts: RepetitionOptions = {}): WritingSuggestion[] {
  const lang = opts.lang ?? "en";
  const M = msg[lang];
  const window = Math.max(5, opts.window ?? DEFAULT_WINDOW);
  const ignored = new Set(opts.ignoredLemmas ?? []);
  const toks = proseTokens(markdown);
  const out: WritingSuggestion[] = [];

  // Doubled words: the same comparison form twice in a row, in one sentence, with only spaces between.
  for (let i = 1; i < toks.length; i++) {
    const a = toks[i - 1];
    const b = toks[i];
    if (a.norm !== b.norm || a.sentence !== b.sentence || !/^[ \t]+$/.test(markdown.slice(a.to, b.from))) continue;
    if (REDUPLICATION.has(a.norm) || /\p{N}/u.test(a.norm) || a.heading) continue;
    out.push({
      range: { from: a.to, to: b.to },
      kind: "doubled",
      message: M.dbl(b.text),
      rationale: M.dblWhy,
      confidence: 0.95,
      replacement: "",
      agentId: REPETITION_AGENT,
      model: "rules",
      data: { word: b.norm },
    });
  }
  const doubledAt = new Set(out.map((s) => s.range.to));

  const content: Content[] = [];
  toks.forEach((t, i) => {
    const keys = contentKeys(t, i, opts.lemmas);
    if (keys?.length && !keys.some((k) => ignored.has(k.replace(/^~/, "")))) content.push({ tok: t, at: i, keys, display: keys[0] });
  });

  // Topic words: a key used across the whole note (≥ 4 times and ≥ 1.5% of its words).
  const docFreq = new Map<string, number>();
  for (const c of content) for (const k of new Set(c.keys)) docFreq.set(k, (docFreq.get(k) ?? 0) + 1);
  const topicMin = Math.max(4, Math.ceil(toks.length * 0.015));

  // For each key, the indices (into `toks`) of its uses so far, to count within the window.
  const seen = new Map<string, Content[]>();
  const flagged = new Set<number>();
  for (const c of content) {
    let best: { key: string; prev: Content[] } | null = null;
    for (const k of c.keys) {
      const prev = (seen.get(k) ?? []).filter((p) => c.at - p.at <= window && p.tok.sentence !== -1);
      seen.set(k, [...prev, c]);
      if (!prev.length) continue;
      const need = (docFreq.get(k) ?? 0) >= topicMin ? 2 : 1;
      if (prev.length >= need && (!best || prev.length > best.prev.length)) best = { key: k, prev };
    }
    if (!best || flagged.has(c.at) || doubledAt.has(c.tok.to)) continue;
    // Right next to itself: a doubled word (its own check) or a deliberate reduplication (לאט לאט).
    const lastUse = best.prev[best.prev.length - 1];
    if (c.at - lastUse.at === 1 && lastUse.tok.norm === c.tok.norm) continue;
    flagged.add(c.at);
    const first = best.prev[0];
    const n = best.prev.length + 1;
    const span = c.at - first.at + 1;
    out.push({
      range: { from: c.tok.from, to: c.tok.to },
      kind: "repetition",
      message: M.rep(first.tok.text, n, span),
      rationale: M.repWhy,
      // Closer = more noticeable.
      confidence: Math.round((0.6 + 0.35 * (1 - (c.at - best.prev[best.prev.length - 1].at) / window)) * 100) / 100,
      replacement: null,
      agentId: REPETITION_AGENT,
      model: "rules",
      data: { lemma: best.key.replace(/^~/, ""), occurrences: [...best.prev.map((p) => [p.tok.from, p.tok.to]), [c.tok.from, c.tok.to]] },
    });
  }

  if (!opts.noCliches) out.push(...matchCliches(toks, markdown, { ...opts, lang }));
  return out.sort((a, b) => a.range.from - b.range.from || a.kind.localeCompare(b.kind));
}

/** The same, with lemmas from a lemmatizer (W11.H12) when one is loaded. */
export async function detectRepetitionWith(markdown: string, lz: Lemmatizer | null, opts: RepetitionOptions = {}, signal?: AbortSignal): Promise<WritingSuggestion[]> {
  if (!lz) return detectRepetition(markdown, opts);
  const toks = proseTokens(markdown);
  const lemmas: string[] = [];
  // Sentence by sentence, as the lemmatizer expects.
  for (let i = 0; i < toks.length; ) {
    signal?.throwIfAborted();
    let j = i;
    while (j < toks.length && toks[j].sentence === toks[i].sentence) j++;
    const ws = toks.slice(i, j).map((t) => t.text);
    const ls = await lz.lemmatize(ws, ws.join(" "));
    for (let k = 0; k < ws.length; k++) lemmas.push((ls[k] ?? ws[k]).normalize("NFC").replace(/[֑-ׇ]/g, "").toLowerCase().replace(/[ךםןףץ]/g, (ch) => ({ "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" })[ch] ?? ch));
    i = j;
  }
  return detectRepetition(markdown, { ...opts, lemmas });
}
