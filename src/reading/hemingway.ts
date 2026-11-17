/**
 * Readability highlights (plan W13.R2), in the manner of Hemingway: long
 * and very long sentences, passive voice, adverbs (and, in Hebrew, adverbial
 * phrases), and complex words that have a simpler one. A display layer only:
 * nothing here changes the note; the editor draws the findings as
 * decorations (src/editor/focusLayer.ts).
 *
 * Two sources:
 *  - the clarity and style coach of plan W13.W3, when it is there: its
 *    suggestions (W13.W1's WritingSuggestion, a type-only import) are
 *    mapped onto these five kinds (`fromSuggestions`, HEMINGWAY_OF_KIND);
 *  - otherwise, these local rules — deterministic, no model, ≤ 150 ms for a
 *    long note (src/__tests__/hemingwayOverlay.test.ts).
 *
 * Hebrew rules: sentence length counts words as written (a prefixed word is
 * one word), so its limits are lower (16 / 25 against 20 / 30 in English,
 * since Hebrew packs prepositions and articles into the word); passive is a
 * passive form with "על ידי" or the binyanim's passive participle with
 * "נעשה / בוצע / הוחלט"; adverbial phrases are "באופן …", "בצורה …"; the
 * complex-word list holds bureaucratic phrases with a plain alternative.
 */
import { langOf, paragraphAt, sentencesIn, type Span } from "./focusUnits";
import type { SuggestionKind, WritingSuggestion } from "../agents/writing/suggestion";

export const HEMINGWAY_KINDS = ["veryLong", "long", "passive", "adverb", "complex"] as const;
export type HemingwayKind = (typeof HEMINGWAY_KINDS)[number];

export interface HemingwayFinding extends Span {
  kind: HemingwayKind;
  /** A simpler word, for "complex". */
  simpler?: string;
}

export const LIMITS = { en: { long: 20, veryLong: 30 }, he: { long: 16, veryLong: 25 } } as const;

const EN_COMPLEX: Record<string, string> = {
  utilize: "use",
  utilise: "use",
  utilization: "use",
  facilitate: "help",
  commence: "begin",
  terminate: "end",
  approximately: "about",
  subsequently: "later",
  additional: "more",
  demonstrate: "show",
  endeavor: "try",
  endeavour: "try",
  numerous: "many",
  purchase: "buy",
  assistance: "help",
  sufficient: "enough",
  individuals: "people",
  obtain: "get",
  require: "need",
  modification: "change",
  initiate: "start",
  prioritize: "rank",
  leverage: "use",
  "in order to": "to",
  "due to the fact that": "because",
  "at this point in time": "now",
  "in the event that": "if",
  "with regard to": "about",
};
const HE_COMPLEX: Record<string, string> = {
  "במסגרת": "ב־",
  "בהתאם ל": "לפי",
  "על מנת ש": "כדי ש",
  "על מנת ל": "כדי ל",
  "לאור העובדה ש": "כי",
  "מאחר ש": "כי",
  "בעקבות": "אחרי",
  "ביצוע": "עשייה",
  "לבצע": "לעשות",
  "מבוצע": "נעשה",
  "באמצעות": "ב־",
  "אודות": "על",
  "הינו": "הוא",
  "הינה": "היא",
  "הינם": "הם",
  "כמו כן": "גם",
  "יחד עם זאת": "אבל",
  "בכל הנוגע ל": "לגבי",
};
const EN_ADVERB_OK = new Set(["only", "early", "family", "reply", "apply", "supply", "fly", "july", "italy", "holy", "ugly", "belly", "jelly", "rally", "ally", "bully", "daily", "weekly", "monthly", "yearly", "likely", "friendly", "lonely", "lovely", "silly", "elderly", "curly", "costly", "holly", "lily", "billy", "emily", "sally", "kelly", "molly", "assembly", "anomaly", "reply", "imply", "rely", "comply", "multiply", "butterfly", "firefly"]);
const EN_IRREGULAR_PARTICIPLES = "been|done|made|given|taken|seen|known|shown|written|built|found|held|kept|left|lost|paid|said|sold|sent|spent|told|thought|bought|brought|caught|taught|chosen|driven|eaten|forgotten|frozen|hidden|ridden|spoken|stolen|woken|worn|torn|born|drawn|grown|thrown|begun|broken|run|put|set|cut|hit|hurt|let|read|shut|split|spread|understood|won|led|fed|met|felt";
const EN_PASSIVE = new RegExp(`\\b(am|is|are|was|were|be|been|being|get|gets|got|gotten)\\s+(?:\\w+ly\\s+)?(\\w+ed|${EN_IRREGULAR_PARTICIPLES})\\b`, "gi");
/**
 * Audit r4 A1.3: an -ed word after be/get that is an adjective, not a passive ("is red", "am tired",
 * "is interested in") — unless "by" follows ("was frightened by the noise" is a passive).
 */
const EN_ED_NOT_PASSIVE = new Set("red bed fed led wed shed need seed feed speed weed deed greed breed hundred sacred naked wicked rugged ragged beloved aged crooked tired bored interested excited scared worried married surprised pleased satisfied concerned confused embarrassed exhausted frightened amazed annoyed disappointed relaxed ashamed shocked used supposed advanced talented skilled qualified experienced related limited detailed varied complicated sophisticated dedicated determined committed".split(" "));
// "נכתב על ידי", "הוחלט ע״י", "בוצע ע"י".
const HE_PASSIVE = /(?:^|[\s(])([א-ת]+)\s+(?:על[\s-]ידי|ע["״]י)(?=[\sא-ת])/g;
/**
 * Hebrew passive verbs: pu'al/huf'al past forms, and (audit r4 A1.3) common nif'al past verbs —
 * נשלח, נבנה, נפתחה — inflected (m., f., pl.; ל״ה: נבנה, נבנתה, נבנו). A list, not the pattern נ+root:
 * נכון, נושא, נקודה start the same way and are not verbs.
 */
const HE_NIFAL = "נשלח נבנה נפתח נכתב נאמר נבחר נגנב נהרס נחתם נלקח נמכר נפגע נפצע נרצח נשבר נשמר נתפס נבדק נבחן נדחה נסגר נפתר נקרא נשאל נעצר נחשף נאסר נוצר נערך נכלל נמסר נקבע נעשה נגזר נשכח נזרק נדרש נתבקש נאסף נפרסם".split(" ");
const heInflect = (v: string) => (v.endsWith("ה") ? [v, `${v.slice(0, -1)}תה`, `${v.slice(0, -1)}ו`] : [v, `${v}ה`, `${v}ו`]);
const HE_PASSIVE_FORMS = [...new Set(["בוצע", "בוצעה", "בוצעו", "הוחלט", "הוחלטה", "הוחלטו", "הוגש", "הוגשה", "הוגשו", "הועבר", "הועברה", "הועברו", ...HE_NIFAL.flatMap(heInflect)])];
const HE_PASSIVE_VERB = new RegExp(`(?:^|[\\s(])((?:ו|ש|כש)?(?:${HE_PASSIVE_FORMS.join("|")}))(?=[\\s.,;:!?]|$)`, "g");
const HE_ADVERB = /(?:^|[\s(])((?:ו)?(?:באופן|בצורה)\s+[א-ת]+)/g;

const wordsOf = (s: string) => s.match(/[\p{L}\p{M}\p{N}'׳״"-]+/gu) ?? [];

/** Code, frontmatter and inline code are not prose: blank them out (same length, so offsets hold). */
export function proseOnly(text: string): string {
  let out = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/, (m) => m.replace(/[^\n]/g, " "));
  out = out.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(^\1[^\n]*$|(?![\s\S]))/gm, (m) => m.replace(/[^\n]/g, " "));
  out = out.replace(/`[^`\n]+`/g, (m) => " ".repeat(m.length));
  // Link targets and HTML tags.
  out = out.replace(/\]\([^)\n]*\)/g, (m) => "]" + " ".repeat(m.length - 1));
  return out.replace(/<[^>\n]+>/g, (m) => " ".repeat(m.length));
}

function complexIn(text: string, base: number, he: boolean, out: HemingwayFinding[]): void {
  const list = he ? HE_COMPLEX : EN_COMPLEX;
  for (const [word, simpler] of Object.entries(list)) {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Hebrew: the phrase may carry a prefix letter (ו, ש, ה) and ends at a word end unless it ends in a preposition letter.
    const re = he ? new RegExp(`(?:^|[\\s(])((?:ו|ש|וה|ה)?${esc}${/[לש]$/.test(word) ? "" : "(?=[\\s.,;:!?)]|$)"})`, "g") : new RegExp(`\\b${esc}(?:s|d|ed|es|ing)?\\b`, "gi");
    for (const m of text.matchAll(re)) {
      const hit = he ? m[1] : m[0];
      const at = (m.index ?? 0) + (he ? m[0].length - m[1].length : 0);
      out.push({ from: base + at, to: base + at + hit.length, kind: "complex", simpler });
    }
  }
}

/** The findings for a whole note (or `range` of it), sorted. */
export function analyzeReadability(text: string, range: Span = { from: 0, to: text.length }): HemingwayFinding[] {
  const prose = proseOnly(text);
  const out: HemingwayFinding[] = [];
  let pos = range.from;
  while (pos < range.to) {
    const para = paragraphAt(prose, pos);
    const next = Math.max(para.to + 1, pos + 1);
    const body = prose.slice(para.from, para.to);
    if (body.trim()) {
      const lang = langOf(body);
      const he = lang === "he";
      const lim = LIMITS[lang];
      // A heading or a table row is not a sentence to shorten.
      if (!/^\s{0,3}(#{1,6}\s|\|)/.test(body)) {
        for (const s of sentencesIn(prose, para, lang)) {
          const n = wordsOf(prose.slice(s.from, s.to)).length;
          if (n > lim.veryLong) out.push({ ...s, kind: "veryLong" });
          else if (n > lim.long) out.push({ ...s, kind: "long" });
        }
      }
      if (he) {
        for (const re of [HE_PASSIVE, HE_PASSIVE_VERB]) {
          for (const m of body.matchAll(re)) {
            const at = (m.index ?? 0) + m[0].indexOf(m[1]);
            const end = re === HE_PASSIVE ? (m.index ?? 0) + m[0].length : at + m[1].length;
            out.push({ from: para.from + at, to: para.from + end, kind: "passive" });
          }
        }
        for (const m of body.matchAll(HE_ADVERB)) {
          const at = (m.index ?? 0) + m[0].length - m[1].length;
          out.push({ from: para.from + at, to: para.from + at + m[1].length, kind: "adverb" });
        }
      } else {
        for (const m of body.matchAll(EN_PASSIVE)) {
          const end = (m.index ?? 0) + m[0].length;
          if (EN_ED_NOT_PASSIVE.has(m[2].toLowerCase()) && !/^\s+by\b/i.test(body.slice(end))) continue;
          out.push({ from: para.from + (m.index ?? 0), to: para.from + end, kind: "passive" });
        }
        for (const m of body.matchAll(/\b[A-Za-z]{3,}ly\b/g)) {
          if (!EN_ADVERB_OK.has(m[0].toLowerCase())) out.push({ from: para.from + (m.index ?? 0), to: para.from + (m.index ?? 0) + m[0].length, kind: "adverb" });
        }
      }
      complexIn(body, para.from, he, out);
    }
    pos = next;
  }
  return dedupe(out.filter((f) => f.from >= range.from && f.to <= range.to));
}

/** Sorted; of two findings of one kind that overlap ("הוחלט" and "הוחלט על ידי"), the longer one. */
function dedupe(list: HemingwayFinding[]): HemingwayFinding[] {
  const sorted = list.sort((a, b) => a.from - b.from || b.to - a.to);
  const out: HemingwayFinding[] = [];
  const lastOf = new Map<HemingwayKind, HemingwayFinding>();
  for (const f of sorted) {
    const last = lastOf.get(f.kind);
    if (last && f.from < last.to) {
      if (f.to > last.to) last.to = f.to;
      continue;
    }
    out.push(f);
    lastOf.set(f.kind, f);
  }
  return out;
}

/** What the overlay reads of a W13.W1 suggestion (the type is W1's; nothing of the writing agents loads with it). */
export type SuggestionLike = Pick<WritingSuggestion, "range" | "kind"> & Partial<Pick<WritingSuggestion, "replacement">>;

/** W1 kinds that have a Hemingway colour (INT7: keyed by W1's own SuggestionKind, so a renamed kind fails to compile). */
export const HEMINGWAY_OF_KIND: Partial<Record<SuggestionKind, HemingwayKind>> = {
  passive: "passive",
  nominalization: "complex",
  wordChoice: "complex",
  wordiness: "complex",
  readability: "long",
  hedge: "adverb",
};

/** The style coach's suggestions (plan W13.W3) as highlights; kinds Hemingway has no colour for are left out. */
export function fromSuggestions(list: readonly SuggestionLike[], text?: string): HemingwayFinding[] {
  const out: HemingwayFinding[] = [];
  for (const s of list) {
    let kind = HEMINGWAY_OF_KIND[s.kind];
    if (!kind) continue;
    if (kind === "long" && text) {
      const n = wordsOf(text.slice(s.range.from, s.range.to)).length;
      kind = n > LIMITS[langOf(text.slice(s.range.from, s.range.to))].veryLong ? "veryLong" : "long";
    }
    out.push({ from: s.range.from, to: s.range.to, kind, simpler: kind === "complex" && s.replacement ? s.replacement : undefined });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** How many of each kind (the legend's counters). */
export function countByKind(findings: readonly HemingwayFinding[]): Record<HemingwayKind, number> {
  const c = Object.fromEntries(HEMINGWAY_KINDS.map((k) => [k, 0])) as Record<HemingwayKind, number>;
  for (const f of findings) c[f.kind]++;
  return c;
}

/** Each kind's look: background (light / dark theme), underline colour (light / dark) and underline style. */
export const HW_STYLES: Record<HemingwayKind, { light: string; dark: string; line: string; lineDark: string; style: "double" | "solid" | "dashed" | "dotted" | "wavy" }> = {
  veryLong: { light: "#f9d0d0", dark: "#5c1d1d", line: "#b42318", lineDark: "#ff8f86", style: "double" },
  long: { light: "#faefc0", dark: "#4a3b06", line: "#8a6100", lineDark: "#f5c84c", style: "solid" },
  passive: { light: "#d6f0d8", dark: "#173d20", line: "#1f7a33", lineDark: "#7fdc8f", style: "dashed" },
  adverb: { light: "#d8e6fb", dark: "#16304f", line: "#1d5bbf", lineDark: "#8ab8ff", style: "dotted" },
  complex: { light: "#ead9f7", dark: "#3a2153", line: "#6b2fa3", lineDark: "#cfa3f5", style: "wavy" },
};

/** Inline style for a legend swatch outside the editor. */
export function swatchStyle(kind: HemingwayKind, dark: boolean): Record<string, string> {
  const v = HW_STYLES[kind];
  return { backgroundColor: dark ? v.dark : v.light, textDecorationLine: "underline", textDecorationStyle: v.style, textDecorationColor: dark ? v.lineDark : v.line, textDecorationThickness: "2px", textUnderlineOffset: "3px", borderRadius: "2px" };
}
