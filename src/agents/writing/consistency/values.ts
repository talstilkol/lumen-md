/**
 * Dates and numbers in a sentence, normalised so two notes can be compared
 * (W13.W6): "14.5.1948", "14 במאי 1948", "May 14, 1948" are one date;
 * "3 מיליון", "3,000,000" and "3M" one number; "כ-300" and "about 300" are
 * approximate (10% either way is not a conflict), and "מעל 300" / "more than
 * 300" are bounds, never compared.
 */
import { plain, stem } from "../textTools";

export type ValueType = "date" | "year" | "number";

export interface Value {
  type: ValueType;
  /** date: YYYYMMDD; year: YYYY; number: the number. */
  value: number;
  /** The year, for dates and years (a date and a year meet on it). */
  year?: number;
  /** Canonical unit ("pct", "km", "people" …), "" for none; always "" for dates and years. */
  unit: string;
  approx: boolean;
  /** A bound ("more than", "עד"): kept for the frame, never compared. */
  bound: boolean;
  start: number;
  end: number;
  /** As written. */
  raw: string;
}

const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const EN_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthOf = (w: string): number => {
  const p = plain(w).replace(/^[בל]/, "");
  const he = HE_MONTHS.map(plain).indexOf(p);
  if (he >= 0) return he + 1;
  const l = w.toLowerCase().replace(/\.$/, "");
  const en = EN_MONTHS.findIndex((m) => m === l || (l.length >= 3 && m.startsWith(l)));
  return en >= 0 ? en + 1 : 0;
};
const MONTH_WORD = `(?:[בל]?(?:${HE_MONTHS.join("|")})|${EN_MONTHS.map((m) => `${m[0].toUpperCase()}${m.slice(1)}`).join("|")}|${EN_MONTHS.map((m) => m.slice(0, 3)).map((m) => `${m[0].toUpperCase()}${m.slice(1)}\\.?`).join("|")})`;

const DATE_RES: Array<{ re: RegExp; parts: (m: RegExpMatchArray) => [number, number, number] | null }> = [
  { re: /(?<![\d.])(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d|\.\d)/g, parts: (m) => [+m[3], +m[2], +m[1]] },
  { re: new RegExp(`(?<!\\d)(\\d{1,2})\\s*(?:ב|ל|-|־)?\\s*(${MONTH_WORD}),?\\s+(\\d{4})(?!\\d)`, "g"), parts: (m) => [+m[3], monthOf(m[2]), +m[1]] },
  { re: new RegExp(`(${MONTH_WORD})\\s+(\\d{1,2}),?\\s+(\\d{4})(?!\\d)`, "g"), parts: (m) => [+m[3], monthOf(m[1]), +m[2]] },
];

const MULT: Record<string, number> = {
  אלף: 1e3, אלפים: 1e3, אלפי: 1e3, מיליון: 1e6, מיליוני: 1e6, מיליארד: 1e9, מיליארדי: 1e9,
  thousand: 1e3, million: 1e6, billion: 1e9, k: 1e3, m: 1e6, bn: 1e9,
};

const UNIT: Array<[RegExp, string]> = [
  [/^(?:%|אחוז|אחוזים|percent|per cent)$/, "pct"],
  [/^(?:קמ|קילומטר|קילומטרים|km|kilometers|kilometres)$/, "km"],
  [/^(?:קמר|km²|km2)$/, "km2"],
  [/^(?:מטר|מטרים|m|meters|metres)$/, "m"],
  [/^(?:שח|₪|שקל|שקלים|nis|ils)$/, "ils"],
  [/^(?:\$|דולר|דולרים|dollars|usd)$/, "usd"],
  [/^(?:קג|קילוגרם|קילוגרמים|kg|kilograms)$/, "kg"],
  [/^(?:תושבים|residents|inhabitants|people|איש|אנשים|נפש)$/, "people"],
  [/^(?:שנים|שנה|years|year)$/, "years"],
];

const APPROX_BEFORE = /(?:^|[\s(])(?:כ[-־]?|בערך|כמעט|about|approximately|around|roughly|nearly|almost|some|~)\s*$/i;
const BOUND_BEFORE = /(?:מעל|יותר מ[-־]?|פחות מ[-־]?|לפחות|עד|למעלה מ[-־]?|over|more than|less than|under|at least|up to|fewer than|below|above)\s*$/i;

function unitOf(after: string): { unit: string; mult: number; len: number } {
  let mult = 1;
  let len = 0;
  let rest = after;
  const multM = /^\s*([A-Za-zא-ת]+)/.exec(rest);
  if (multM && MULT[multM[1].toLowerCase()] !== undefined) {
    mult = MULT[multM[1].toLowerCase()];
    len += multM[0].length;
    rest = rest.slice(multM[0].length);
  }
  const sym = /^\s*(%|₪|km²)/.exec(rest);
  if (sym) return { unit: UNIT.find(([re]) => re.test(sym[1]))?.[1] ?? sym[1], mult, len: len + sym[0].length };
  const w = /^\s*([A-Za-zא-ת][A-Za-zא-ת'"׳״²]*)/.exec(rest);
  if (!w) return { unit: "", mult, len };
  const p = plain(w[1]).replace(/^ה/, "");
  const known = UNIT.find(([re]) => re.test(p) || re.test(w[1].toLowerCase()));
  if (known) return { unit: known[1], mult, len: len + w[0].length };
  // An unknown counted noun: its stem is the unit ("120 עובדים" / "120 employees").
  return { unit: `w:${stem(w[1])}`, mult, len };
}

/** Every date and number in `text` (offsets relative to `base`). */
export function valuesOf(text: string, base = 0): Value[] {
  const out: Value[] = [];
  const taken: Array<[number, number]> = [];
  const free = (s: number, e: number) => !taken.some(([a, b]) => s < b && e > a);
  for (const { re, parts } of DATE_RES) {
    for (const m of text.matchAll(re)) {
      const s = m.index ?? 0;
      const e = s + m[0].length;
      const p = parts(m);
      if (!p || !free(s, e)) continue;
      const [y, mo, d] = p;
      if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1000 || y > 2199) continue;
      taken.push([s, e]);
      out.push({ type: "date", value: y * 10000 + mo * 100 + d, year: y, unit: "", approx: false, bound: false, start: base + s, end: base + e, raw: m[0] });
    }
  }
  const NUM = /(\$)?(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?![\d,]*\d)/g;
  for (const m of text.matchAll(NUM)) {
    const s = m.index ?? 0;
    const e0 = s + m[0].length;
    if (!free(s, e0)) continue;
    const before = text.slice(Math.max(0, s - 14), s);
    // A part of a word, a version, a time or a reference ("v2", "3:15", "§12") is not a value.
    if (/[A-Za-zא-ת]$/.test(before) && !/(?:^|\s)[בלמכהו]$/.test(before)) continue;
    if (/[:§#^/]$/.test(before) || /^[:/]\d/.test(text.slice(e0))) continue;
    const intPart = m[2].replace(/,/g, "");
    const n = parseFloat(m[3] ? `${intPart}.${m[3]}` : intPart);
    const u = unitOf(text.slice(e0));
    const e = e0 + u.len;
    const approx = APPROX_BEFORE.test(before) || /^\s*(?:בערך|or so)/.test(text.slice(e));
    const bound = BOUND_BEFORE.test(before.replace(/[בל][-־]?$/, ""));
    const isYear = !m[1] && !m[3] && !m[2].includes(",") && n >= 1000 && n <= 2199 && (u.unit === "" || u.unit.startsWith("w:")) && u.mult === 1;
    taken.push([s, e]);
    if (isYear) out.push({ type: "year", value: n, year: n, unit: "", approx, bound, start: base + s, end: base + e0, raw: m[0] });
    else out.push({ type: "number", value: n * u.mult, unit: m[1] ? "usd" : u.unit, approx, bound, start: base + s, end: base + e, raw: text.slice(s, e) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Whether two values of one fact disagree (dates and years meet on the year). */
export function disagree(a: Value, b: Value): boolean {
  if (a.bound || b.bound) return false;
  const temporal = (v: Value) => v.type === "date" || v.type === "year";
  if (temporal(a) !== temporal(b)) return false;
  if (temporal(a)) {
    if (a.type === "date" && b.type === "date") return a.value !== b.value;
    return a.year !== b.year;
  }
  if (a.unit !== b.unit) return false;
  if (a.value === b.value) return false;
  if (a.approx || b.approx) return Math.abs(a.value - b.value) > 0.1 * Math.max(Math.abs(a.value), Math.abs(b.value));
  return true;
}

/** A short, readable form of a value for a message. */
export const showValue = (v: Value): string => v.raw.trim();
