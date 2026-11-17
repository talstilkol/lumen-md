/**
 * Deterministic entity rules (plan W12.E2), which run with no model:
 *
 * - dates: Hebrew-calendar dates ("ט״ו בשבט התשפ״ו", "כ״ה באדר ב׳ תשפ״ד")
 *   converted through src/daily/hebrewCalendar; Gregorian dates
 *   ("15 בנובמבר 2026", "15.11.2026", "2026-11-15", "November 15, 2026");
 * - laws: "חוק …, התשמ״ד-1984" / "פקודת …" / "תקנות …" with a Hebrew
 *   year, and "… Act 1998"; the Hebrew year must agree with the Gregorian;
 * - verses and Talmud folios through src/sources/sefaria/refs.ts.
 *
 * Every hit has offsets in the text and a canonical name: an ISO date, the
 * law's title, or Sefaria's reference.
 */
import { fixedOfHebrew, gregorianOf, isLeapYear, NISAN, IYYAR, SIVAN, TAMUZ, AV, ELUL, TISHREI, CHESHVAN, KISLEV, TEVET, SHVAT, ADAR_I, ADAR_II } from "../../daily/hebrewCalendar";
import { parseNumber, parseSourceRef } from "../../sources/sefaria/refs";
import type { EntityType } from "../model";

export interface RuleHit {
  start: number;
  end: number;
  text: string;
  type: EntityType;
  /** Canonical name: "2026-11-15", "חוק הגנת הפרטיות, התשמ״א-1981", "Genesis 1:1". */
  name: string;
  /** For dates: the ISO day, for the time slider. */
  when?: string;
  rule: "date-hebrew" | "date-gregorian" | "law" | "verse";
}

const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const validDay = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();

const HE_MONTHS: Array<[RegExp, number | "adar"]> = [
  [/^ניסן$/, NISAN],
  [/^אייר$/, IYYAR],
  [/^סיון$|^סיוון$/, SIVAN],
  [/^תמוז$/, TAMUZ],
  [/^אב$|^מנחם אב$/, AV],
  [/^אלול$/, ELUL],
  [/^תשרי$/, TISHREI],
  [/^חשון$|^חשוון$|^מרחשון$|^מרחשוון$/, CHESHVAN],
  [/^כסלו$|^כסליו$/, KISLEV],
  [/^טבת$/, TEVET],
  [/^שבט$/, SHVAT],
  [/^אדר א'?$/, ADAR_I],
  [/^אדר ב'?$/, ADAR_II],
  [/^אדר$/, "adar"],
];

const GREG_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const GREG_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const q = (s: string) => s.replace(/[׳‘’`´]/g, "'").replace(/[״“”]/g, '"');

/** A Hebrew year in letters: "התשפ״ו" / "תשפ״ו" / "ה'תשפ\"ו" → 5786 (the thousands are 5 when not written). */
export function hebrewYear(token: string): number | null {
  let t = q(token).replace(/['"]/g, "");
  const thousands = 5;
  if (t.length >= 4 && t.startsWith("ה")) t = t.slice(1);
  else if (/^ה /.test(t)) t = t.slice(2);
  const n = parseNumber(t);
  if (!n || n < 100 || n >= 1000) return null;
  return thousands * 1000 + n;
}

function hebrewMonth(name: string, year: number): number | null {
  const n = q(name).replace(/"/g, "").trim();
  for (const [re, m] of HE_MONTHS) if (re.test(n)) return m === "adar" ? (isLeapYear(year) ? ADAR_II : ADAR_I) : m;
  return null;
}

const HEB_NUM = `[א-ת]{1,3}["'׳״]?[א-ת]?`;
const HE_MONTH_RE = "(?:ניסן|אייר|סיוו?ן|תמוז|מנחם אב|אב|אלול|תשרי|מר?חשוו?ן|כסלי?ו|טבת|שבט|אדר(?: [אב]['׳]?)?)";
const HE_DATE = new RegExp(`(?<![א-ת])ב?(${HEB_NUM})\\s+ב?(${HE_MONTH_RE})(?:,)?\\s+(ה?['׳]?[א-ת]{2,4}["״]?[א-ת]?)(?![א-ת])`, "gu");
const GREG_HE_RE = new RegExp(`(?<!\\d)(\\d{1,2})\\s+ב?(${GREG_HE.join("|")})\\s+(\\d{4})(?!\\d)`, "gu");
const GREG_EN_RE = new RegExp(`\\b(${GREG_EN.join("|")})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b|\\b(\\d{1,2})\\s+(${GREG_EN.join("|")})\\s+(\\d{4})\\b`, "giu");
const NUM_DATE = /(?<![\d.])(\d{1,2})[./](\d{1,2})[./](\d{4})(?![\d.])|(?<!\d)(\d{4})-(\d{2})-(\d{2})(?![\d-])/gu;

export function dateHits(text: string): RuleHit[] {
  const out: RuleHit[] = [];
  for (const m of text.matchAll(HE_DATE)) {
    const year = hebrewYear(m[3]);
    const day = parseNumber(m[1]);
    if (!year || !day || day > 30) continue;
    const month = hebrewMonth(m[2], year);
    if (!month) continue;
    if (month === ADAR_II && !isLeapYear(year)) continue;
    const g = gregorianOf(fixedOfHebrew({ year, month, day }));
    const when = iso(g.y, g.m, g.d);
    out.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], type: "event", name: when, when, rule: "date-hebrew" });
  }
  for (const m of text.matchAll(GREG_HE_RE)) {
    const [d, mo, y] = [Number(m[1]), GREG_HE.indexOf(m[2]) + 1, Number(m[3])];
    if (!validDay(y, mo, d)) continue;
    out.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], type: "event", name: iso(y, mo, d), when: iso(y, mo, d), rule: "date-gregorian" });
  }
  for (const m of text.matchAll(GREG_EN_RE)) {
    const [mo, d, y] = m[1] ? [GREG_EN.indexOf(m[1].toLowerCase()) + 1, Number(m[2]), Number(m[3])] : [GREG_EN.indexOf(m[5].toLowerCase()) + 1, Number(m[4]), Number(m[6])];
    if (!validDay(y, mo, d)) continue;
    out.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], type: "event", name: iso(y, mo, d), when: iso(y, mo, d), rule: "date-gregorian" });
  }
  for (const m of text.matchAll(NUM_DATE)) {
    // Day first (Israeli and European order) for d.m.yyyy; ISO otherwise.
    const [y, mo, d] = m[3] ? [Number(m[3]), Number(m[2]), Number(m[1])] : [Number(m[4]), Number(m[5]), Number(m[6])];
    if (!validDay(y, mo, d)) continue;
    out.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], type: "event", name: iso(y, mo, d), when: iso(y, mo, d), rule: "date-gregorian" });
  }
  return out;
}

const LAW_HEAD = "(?:חוק|פקודת|תקנות|צו)";
/** "חוק <title words>, ה?<hebrew year>[-–]<gregorian year>" (the comma optional). */
const LAW_HE = new RegExp(`(?<![א-ת])(?:[ולהב]|וה)?(${LAW_HEAD}(?:[ \\-־][^\\s,.;:()]+){1,10}?)[,،]?\\s+(ה?תש[א-ת]?["'״׳]?[א-ת]|ה?תר[א-ת]?["'״׳]?[א-ת]|ה?תת?[א-ת]?["'״׳]?[א-ת])\\s*[-–־]\\s*(\\d{4})(?!\\d)`, "gu");
const LAW_EN = /\b([A-Z][a-z]+ (?:(?:of|and|the|for|on|in) |[A-Z][a-z]+ ){0,8}(?:Act|Law|Ordinance))(?:,)? (\d{4})\b/gu;

export function lawHits(text: string): RuleHit[] {
  const out: RuleHit[] = [];
  for (const m of text.matchAll(LAW_HE)) {
    const hy = hebrewYear(m[2]);
    const gy = Number(m[3]);
    // The Hebrew year starts in the autumn of gy - 1 (or gy): 5744 ↔ 1983/84.
    if (!hy || !(gy === hy - 3760 || gy === hy - 3761)) continue;
    const title = m[1].trim();
    const yearHe = m[2].startsWith("ה") ? m[2] : `ה${m[2]}`;
    const start = m.index! + m[0].indexOf(m[1]);
    const name = `${title}, ${q(yearHe).replace(/"/g, "״").replace(/'/g, "׳")}-${gy}`;
    out.push({ start, end: m.index! + m[0].length, text: text.slice(start, m.index! + m[0].length), type: "law", name, rule: "law" });
  }
  for (const m of text.matchAll(LAW_EN)) out.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], type: "law", name: `${m[1]} ${m[2]}`, rule: "law" });
  return out;
}

/** Book + chapter + verse, or a Talmud folio with its side, found in running text through the Sefaria parser. */
export function verseHits(text: string): RuleHit[] {
  const out: RuleHit[] = [];
  const words = [...text.matchAll(/[^\s,;()[\]]+/gu)];
  let i = 0;
  // An address token: a number, or a short Hebrew numeral ("א", "י״ט", "ב.", "2a").
  const addr = (k: number) => k < words.length && words[k][0].length <= 12 && /^[\dא-ת"'׳״]{1,4}(?:[ab])?(?:[:.\-][\dא-ת"'׳״]{1,4}){0,2}[.:,]?$/u.test(words[k][0]);
  while (i < words.length) {
    if (![1, 2, 3].some((d) => addr(i + d))) {
      i++;
      continue;
    }
    let best: { j: number; ref: ReturnType<typeof parseSourceRef> } | null = null;
    for (let b = 1; b <= 3 && i + b <= words.length; b++) {
      for (let a = 1; a <= 3 && i + b + a <= words.length; a++) {
        const from = words[i].index!;
        const last = words[i + b + a - 1];
        const span = text.slice(from, last.index! + last[0].length).replace(/[,;]+$/, "");
        // "בבראשית א:א", "ובשמות כ, ג": one prefix letter before the book.
        const r = parseSourceRef(span) ?? (/^[ולבמה][א-ת]{2}/.test(span) ? parseSourceRef(span.slice(1)) : null);
        if (r && (r.verse !== undefined || r.side !== undefined) && (!best || i + b + a - 1 > best.j)) best = { j: i + b + a - 1, ref: r };
      }
    }
    if (best?.ref) {
      const from = words[i].index!;
      const end = words[best.j].index! + words[best.j][0].replace(/[,;]+$/, "").length;
      out.push({ start: from, end, text: text.slice(from, end), type: "source", name: best.ref.tref, rule: "verse" });
      i = best.j + 1;
    } else i++;
  }
  return out;
}

/** All rule hits, overlaps resolved in favour of the longer span. */
export function ruleHits(text: string): RuleHit[] {
  const all = [...lawHits(text), ...dateHits(text), ...verseHits(text)].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: RuleHit[] = [];
  for (const h of all) {
    const prev = out[out.length - 1];
    if (prev && h.start < prev.end) {
      if (h.end - h.start > prev.end - prev.start) out[out.length - 1] = h;
      continue;
    }
    out.push(h);
  }
  return out;
}
