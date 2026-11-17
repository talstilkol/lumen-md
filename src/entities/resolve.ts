/**
 * Hebrew entity resolution (plan W12.E3): "לירושלים", "בירושלים" and
 * "שבירושלים" are one entity; "משה" is never cut to "שה", nor "ברק" to "רק".
 *
 * 1. Normal form: NFC, niqqud and cantillation out, final letters folded,
 *    geresh/gershayim and quotes out, maqaf and hyphens to a space.
 * 2. Prefixes (ו ה ב כ ל מ ש, and their runs: וב, ומה, שב, כש, וכש …) are
 *    removed only when what remains is a known entity or alias. The whole
 *    word wins when it is itself known. When nothing known remains, a word
 *    in the built-in list of names that start with a prefix letter is kept
 *    as it is, and only then may a lexicon word be taken.
 *    Spelling facts handled: after ב/כ/ל the article ה is swallowed
 *    ("בבית" = ב + הבית), and a word-initial ו is doubled after a prefix
 *    ("בווינה" = ב + וינה).
 * 3. Plurals and construct forms go through the lemmatizer seam (W11.H12,
 *    #708) when one is given; without it, only the regular endings
 *    (ים/ות/ת) are tried, and only toward a known entity.
 * 4. Ktiv male / haser: a key without inner ו/י matches the other spelling.
 * 5. Aliases: each entity's other names (Hebrew and English) index to it.
 *
 * A match scores 0..1; above `AUTO_LINK` it links, below it becomes a
 * proposal for review (W12.E5). Accuracy is measured against NEMO's
 * gold morpheme segmentation in W12.E9, not here.
 *
 * Design reference only: IsraelConnect's Hebrew name normalisation and
 * prefix rules (owner's AGPL repo). This file is a clean implementation.
 */
import type { Entity } from "./model";

export const AUTO_LINK = 0.9;

const PREFIX = new Set(["ו", "ה", "ב", "כ", "ל", "מ", "ש"]);
const FINALS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
const TO_FINAL: Record<string, string> = { כ: "ך", מ: "ם", נ: "ן", פ: "ף", צ: "ץ" };

/** Comparison form of a name (see 1. above). */
export function normName(s: string): string {
  return s
    .normalize("NFC")
    .replace(/־/g, " ")
    .replace(/[֑-ׇ]/g, "")
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/["'`׳״‘’“”]/g, "")
    .replace(/[־‐-―\-]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The same word with its last letter in final form, for display ("שלומ" → "שלום"). */
export function withFinal(word: string): string {
  const last = word.slice(-1);
  return TO_FINAL[last] ? word.slice(0, -1) + TO_FINAL[last] : word;
}

/** Ktiv-haser key: inner ו and י dropped (first and last letters kept). */
export function haserKey(s: string): string {
  return normName(s)
    .split(" ")
    .map((w) => (w.length > 2 ? w[0] + w.slice(1, -1).replace(/[וי]/g, "") + w.slice(-1) : w))
    .join(" ");
}

/**
 * Given names and places that begin with a prefix letter, so look like a
 * prefix plus a word: kept whole when nothing known says otherwise.
 * A plain list of common names (no corpus data).
 */
export const PREFIX_LOOKING_NAMES: ReadonlySet<string> = new Set(
  [
    "משה", "מרים", "מיכאל", "מיכל", "מנחם", "מאיר", "מרדכי", "מתן", "מתתיהו", "מלכה", "מעיין", "מורן", "מאיה",
    "שמעון", "שלמה", "שרה", "שמואל", "שלום", "שולמית", "שושנה", "שירה", "שחר", "שני", "שגיא", "שאול", "שמשון",
    "ברק", "ברכה", "בנימין", "בועז", "בתיה", "בלהה", "ברוך", "בני", "בצלאל",
    "לוד", "לאה", "ליאור", "לבנה", "לוי", "ליה", "לירון", "לימור",
    "כרמל", "כנרת", "כלב", "כרמית",
    "הדס", "הלל", "הדר", "הילה", "הודיה", "הושע", "הרצליה",
    "ורד", "ושתי",
    "בית שאן", "בית שמש", "באר שבע", "בני ברק", "בת ים", "מודיעין", "מטולה", "מגדל העמק", "שדרות", "שוהם", "לכיש",
    "בבל", "ברזיל", "בלגיה", "מצרים", "מרוקו", "הודו", "הונגריה", "לבנון", "כווית", "שוויץ", "שוודיה",
  ].map(normName),
);

export interface ResolverOptions {
  /** A word's lemma(s), from the W11.H12 lemmatizer seam, when there is one. */
  lemmatize?: (word: string) => readonly string[];
  /** Common words (a Hebrew lexicon), for non-entity tokens. */
  lexicon?: ReadonlySet<string>;
}

export interface Match {
  entity: string | null;
  /** The form that matched (normalised), or the mention's own when none did. */
  key: string;
  /** Letters cut from the front (the prefix), "" when none. */
  prefix: string;
  how: "exact" | "alias" | "prefix" | "lemma" | "haser" | "fuzzy" | "kept-name" | "lexicon" | "none";
  score: number;
}

/** Prefix splits of a word: [prefix, stem] for every run of up to three prefix letters, stem ≥ 2 letters. */
export function prefixSplits(word: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 1; i <= 3 && i < word.length - 1; i++) {
    if (!PREFIX.has(word[i - 1])) break;
    const p = word.slice(0, i);
    // ה only directly before the stem (ו־ה, ש־ה, מ־ה…), never twice; ו only first.
    if (p.slice(0, -1).includes("ה") || p.slice(1).includes("ו")) break;
    out.push([p, word.slice(i)]);
  }
  return out;
}

/** Stems to try for one split: the stem, with ה restored after ב/כ/ל, and with a doubled ו reduced. */
function stemForms(prefix: string, stem: string): string[] {
  const forms = [stem];
  const last = prefix.slice(-1);
  if ("בכל".includes(last)) forms.push(`ה${stem}`);
  if (stem.startsWith("וו") && last !== "ה") forms.push(stem.slice(1));
  return forms;
}

/** Plural and construct guesses toward a singular, used only to reach a known entity. */
function regularSingulars(word: string): string[] {
  const out: string[] = [];
  // Normalised forms: finals are folded, so the masculine plural ends in "ימ".
  if (word.endsWith("ימ") && word.length > 3) out.push(word.slice(0, -2));
  if (word.endsWith("ות") && word.length > 3) out.push(word.slice(0, -2) + "ה", word.slice(0, -2));
  if (word.endsWith("ת") && word.length > 2) out.push(word.slice(0, -1) + "ה");
  if (word.endsWith("י") && word.length > 2) out.push(word.slice(0, -1) + "ימ");
  return out;
}

/** Jaro–Winkler similarity in [0, 1] (Winkler 1990; prefix scale 0.1, up to 4 letters). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  const A = [...a];
  const B = [...b];
  if (!A.length || !B.length) return 0;
  const span = Math.max(0, Math.floor(Math.max(A.length, B.length) / 2) - 1);
  const usedB = new Array<boolean>(B.length).fill(false);
  const matchA: string[] = [];
  const posA: number[] = [];
  A.forEach((c, i) => {
    for (let j = Math.max(0, i - span); j <= Math.min(B.length - 1, i + span); j++) {
      if (!usedB[j] && B[j] === c) {
        usedB[j] = true;
        matchA.push(c);
        posA.push(i);
        return;
      }
    }
  });
  const m = matchA.length;
  if (!m) return 0;
  const matchB = B.filter((_, j) => usedB[j]);
  let half = 0;
  for (let k = 0; k < m; k++) if (matchA[k] !== matchB[k]) half++;
  const t = half / 2;
  const jaro = (m / A.length + m / B.length + (m - t) / m) / 3;
  let l = 0;
  while (l < 4 && l < A.length && l < B.length && A[l] === B[l]) l++;
  return jaro + l * 0.1 * (1 - jaro);
}

/** An index of known entities by every name they go by. */
export class EntityIndex {
  private byKey = new Map<string, Set<string>>();
  private byHaser = new Map<string, Set<string>>();
  private names: Array<[string, string]> = [];

  constructor(entities: ReadonlyArray<Pick<Entity, "id" | "name" | "aliases">> = []) {
    for (const e of entities) this.add(e);
  }

  add(e: Pick<Entity, "id" | "name" | "aliases">): void {
    for (const n of [e.name, ...e.aliases]) {
      const k = normName(n);
      if (!k) continue;
      const put = (m: Map<string, Set<string>>, key: string) => (m.get(key) ?? m.set(key, new Set()).get(key)!).add(e.id);
      put(this.byKey, k);
      put(this.byHaser, haserKey(n));
      this.names.push([k, e.id]);
    }
  }

  /** The one entity a normalised key names, or null (unknown, or two share it). */
  lookup(key: string): string | null {
    const s = this.byKey.get(key);
    return s && s.size === 1 ? [...s][0] : null;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  lookupHaser(text: string): string | null {
    const s = this.byHaser.get(haserKey(text));
    return s && s.size === 1 ? [...s][0] : null;
  }

  /** The closest name by Jaro–Winkler, if any reaches `min`. */
  nearest(key: string, min = 0.85): { entity: string; score: number } | null {
    let best: { entity: string; score: number } | null = null;
    for (const [k, id] of this.names) {
      const [lo, hi] = k.length < key.length ? [k.length, key.length] : [key.length, k.length];
      if (hi - lo > 3 || lo / hi < 0.75) continue;
      const s = jaroWinkler(key, k);
      if (s >= min && (!best || s > best.score)) best = { entity: id, score: s };
    }
    return best;
  }
}

/**
 * Resolve a mention's text to an entity (see the file comment for the
 * order). Multi-word mentions: only the first word may carry a prefix
 * ("ובבית שמש" → "בית שמש").
 */
export function resolveMention(text: string, index: EntityIndex, opts: ResolverOptions = {}): Match {
  const key = normName(text);
  if (!key) return { entity: null, key, prefix: "", how: "none", score: 0 };
  const exact = index.lookup(key);
  if (exact) return { entity: exact, key, prefix: "", how: "exact", score: 1 };
  const [first, ...rest] = key.split(" ");
  const tail = rest.length ? ` ${rest.join(" ")}` : "";
  const hebrew = /[א-ת]/.test(first);

  // A name that only looks like prefix + word ("משה", "ברק", "לוד") is never cut, even toward a known "שה".
  const lookingName = PREFIX_LOOKING_NAMES.has(key);
  // 2. A prefix, toward a known entity (fewest letters cut first).
  if (hebrew && !lookingName) {
    for (const [p, stem] of prefixSplits(first)) {
      for (const f of stemForms(p, stem)) {
        const id = index.lookup(f + tail);
        if (id) return { entity: id, key: f + tail, prefix: p, how: "prefix", score: 0.97 };
      }
    }
  }
  // 3. Lemmas and regular plurals, with or without a prefix.
  const lastWord = rest.length ? rest[rest.length - 1] : first;
  const head = rest.length ? key.slice(0, key.length - lastWord.length) : "";
  if (hebrew) {
    const candidates: Array<[string, string]> = [["", key]];
    if (!rest.length && !lookingName) for (const [p, stem] of prefixSplits(first)) for (const f of stemForms(p, stem)) candidates.push([p, f]);
    for (const [p, form] of candidates) {
      const w = rest.length ? lastWord : form;
      const pre = rest.length ? head : "";
      const lemmas = [...(opts.lemmatize?.(withFinal(w)) ?? []).map(normName), ...regularSingulars(w)];
      for (const l of lemmas) {
        const id = index.lookup(pre + l);
        if (id) return { entity: id, key: pre + l, prefix: p, how: "lemma", score: opts.lemmatize ? 0.93 : 0.9 };
      }
    }
  }
  // 4. The other spelling (ktiv male / haser).
  const haser = index.lookupHaser(key);
  if (haser) return { entity: haser, key, prefix: "", how: "haser", score: 0.92 };
  // Nothing known: keep a prefix-looking name whole; then a lexicon word.
  if (lookingName || PREFIX_LOOKING_NAMES.has(first)) {
    const near = index.nearest(key);
    return near ? { entity: near.entity, key, prefix: "", how: "fuzzy", score: Math.min(0.89, near.score) } : { entity: null, key, prefix: "", how: "kept-name", score: 0 };
  }
  if (hebrew && opts.lexicon && !rest.length) {
    for (const [p, stem] of prefixSplits(first)) for (const f of stemForms(p, stem)) if (opts.lexicon.has(f) || opts.lexicon.has(withFinal(f))) return { entity: null, key: f, prefix: p, how: "lexicon", score: 0 };
  }
  // 5. A near spelling: a proposal, never an automatic link.
  const near = index.nearest(key);
  if (near) return { entity: near.entity, key, prefix: "", how: "fuzzy", score: Math.min(0.89, near.score) };
  return { entity: null, key, prefix: "", how: "none", score: 0 };
}

/** The stem a mention stands for once its prefix is cut ("לירושלים" → "ירושלים"), for display and new entities. */
export function mentionStem(text: string, index: EntityIndex, opts: ResolverOptions = {}): string {
  const m = resolveMention(text, index, opts);
  if (!m.prefix) return text.trim();
  const words = text.trim().split(/\s+/);
  // Cut the same number of letters from the first word as written (niqqud kept out of the count).
  let letters = 0;
  let cut = 0;
  const w = words[0];
  while (cut < w.length && letters < m.prefix.length) {
    if (/[א-ת]/.test(w[cut])) letters++;
    cut++;
    while (cut < w.length && /[֑-ׇ]/.test(w[cut])) cut++;
  }
  words[0] = w.slice(cut);
  if ("בכל".includes(m.prefix.slice(-1)) && m.key.startsWith("ה") && !normName(words[0]).startsWith("ה")) words[0] = `ה${words[0]}`;
  return words.join(" ");
}

/** Whether a match links by itself, or waits for review. */
export const autoLinks = (m: Match) => m.entity !== null && m.score >= AUTO_LINK;
