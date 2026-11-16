/**
 * The fact guard of the rewriting agents (plans W13.W4, W13.W5): a rewrite
 * may change words, tone and length, but not the facts. Checked without a
 * model, by comparing the source and the rewrite:
 *  - numbers: every number (digits, with a decimal point, thousands
 *    separators, %, and the common number words in Hebrew and English);
 *  - names: entities from the on-device NER when the app has one
 *    (W11.H11, passed in as `entities`), plus what can be found without
 *    it: capitalised words that do not start a sentence, acronyms with
 *    gershayim (צה״ל), words after a title (ד״ר, מר, Dr.), quoted strings,
 *    links, wiki links, @mentions and Latin words inside Hebrew text;
 *  - negation: the count of negating words per language (a rewrite that
 *    drops a "not" or adds one flips the meaning).
 * The report lists what was lost and what was added; the agents block a
 * rewrite that lost or invented anything.
 */
import { stripNiqqud } from "../../text/hebrew";
import type { WritingLang } from "./agent";

export interface FactSet {
  numbers: string[];
  names: string[];
  negations: number;
}

export interface FactReport {
  ok: boolean;
  lostNumbers: string[];
  addedNumbers: string[];
  lostNames: string[];
  addedNames: string[];
  /** rewrite negations − source negations (0 = same polarity). */
  negationDelta: number;
}

/** A name finder from the app's NER (W11.H11): text → entity strings. */
export type EntityFinder = (text: string) => string[];

const NUMBER_WORDS_EN: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", twenty: "20", thirty: "30", forty: "40", fifty: "50", hundred: "100", thousand: "1000", million: "1000000", dozen: "12",
  first: "1st", second: "2nd", third: "3rd", half: "0.5",
};
const NUMBER_WORDS_HE: Record<string, string> = {
  אפס: "0", אחד: "1", אחת: "1", שניים: "2", שתיים: "2", שני: "2", שתי: "2", שלושה: "3", שלוש: "3", ארבעה: "4", ארבע: "4", חמישה: "5", חמש: "5",
  שישה: "6", שש: "6", שבעה: "7", שבע: "7", שמונה: "8", תשעה: "9", תשע: "9", עשרה: "10", עשר: "10", עשרים: "20", שלושים: "30", ארבעים: "40",
  חמישים: "50", מאה: "100", מאות: "100s", אלף: "1000", אלפים: "1000s", מיליון: "1000000", חצי: "0.5", ראשון: "1st", ראשונה: "1st", שנייה: "2nd", שלישי: "3rd", שלישית: "3rd",
};
const HE_PREFIX = /^[והבלמשכ]{1,3}(?=[א-ת]{2,})/;

/** Negating words; "n't" counts once per contraction. */
const NEG_EN = /\b(?:not|no|never|none|nobody|nothing|neither|nor|without|nowhere|cannot)\b|n['’]t\b/gi;
const NEG_HE = /(?:^|[\s(«"״'׳\-־])(?:[וש]?(?:לא|אין|אינו|אינה|אינם|אינן|אינני|איני|אל|בלי|ללא|מבלי|אף|שום|מעולם|לעולם))(?=$|[\s.,;:!?)»"״\-־])/g;

/** The words a text writes in lower case (a capitalised form of one of them is not a name). */
export function lowerWords(...texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/(?<![\p{L}])[\p{Ll}][\p{L}'’\-]*/gu)) out.add(m[0]);
  return out;
}

const norm = (s: string) => stripNiqqud(s).replace(/[‎‏‪-‮⁦-⁩]/g, "");

/** Numbers as canonical strings: "1,200" = "1200", "3.0" stays "3.0", "שלושה" = "3". */
export function numbersIn(text: string, lang: WritingLang): string[] {
  const t = norm(text);
  const out: string[] = [];
  for (const m of t.matchAll(/\d[\d,.]*\d|\d/g)) {
    const raw = m[0];
    // A thousands separator, not a decimal point: 1,200 / 1,200,000.
    const v = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw) ? raw.replace(/,/g, "") : raw.replace(/,$/, "");
    out.push(v);
  }
  const words = t.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  for (const w of words) {
    if (lang === "en" || /^[a-z]+$/.test(w)) {
      if (NUMBER_WORDS_EN[w]) out.push(NUMBER_WORDS_EN[w]);
    }
    if (/[א-ת]/.test(w)) {
      const bare = NUMBER_WORDS_HE[w] ? w : w.replace(HE_PREFIX, "");
      if (NUMBER_WORDS_HE[bare]) out.push(NUMBER_WORDS_HE[bare]);
    }
  }
  return out.sort();
}

const TITLES_HE = /(?:^|\s)(?:ד["״]ר|פרופ['׳]?|פרופסור|מר|גב['׳]|גברת|עו["״]ד|רו["״]ח|הרב|רב|השר|השרה|ח["״]כ|סגן|רס["״]ן|אלוף|תא["״]ל|נשיא|נשיאת)\s+([א-ת][א-ת'׳"״\-]+(?:\s+[א-ת][א-ת'׳"״\-]+)?)/g;
const ACRONYM_HE = /[א-ת]+[״"][א-ת]/g;
const STOP_CAPS = new Set(["I", "The", "A", "An", "This", "That", "These", "Those", "It", "We", "You", "He", "She", "They", "In", "On", "At", "For", "But", "And", "Or", "If", "When", "While", "As", "So", "To", "Of", "By", "With", "Our", "My", "Your", "Their", "His", "Her", "Its", "Please", "Thanks", "Hi", "Hello", "Dear", "Yes", "No", "OK", "Also", "However", "Then", "There", "Here", "What", "Why", "How", "Who", "Each", "Every", "All", "Some", "Most", "Many", "After", "Before", "Since", "Because", "Although", "Even", "Just", "Only", "Not", "Yesterday", "Today", "Tomorrow", "Now", "Later", "Soon", "Still", "Yet", "Next", "Last", "Finally", "First", "Second", "Third", "Overall", "Unfortunately", "Fortunately", "Honestly", "Basically", "Actually", "Really", "Perhaps", "Maybe", "Hey", "Sorry", "Kindly", "Note", "Let", "Let's", "Don't", "Do", "Does", "Did", "Is", "Are", "Was", "Were", "Will", "Would", "Can", "Could", "Should", "Must", "May", "Might", "One", "Two", "Three", "Both", "Either", "Neither", "Nor", "Other", "Another", "Such", "Thus", "Therefore", "Moreover", "Furthermore", "Meanwhile", "Instead", "Otherwise", "Indeed", "Of", "From", "Into", "About", "During", "Without", "Within", "Through", "Under", "Over", "Again", "Once", "Very", "Quite", "Too", "Much", "More", "Less", "Few", "Several", "Any", "Anyone", "Everyone", "Someone", "Nobody", "Nothing", "Everything", "Something", "Which", "Where", "Whose", "Whom"]);
const DAYS_MONTHS = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)$/;

/** The names a text mentions (see the file note), lower-cased, Hebrew prefixes kept as written. */
export function namesIn(text: string, lang: WritingLang, entities?: EntityFinder, vocab: ReadonlySet<string> = lowerWords(text)): string[] {
  const t = norm(text);
  const out = new Set<string>();
  for (const e of entities?.(t) ?? []) out.add(e.trim().toLowerCase());
  for (const m of t.matchAll(/\[\[([^\]|#]+)/g)) out.add(m[1].trim().toLowerCase());
  for (const m of t.matchAll(/https?:\/\/[^\s)>\]]+/g)) out.add(m[0].replace(/[.,;:]$/, "").toLowerCase());
  for (const m of t.matchAll(/(?:^|\s)@([\p{L}\p{N}_.-]+)/gu)) out.add(`@${m[1].toLowerCase()}`);
  for (const m of t.matchAll(/["“”«»]([^"“”«»\n]{2,60})["“”«»]/g)) if (!/^[א-ת]{1,2}$/.test(m[1])) out.add(m[1].trim().toLowerCase());
  // Capitalised words (and runs of them: "Tel Aviv"). At the start of a sentence a capital says
  // nothing, so a lone first word counts only when it is not a common word: not a stop word, and
  // never written in lower case in this text or the one it is compared with (`vocab`).
  for (const s of t.split(/(?<=[.!?:;])\s+|\n+/)) {
    for (const m of s.matchAll(/[\p{Lu}][\p{L}'’\-]*(?:\s+(?:of\s+|de\s+|van\s+)?[\p{Lu}][\p{L}'’\-]*)*/gu)) {
      let words = m[0].split(/\s+/);
      const atStart = !s.slice(0, m.index).replace(/^[\s"“'(\-*#>]+/, "");
      if (atStart && STOP_CAPS.has(words[0])) words = words.slice(1);
      if (!words.length) continue;
      const phrase = words.join(" ").replace(/['’]s$/, "");
      if (STOP_CAPS.has(phrase) || DAYS_MONTHS.test(phrase)) continue;
      if (atStart && words.length === 1 && m[0].split(/\s+/).length === 1 && (vocab.has(phrase.toLowerCase()) || /(?:ly|ing|ed)$/.test(phrase))) continue;
      out.add(phrase.toLowerCase());
    }
  }
  if (lang === "he") {
    for (const m of t.matchAll(TITLES_HE)) out.add(m[1].replace(/\s+/g, " ").toLowerCase());
    for (const m of t.matchAll(ACRONYM_HE)) out.add(m[0].replace(/"/g, "״"));
    // Latin words inside Hebrew text are names or terms (iPhone, Python, NASA).
    for (const m of t.matchAll(/[A-Za-z][\w.+\-]*[A-Za-z0-9+]|[A-Za-z]/g)) if (m[0].length > 1) out.add(m[0].toLowerCase());
  }
  return [...out].sort();
}

export function negationsIn(text: string, lang: WritingLang): number {
  const t = norm(text);
  return (lang === "he" ? (t.match(NEG_HE)?.length ?? 0) + (t.match(NEG_EN)?.length ?? 0) * (/[A-Za-z]{3}/.test(t) ? 1 : 0) : (t.match(NEG_EN)?.length ?? 0));
}

export function factsOf(text: string, lang: WritingLang, entities?: EntityFinder, vocab?: ReadonlySet<string>): FactSet {
  return { numbers: numbersIn(text, lang), names: namesIn(text, lang, entities, vocab), negations: negationsIn(text, lang) };
}

/** Multiset difference a − b. */
function minus(a: readonly string[], b: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const x of b) left.set(x, (left.get(x) ?? 0) + 1);
  const out: string[] = [];
  for (const x of a) {
    const n = left.get(x) ?? 0;
    if (n > 0) left.set(x, n - 1);
    else out.push(x);
  }
  return out;
}

/** A name of `a` that `text` still contains (a name may be inflected with a Hebrew prefix: "לדנה" has "דנה"). */
function contains(text: string, name: string): boolean {
  const t = norm(text).toLowerCase();
  if (t.includes(name)) return true;
  const bare = name.replace(HE_PREFIX, "");
  return bare !== name && t.includes(bare);
}

export interface FactCheckOptions {
  entities?: EntityFinder;
  /** Lost facts are allowed (a summary may leave details out); added ones never are. */
  allowLoss?: boolean;
  /** Negation may differ (only when the user asked for it). */
  ignoreNegation?: boolean;
}

/**
 * What a rewrite did to the facts of its source. Numbers are compared as a
 * set of values (a repeated number may be said once); names by presence in
 * the other text, so "Dana" → "Dana's" or "דנה" → "לדנה" is not a change.
 */
export function checkFacts(source: string, rewrite: string, lang: WritingLang, o: FactCheckOptions = {}): FactReport {
  const vocab = lowerWords(source, rewrite);
  const a = factsOf(source, lang, o.entities, vocab);
  const b = factsOf(rewrite, lang, o.entities, vocab);
  const uniq = (xs: string[]) => [...new Set(xs)];
  const lostNumbers = minus(uniq(a.numbers), uniq(b.numbers));
  const addedNumbers = minus(uniq(b.numbers), uniq(a.numbers));
  const lostNames = a.names.filter((n) => !contains(rewrite, n) && !b.names.includes(n));
  const addedNames = b.names.filter((n) => !contains(source, n) && !a.names.includes(n));
  const negationDelta = b.negations - a.negations;
  const ok = (o.allowLoss || (!lostNumbers.length && !lostNames.length)) && !addedNumbers.length && !addedNames.length && (o.ignoreNegation || negationDelta === 0);
  return { ok, lostNumbers, addedNumbers, lostNames, addedNames, negationDelta };
}

/** One line for a blocked card: what the rewrite changed. */
export function factProblem(r: FactReport, lang: WritingLang): string {
  const parts: string[] = [];
  const he = lang === "he";
  if (r.lostNumbers.length) parts.push(`${he ? "מספרים שנעלמו" : "numbers lost"}: ${r.lostNumbers.join(", ")}`);
  if (r.addedNumbers.length) parts.push(`${he ? "מספרים שנוספו" : "numbers added"}: ${r.addedNumbers.join(", ")}`);
  if (r.lostNames.length) parts.push(`${he ? "שמות שנעלמו" : "names lost"}: ${r.lostNames.join(", ")}`);
  if (r.addedNames.length) parts.push(`${he ? "שמות שנוספו" : "names added"}: ${r.addedNames.join(", ")}`);
  if (r.negationDelta) parts.push(he ? "השלילה השתנתה" : "a negation changed");
  return parts.join("; ");
}
