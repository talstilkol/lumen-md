/**
 * English G2P for the Kokoro voices (plan 6.2): a TypeScript port of the
 * lexicon of misaki (hexgrad/misaki @fba12365, Apache-2.0, `misaki/en.py`
 * `Lexicon`): gold then silver dictionary lookup, the stress rules
 * (`apply_stress`), the -s / -ed / -ing suffix rules, letters for
 * acronyms (`get_NNP`) and misaki's special cases for function words.
 *
 * Not ported: spaCy's part-of-speech tags (here every word is untagged, so a
 * heteronym takes its DEFAULT reading; misaki without a tagger does the
 * same) and the espeak / neural fallback — an unknown word comes back as
 * null and the caller decides (misaki's `unk`, ❓). Numbers are spelled
 * out in English words (misaki uses num2words) and then looked up.
 *
 * The dictionaries are data, not code: scripts/tts/build-misaki-dict.mjs
 * writes them (us_gold.json + us_silver.json at the pinned commit) into the
 * voice pack, and they load with the voice. Nothing here is in the startup
 * bundle (only kokoro.ts's loader imports it).
 */

export type LexEntry = string | Record<string, string | null>;
export type LexMap = Record<string, LexEntry>;

const PRIMARY = "ˈ";
const SECONDARY = "ˌ";
const STRESSES = SECONDARY + PRIMARY;
const VOWELS = new Set("AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ");
const DIPHTHONGS = new Set("AIOQWYʤʧ");
const US_TAUS = new Set("AIOWYiuæɑəɛɪɹʊʌ");
const SYMBOLS: Record<string, string> = { "%": "percent", "&": "and", "+": "plus", "@": "at" };

export const stressWeight = (ps: string | null) => (ps ? [...ps].reduce((n, c) => n + (DIPHTHONGS.has(c) ? 2 : 1), 0) : 0);

/** misaki's restress: each stress mark moves to just before the next vowel. */
function restress(ps: string): string {
  const chars = [...ps];
  const keyed = chars.map((c, i) => ({ c, k: i }));
  chars.forEach((c, i) => {
    if (!STRESSES.includes(c)) return;
    const j = chars.findIndex((v, x) => x >= i && VOWELS.has(v));
    if (j >= 0) keyed[i]!.k = j - 0.5;
  });
  return keyed.sort((a, b) => a.k - b.k).map((x) => x.c).join("");
}

/** misaki `apply_stress`. */
export function applyStress(ps: string | null, stress: number | null): string | null {
  if (ps === null || stress === null) return ps;
  const has = (s: string) => ps.includes(s);
  const noStress = !has(PRIMARY) && !has(SECONDARY);
  const noVowel = ![...ps].some((c) => VOWELS.has(c));
  if (stress < -1) return ps.replaceAll(PRIMARY, "").replaceAll(SECONDARY, "");
  if (stress === -1 || ((stress === 0 || stress === -0.5) && has(PRIMARY))) return ps.replaceAll(SECONDARY, "").replaceAll(PRIMARY, SECONDARY);
  if ((stress === 0 || stress === 0.5 || stress === 1) && noStress) return noVowel ? ps : restress(SECONDARY + ps);
  if (stress >= 1 && !has(PRIMARY) && has(SECONDARY)) return ps.replaceAll(SECONDARY, PRIMARY);
  if (stress > 1 && noStress) return noVowel ? ps : restress(PRIMARY + ps);
  return ps;
}

const isAlpha = (s: string) => /^\p{L}+$/u.test(s);
const isLexiconWord = (s: string) => /^[A-Za-z'-]+$/.test(s);
const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1).toLowerCase() : s);

/** misaki `grow_dictionary`: every lower-case key also as Capitalised, and the reverse. */
export function growDictionary(d: LexMap): LexMap {
  const e: LexMap = {};
  for (const [k, v] of Object.entries(d)) {
    if (k.length < 2) continue;
    if (k === k.toLowerCase()) {
      if (k !== capitalize(k)) e[capitalize(k)] = v;
    } else if (k === capitalize(k.toLowerCase())) e[k.toLowerCase()] = v;
  }
  return { ...e, ...d };
}

export interface WordContext {
  /** The next word starts with a vowel sound (true), a consonant (false), or there is none (null). */
  futureVowel: boolean | null;
  futureTo: boolean;
}

export type Lookup = [string | null, number | null];

export class EnglishLexicon {
  readonly golds: LexMap;
  readonly silvers: LexMap;
  constructor(gold: LexMap, silver: LexMap) {
    this.golds = growDictionary(gold);
    this.silvers = growDictionary(silver);
  }

  private entry(word: string, d: LexMap, ctx: WordContext | null): string | null | undefined {
    const ps = d[word];
    if (ps === undefined || typeof ps === "string") return ps;
    if (ctx && ctx.futureVowel === null && "None" in ps) return ps.None ?? null;
    return ps.DEFAULT ?? null;
  }

  getNNP(word: string): Lookup {
    const parts: string[] = [];
    for (const c of word) {
      if (!isAlpha(c)) continue;
      const g = this.golds[c.toUpperCase()];
      if (typeof g !== "string") return [null, null];
      parts.push(g);
    }
    const ps = applyStress(parts.join(""), 0)!;
    const at = ps.lastIndexOf(SECONDARY);
    return [at < 0 ? ps : ps.slice(0, at) + PRIMARY + ps.slice(at + 1), 3];
  }

  getSpecialCase(word: string, stress: number | null, ctx: WordContext): Lookup {
    if (word in SYMBOLS) return this.lookup(SYMBOLS[word]!, null, ctx);
    const parts = word.replace(/^\.+|\.+$/g, "").split(".");
    if (parts.length > 1 && isAlpha(word.replaceAll(".", "")) && Math.max(...word.split(".").map((p) => p.length)) < 3) return this.getNNP(word);
    if (word === "a" || word === "A") return ["ˈA", 4];
    if (word === "am" || word === "Am" || word === "AM") return ctx.futureVowel === null || word !== "am" || (stress !== null && stress > 0) ? [this.entry("am", this.golds, null) ?? null, 4] : ["ɐm", 4];
    if (word === "an" || word === "An" || word === "AN") return ["ɐn", 4];
    if (word === "to" || word === "To") return [ctx.futureVowel === null ? (this.entry("to", this.golds, null) ?? null) : ctx.futureVowel ? "tʊ" : "tə", 4];
    if (word === "in" || word === "In" || word === "IN") return [`${PRIMARY}ɪn`, 4];
    if (word === "the" || word === "The") return [ctx.futureVowel === true ? "ði" : "ðə", 4];
    if (word === "used" || word === "Used" || word === "USED") {
      const u = this.golds.used;
      return [typeof u === "object" && u ? (u.DEFAULT ?? null) : (u ?? null), 4];
    }
    return [null, null];
  }

  isKnown(word: string): boolean {
    if (word in this.golds || word in SYMBOLS || word in this.silvers) return true;
    if (!isAlpha(word) || !isLexiconWord(word)) return false;
    if (word.length === 1) return true;
    if (word === word.toUpperCase() && word.toLowerCase() in this.golds) return true;
    return word.slice(1) === word.slice(1).toUpperCase();
  }

  lookup(word: string, stress: number | null, ctx: WordContext | null): Lookup {
    let isNNP: boolean | null = null;
    if (word === word.toUpperCase() && !(word in this.golds)) {
      word = word.toLowerCase();
      isNNP = false; // misaki: tag == "NNP"; untagged here
    }
    let ps = this.entry(word, this.golds, ctx);
    let rating = 4;
    if (ps === undefined && !isNNP) {
      ps = this.entry(word, this.silvers, ctx);
      rating = 3;
    }
    if (ps === undefined || ps === null) {
      const [n, r] = this.getNNP(word);
      if (n !== null) return [n, r];
      return [null, null];
    }
    return [applyStress(ps, stress), rating];
  }

  private s(stem: string | null): string | null {
    if (!stem) return null;
    const last = stem.at(-1)!;
    if ("ptkfθ".includes(last)) return `${stem}s`;
    if ("szʃʒʧʤ".includes(last)) return `${stem}ᵻz`;
    return `${stem}z`;
  }

  stemS(word: string, stress: number | null, ctx: WordContext): Lookup {
    if (word.length < 3 || !word.endsWith("s")) return [null, null];
    let stem: string;
    if (!word.endsWith("ss") && this.isKnown(word.slice(0, -1))) stem = word.slice(0, -1);
    else if ((word.endsWith("'s") || (word.length > 4 && word.endsWith("es") && !word.endsWith("ies"))) && this.isKnown(word.slice(0, -2))) stem = word.slice(0, -2);
    else if (word.length > 4 && word.endsWith("ies") && this.isKnown(`${word.slice(0, -3)}y`)) stem = `${word.slice(0, -3)}y`;
    else return [null, null];
    const [ps, rating] = this.lookup(stem, stress, ctx);
    return [this.s(ps), rating];
  }

  private ed(stem: string | null): string | null {
    if (!stem) return null;
    const last = stem.at(-1)!;
    if ("pkfθʃsʧ".includes(last)) return `${stem}t`;
    if (last === "d") return `${stem}ᵻd`;
    if (last !== "t") return `${stem}d`;
    if (stem.length < 2) return `${stem}ɪd`;
    if (US_TAUS.has(stem.at(-2)!)) return `${stem.slice(0, -1)}ɾᵻd`;
    return `${stem}ᵻd`;
  }

  stemEd(word: string, stress: number | null, ctx: WordContext): Lookup {
    if (word.length < 4 || !word.endsWith("d")) return [null, null];
    let stem: string;
    if (!word.endsWith("dd") && this.isKnown(word.slice(0, -1))) stem = word.slice(0, -1);
    else if (word.length > 4 && word.endsWith("ed") && !word.endsWith("eed") && this.isKnown(word.slice(0, -2))) stem = word.slice(0, -2);
    else return [null, null];
    const [ps, rating] = this.lookup(stem, stress, ctx);
    return [this.ed(ps), rating];
  }

  private ing(stem: string | null): string | null {
    if (!stem) return null;
    if (stem.length > 1 && stem.at(-1) === "t" && US_TAUS.has(stem.at(-2)!)) return `${stem.slice(0, -1)}ɾɪŋ`;
    return `${stem}ɪŋ`;
  }

  stemIng(word: string, stress: number | null, ctx: WordContext): Lookup {
    if (word.length < 5 || !word.endsWith("ing")) return [null, null];
    let stem: string;
    if (word.length > 5 && this.isKnown(word.slice(0, -3))) stem = word.slice(0, -3);
    else if (this.isKnown(`${word.slice(0, -3)}e`)) stem = `${word.slice(0, -3)}e`;
    else if (word.length > 5 && /([bcdgklmnprstvxz])\1ing$|cking$/.test(word) && this.isKnown(word.slice(0, -4))) stem = word.slice(0, -4);
    else return [null, null];
    const [ps, rating] = this.lookup(stem, stress, ctx);
    return [this.ing(ps), rating];
  }

  /** misaki `get_word` (untagged). */
  getWord(word: string, stress: number | null, ctx: WordContext): Lookup {
    const special = this.getSpecialCase(word, stress, ctx);
    if (special[0] !== null) return special;
    const wl = word.toLowerCase();
    if (
      word.length > 1 &&
      isAlpha(word.replaceAll("'", "")) &&
      word !== wl &&
      !(word in this.golds) &&
      !(word in this.silvers) &&
      (word === word.toUpperCase() || word.slice(1) === word.slice(1).toLowerCase()) &&
      (wl in this.golds || wl in this.silvers || [this.stemS(wl, stress, ctx), this.stemEd(wl, stress, ctx), this.stemIng(wl, stress, ctx)].some((r) => r[0] !== null))
    )
      word = wl;
    if (this.isKnown(word)) return this.lookup(word, stress, ctx);
    if (word.endsWith("s'") && this.isKnown(`${word.slice(0, -2)}'s`)) return this.lookup(`${word.slice(0, -2)}'s`, stress, ctx);
    if (word.endsWith("'") && this.isKnown(word.slice(0, -1))) return this.lookup(word.slice(0, -1), stress, ctx);
    for (const r of [this.stemS(word, stress, ctx), this.stemEd(word, stress, ctx), this.stemIng(word, stress === null ? 0.5 : stress, ctx)]) if (r[0] !== null) return r;
    return [null, null];
  }
}

/* ─── Numbers (misaki: num2words) ─────────────────────────────────────── */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** An integer 0 … 999,999,999,999 in English words (num2words' cardinal, without "and"). */
export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) throw new RangeError(`numberWords: ${n}`);
  if (n < 20) return ONES[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ""}`;
  for (const [size, name] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]] as const) if (n >= size) return `${numberWords(Math.floor(n / size))} ${name}${n % size ? ` ${numberWords(n % size)}` : ""}`;
  return String(n);
}

/* ─── Text → phonemes ─────────────────────────────────────────────────── */

export interface G2PToken {
  text: string;
  phonemes: string | null;
  rating: number | null;
}

const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*|\d+(?:,\d{3})*|[%&+@]|[.,!?;:—–-]/g;

/**
 * English text → phonemes, word by word (misaki's token loop, untagged):
 * each word's context is whether the next one starts with a vowel sound.
 * `unk` stands for a word the dictionaries do not know.
 */
export function phonemizeEnglish(text: string, lex: EnglishLexicon, unk = "❓"): { phonemes: string; tokens: G2PToken[] } {
  const raw = (text.replaceAll("’", "'").match(WORD_RE) ?? []).flatMap((w) => (/^\d/.test(w) ? numberWords(Number(w.replaceAll(",", ""))).split(/[\s-]+/) : [w]));
  const tokens: G2PToken[] = [];
  let next: string | null = null;
  // Right to left, as misaki resolves future_vowel from the following token's phonemes.
  for (let i = raw.length - 1; i >= 0; i--) {
    const w = raw[i]!;
    if (/^[.,!?;:—–-]$/.test(w)) {
      tokens.unshift({ text: w, phonemes: w, rating: 4 });
      next = null;
      continue;
    }
    const ctx: WordContext = { futureVowel: next === null ? null : VOWELS.has([...next.replace(/[ˈˌ]/g, "")][0] ?? ""), futureTo: raw[i + 1]?.toLowerCase() === "to" };
    const [ps, rating] = lex.getWord(w, null, ctx);
    tokens.unshift({ text: w, phonemes: ps, rating });
    next = ps;
  }
  let out = "";
  for (const t of tokens) {
    const p = t.phonemes ?? unk;
    out += /^[.,!?;:]$/.test(p) || !out ? p : ` ${p}`;
  }
  return { phonemes: out.trim(), tokens };
}

/**
 * Kokoro's input: its voice's config maps each phoneme character to a token
 * id (`vocab`); a character it lacks (❓, an unknown word) is dropped.
 */
export function kokoroTokens(phonemes: string, vocab: Readonly<Record<string, number>>): number[] {
  const out: number[] = [];
  for (const c of phonemes) {
    const id = vocab[c];
    if (id !== undefined) out.push(id);
  }
  return out;
}
