/**
 * Dates in free Hebrew text (plan R12.6): the Gregorian forms Israelis
 * write ("10 ביולי 2023", "ב-10.7.2023", "יולי 2023", glued PDF text such
 * as "10ביולי2023"), Hebrew-calendar days ("א׳ בתמוז התשפ״ג"), holidays
 * with a year ("פסח התשפ״ד", "יום העצמאות 2023"), year spans ("בשנים
 * 2019–2021") and the relative words (היום, אתמול, שלשום, אמש, מחר,
 * מחרתיים) counted from the note's own date.
 *
 * Clean reimplementation (design reference only: israelconnect's date
 * extractor, AGPL; no code taken). Hebrew-calendar arithmetic is Lumen's
 * own hebrewCalendar.ts.
 *
 * The rules that keep it from inventing dates:
 * - a day and a month without a year are not read ("10 ביולי");
 * - a year alone is read only after a context word ("בשנת 2023", "ב-2023",
 *   "מאז 2019", "in 2023"); "2023" on its own is not a date;
 * - a relative word is read only when the note's date is known;
 * - an impossible day (31 בפברואר, ל׳ בטבת) is not read.
 *
 * Every mention is a range of ISO days (`from`–`to`) with its precision,
 * so a month or a year is never turned into its first day.
 */
import { AV, ADAR_I, ADAR_II, CHESHVAN, ELUL, IYYAR, KISLEV, NISAN, SHVAT, SIVAN, TAMUZ, TEVET, TISHREI, daysInMonth, fixedOf, fixedOfHebrew, gregorianOf, holidaysOfHebrewYear, isLeapYear, monthsOfYear } from "./hebrewCalendar";

export type DatePrecision = "day" | "month" | "year";
export type DateKind = "gregorian" | "numeric" | "month-year" | "year" | "year-span" | "hebrew" | "holiday" | "relative";

export interface DateMention {
  /** Offsets in the text (UTF-16), the matched words including their prefix letters. */
  start: number;
  end: number;
  text: string;
  kind: DateKind;
  precision: DatePrecision;
  /** Inclusive ISO day range. */
  from: string;
  to: string;
  /** A holiday's id (hebrewCalendar.ts), for holiday mentions. */
  holiday?: string;
  /** Plain "אדר" in a leap year: read as Adar I, and marked. */
  ambiguous?: boolean;
}

export interface ExtractOptions {
  /** The note's date (ISO day), for היום / אתמול / …; without it they are not read. */
  reference?: string;
  /** Holidays as kept in Israel (default) or the diaspora. */
  israel?: boolean;
}

/* ─── Days ───────────────────────────────────────────────────────────── */

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const isoOfFixed = (f: number) => {
  const g = gregorianOf(f);
  return `${pad(g.y, 4)}-${pad(g.m)}-${pad(g.d)}`;
};
const fixedOfIso = (iso: string) => fixedOf({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });
const gregDays = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const validGreg = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= gregDays(y, m);
const dayIso = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/* ─── Words ──────────────────────────────────────────────────────────── */

/** Prefix letters a Hebrew word may carry (ו ה ב ל מ ש כ), optionally joined by a hyphen or maqaf. */
const PFX = "(?:[ובלמהשכ]{1,3}[-־–]?)?";
/** Not inside another word or number. */
const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";
const DASH = "[-־–—]";

const GREG_MONTHS: Array<[RegExp, number]> = [
  [/^(?:ינואר|january|jan)$/i, 1],
  [/^(?:פברואר|february|feb)$/i, 2],
  [/^(?:מרץ|מרס|march|mar)$/i, 3],
  [/^(?:אפריל|april|apr)$/i, 4],
  [/^(?:מאי|may)$/i, 5],
  [/^(?:יוני|june|jun)$/i, 6],
  [/^(?:יולי|july|jul)$/i, 7],
  [/^(?:אוגוסט|august|aug)$/i, 8],
  [/^(?:ספטמבר|september|sept|sep)$/i, 9],
  [/^(?:אוקטובר|october|oct)$/i, 10],
  [/^(?:נובמבר|november|nov)$/i, 11],
  [/^(?:דצמבר|december|dec)$/i, 12],
];
const GREG_MONTH_RE = "ינואר|פברואר|מרץ|מרס|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";
const gregMonth = (w: string) => GREG_MONTHS.find(([re]) => re.test(w))?.[1] ?? null;

/** Hebrew months; "אדר" alone is resolved by the year. */
const HEB_MONTH_RE = "תשרי|מרחשוון|מרחשון|חשוון|חשון|כסלו|כסליו|טבת|שבט|אדר\\s*[אב][׳']|אדר|ניסן|אייר|איר|סיוון|סיון|תמוז|מנחם[\\s-]+אב|אב|אלול";
function hebMonth(w: string, year: number): { month: number; ambiguous?: boolean } | null {
  const s = w.replace(/\s+/g, " ").replace(/'/g, "׳");
  if (s === "תשרי") return { month: TISHREI };
  if (/^(?:מר)?חשוו?ן$/.test(s)) return { month: CHESHVAN };
  if (/^כסלי?ו$/.test(s)) return { month: KISLEV };
  if (s === "טבת") return { month: TEVET };
  if (s === "שבט") return { month: SHVAT };
  if (/^אדר ?א׳$/.test(s)) return isLeapYear(year) ? { month: ADAR_I } : null;
  if (/^אדר ?ב׳$/.test(s)) return isLeapYear(year) ? { month: ADAR_II } : null;
  if (s === "אדר") return isLeapYear(year) ? { month: ADAR_I, ambiguous: true } : { month: ADAR_I };
  if (s === "ניסן") return { month: NISAN };
  if (/^איי?ר$/.test(s)) return { month: IYYAR };
  if (/^סיוו?ן$/.test(s)) return { month: SIVAN };
  if (s === "תמוז") return { month: TAMUZ };
  if (/^(?:מנחם[ -]+)?אב$/.test(s)) return { month: AV };
  if (s === "אלול") return { month: ELUL };
  return null;
}

const LETTER: Record<string, number> = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90, ק: 100, ר: 200, ש: 300, ת: 400 };
/** The value of Hebrew numerals, marks removed ("ט״ו" → 15); null when a letter is not a numeral. */
function letterValue(s: string): number | null {
  let n = 0;
  for (const ch of s.replace(/[׳״"'”]/g, "")) {
    const v = LETTER[ch];
    if (v === undefined) return null;
    n += v;
  }
  return n;
}
/** A day of a Hebrew month in numerals: 1–30, in the usual spelling (ט״ו, never י״ה). */
const HEB_DAY_RE = "[א-ל](?:[״\"”]?[א-ט])?[׳'״\"]?";
function hebDay(s: string): number | null {
  const bare = s.replace(/[׳״"'”]/g, "");
  // One letter (א–ט, י, כ, ל), or tens and units (י״א–י״ט with ט״ו / ט״ז, כ״א–כ״ט): "אב" is a word, not 3.
  const ok = bare.length === 1 ? /^[א-ל]$/.test(bare) && bare !== "ך" : bare === "טו" || bare === "טז" || (/^[יכ][א-ט]$/.test(bare) && bare !== "יה" && bare !== "יו");
  if (!ok) return null;
  const v = letterValue(bare);
  return v !== null && v >= 1 && v <= 30 ? v : null;
}
/** A Hebrew year: ה׳תשפ״ג, התשפ״ג, תשפ״ג → 5783 (5000 assumed). */
const HEB_YEAR_RE = "(?:ה[׳']?)?[ק-ת][א-ת]{0,2}[״\"”][א-ת]";
function hebYear(s: string): number | null {
  let t = s.replace(/[׳']/g, "");
  let thousands = 5000;
  if (t.startsWith("ה") && t.length >= 4) t = t.slice(1);
  const v = letterValue(t);
  if (v === null || v < 100 || v > 999) return null;
  thousands += v;
  return thousands;
}

/** Holiday names (Hebrew) → the hebrewCalendar.ts id of the first day; multi-day holidays give their span. */
const HOLIDAYS: Array<{ re: string; id: string; last?: string }> = [
  { re: "ערב\\s+ראש\\s+השנה", id: "erev-rosh-hashana" },
  { re: "ראש\\s+השנה", id: "rosh-hashana-1", last: "rosh-hashana-2" },
  { re: "יום\\s+(?:ה)?כי?פורים|יום\\s+כי?פור", id: "yom-kippur" },
  { re: "שמחת\\s+תורה", id: "simchat-torah" },
  { re: "סוכות", id: "sukkot-1", last: "hoshana-raba" },
  { re: "חנוכה", id: "chanukah-1", last: "chanukah-8" },
  { re: "ט[״\"]?ו\\s+בשבט", id: "tu-bishvat" },
  { re: "שושן\\s+פורים", id: "shushan-purim" },
  { re: "פורים", id: "purim" },
  { re: "ערב\\s+פסח", id: "erev-pesach" },
  { re: "פסח", id: "pesach-1", last: "pesach-7" },
  { re: "יום\\s+השואה", id: "yom-hashoah" },
  { re: "יום\\s+הזי?כרון", id: "yom-hazikaron" },
  { re: "יום\\s+העצמאות", id: "yom-haatzmaut" },
  { re: "ל[״\"]?ג\\s+בעומר", id: "lag-baomer" },
  { re: "יום\\s+ירושלים", id: "yom-yerushalayim" },
  { re: "שבועות", id: "shavuot-1" },
  { re: "תשעה\\s+באב|ט[׳']\\s+באב", id: "tisha-bav" },
];

/** A holiday's days in a Hebrew year ("israel" holidays), or null. */
function holidayRange(id: string, last: string | undefined, year: number, israel: boolean): [number, number] | null {
  const list = holidaysOfHebrewYear(year, { israel });
  const fix = (x: string) => {
    if (x === "simchat-torah" && israel) x = "shemini-atzeret-simchat-torah";
    if (x === "pesach-7" && !israel) x = "pesach-8";
    return list.find((h) => h.id === x)?.fixed;
  };
  const a = fix(id);
  if (a === undefined) return null;
  const b = last ? fix(last) : a;
  return [a, b ?? a];
}

/* ─── Patterns ───────────────────────────────────────────────────────── */

const YEAR_CTX = "(?:בשנת|שנת|משנת|לשנת|עד\\s+שנת|מאז\\s+שנת|מאז|עד|ב[-־]|in|since|until|year)";
const YEAR4 = "(1[5-9]\\d\\d|2[01]\\d\\d)";

interface Rule {
  kind: DateKind;
  re: RegExp;
  read: (m: RegExpExecArray, o: Required<Pick<ExtractOptions, "israel">> & ExtractOptions) => Omit<DateMention, "start" | "end" | "text" | "kind"> | null;
}

const day = (from: string, to = from, precision: DatePrecision = "day") => ({ from, to, precision });

const RULES: Rule[] = [
  {
    // 10 ביולי 2023 · 10 יולי, 2023 · 10ביולי2023 · ה-10 ביולי 2023 · July 10, 2023 (below)
    kind: "gregorian",
    re: new RegExp(`${L}${PFX}(\\d{1,2})\\s*(?:ב|ל)?[-־]?\\s*(${GREG_MONTH_RE})\\s*,?\\s*${YEAR4}${R}`, "giu"),
    read: (m) => {
      const d = Number(m[1]);
      const mo = gregMonth(m[2]);
      const y = Number(m[3]);
      return mo && validGreg(y, mo, d) ? day(dayIso(y, mo, d)) : null;
    },
  },
  {
    kind: "gregorian",
    re: new RegExp(`${L}(${GREG_MONTH_RE})\\s+(\\d{1,2}),?\\s+${YEAR4}${R}`, "giu"),
    read: (m) => {
      const mo = gregMonth(m[1]);
      const d = Number(m[2]);
      const y = Number(m[3]);
      return mo && validGreg(y, mo, d) ? day(dayIso(y, mo, d)) : null;
    },
  },
  {
    // 10.7.2023 · 10/07/2023 · ב-10.7.23 — day first, as Israel writes it. Not inside a version or an address.
    kind: "numeric",
    re: new RegExp(`${L}${PFX}(\\d{1,2})([./])(\\d{1,2})\\2(\\d{4}|\\d{2})(?![\\d.]?\\d)${R}`, "gu"),
    read: (m) => {
      const d = Number(m[1]);
      const mo = Number(m[3]);
      let y = Number(m[4]);
      if (m[4].length === 2) y += y < 70 ? 2000 : 1900;
      return validGreg(y, mo, d) ? day(dayIso(y, mo, d)) : null;
    },
  },
  {
    // ISO: 2023-07-10
    kind: "numeric",
    re: new RegExp(`${L}${PFX}(\\d{4})-(\\d{2})-(\\d{2})${R}`, "gu"),
    read: (m) => {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      return validGreg(y, mo, d) ? day(dayIso(y, mo, d)) : null;
    },
  },
  {
    // A holiday with its year: פסח התשפ״ד · ביום העצמאות 2023 · חנוכה תשפ״ד. Before the
    // Hebrew days, so "ט״ו בשבט התשפ״ד" reads as the holiday (the same day).
    kind: "holiday",
    re: new RegExp(`${L}${PFX}(${HOLIDAYS.map((h) => `(?:${h.re})`).join("|")})\\s*,?\\s*(?:(${HEB_YEAR_RE})|(?:שנת\\s+)?${YEAR4})${R}`, "gu"),
    read: (m, o) => {
      const name = m[1];
      const h = HOLIDAYS.find((x) => new RegExp(`^(?:${x.re})$`, "u").test(name));
      if (!h) return null;
      let range: [number, number] | null = null;
      if (m[2]) {
        const y = hebYear(m[2]);
        if (y !== null) range = holidayRange(h.id, h.last, y, o.israel);
      } else {
        // A Gregorian year: the holiday's days that fall in it (the Hebrew year that starts in it, or the one before).
        const gy = Number(m[3]);
        for (const y of [gy + 3760, gy + 3761]) {
          const r = holidayRange(h.id, h.last, y, o.israel);
          if (r && gregorianOf(r[0]).y === gy) {
            range = r;
            break;
          }
        }
      }
      if (!range) return null;
      return { from: isoOfFixed(range[0]), to: isoOfFixed(range[1]), precision: "day", holiday: h.id };
    },
  },
  {
    // א׳ בתמוז התשפ״ג · ט"ו בשבט תשפ"ד · כ״ט אדר ב׳ ה׳תשפ״ד
    kind: "hebrew",
    re: new RegExp(`${L}${PFX}(${HEB_DAY_RE})\\s*(?:ב|ל)?[-־]?(${HEB_MONTH_RE})\\s*[,]?\\s*(${HEB_YEAR_RE})${R}`, "gu"),
    read: (m) => {
      const dd = hebDay(m[1]);
      const y = hebYear(m[3]);
      if (dd === null || y === null) return null;
      const mo = hebMonth(m[2], y);
      if (!mo || dd > daysInMonth(mo.month, y)) return null;
      const iso = isoOfFixed(fixedOfHebrew({ year: y, month: mo.month, day: dd }));
      return { ...day(iso), ...(mo.ambiguous ? { ambiguous: true } : {}) };
    },
  },
  {
    // תמוז התשפ״ג (a whole Hebrew month)
    kind: "month-year",
    re: new RegExp(`${L}${PFX}(?:חודש\\s+)?(${HEB_MONTH_RE})\\s+(${HEB_YEAR_RE})${R}`, "gu"),
    read: (m) => {
      const y = hebYear(m[2]);
      if (y === null) return null;
      const mo = hebMonth(m[1], y);
      if (!mo || !monthsOfYear(y).includes(mo.month)) return null;
      const a = fixedOfHebrew({ year: y, month: mo.month, day: 1 });
      return { from: isoOfFixed(a), to: isoOfFixed(a + daysInMonth(mo.month, y) - 1), precision: "month", ...(mo.ambiguous ? { ambiguous: true } : {}) };
    },
  },
  {
    // יולי 2023 · בחודש יולי 2023 · July 2023
    kind: "month-year",
    re: new RegExp(`${L}${PFX}(?:חודש\\s+)?(${GREG_MONTH_RE})\\s*,?\\s*${YEAR4}${R}`, "giu"),
    read: (m) => {
      const mo = gregMonth(m[1]);
      const y = Number(m[2]);
      return mo ? { from: dayIso(y, mo, 1), to: dayIso(y, mo, gregDays(y, mo)), precision: "month" } : null;
    },
  },
  {
    // בשנים 2019–2021 · בין 2019 ל-2021 · מ-2019 עד 2021 · between 2019 and 2021
    kind: "year-span",
    re: new RegExp(`${L}(?:(?:בשנים|בשנות|השנים|years)\\s+${YEAR4}\\s*${DASH}\\s*${YEAR4}|(?:בין|between)\\s+(?:שנת\\s+)?${YEAR4}\\s+(?:ל|and\\s*)[-־]?\\s*${YEAR4}|מ[-־]?\\s*${YEAR4}\\s+(?:ועד|עד)\\s+${YEAR4})${R}`, "gu"),
    read: (m) => {
      const ys = m.slice(1).filter(Boolean).map(Number);
      const [a, b] = ys;
      return a && b && b >= a ? { from: dayIso(a, 1, 1), to: dayIso(b, 12, 31), precision: "year" } : null;
    },
  },
  {
    // A year after a context word only.
    kind: "year",
    re: new RegExp(`${L}${YEAR_CTX}\\s*${YEAR4}(?!\\s*(?:₪|ש[״"]ח|שקל|דולר|%|ק[״"]מ|מ[״"]ר|איש|אנשים|ש[׳']))${R}`, "giu"),
    read: (m) => {
      const y = Number(m[1]);
      return { from: dayIso(y, 1, 1), to: dayIso(y, 12, 31), precision: "year" };
    },
  },
  {
    // Relative words, from the note's date.
    kind: "relative",
    re: new RegExp(`${L}(?:[ושמ][-־]?)?(היום|אתמול|שלשום|אמש|מחרתיים|מחר)${R}`, "gu"),
    read: (m, o) => {
      if (!o.reference || !/^\d{4}-\d{2}-\d{2}$/.test(o.reference)) return null;
      const off: Record<string, number> = { היום: 0, אתמול: -1, אמש: -1, שלשום: -2, מחר: 1, מחרתיים: 2 };
      return day(isoOfFixed(fixedOfIso(o.reference) + off[m[1]]));
    },
  },
];

/** Every date in `text`, in text order; where two readings overlap, the longer (then the earlier rule) wins. */
export function extractDates(text: string, opts: ExtractOptions = {}): DateMention[] {
  const o = { israel: true, ...opts };
  const found: DateMention[] = [];
  // A full form that does not hold ("31 בפברואר 2023", "ל׳ בטבת התשפ״ד") blocks the shorter readings inside it: its month is not a date either.
  const blocked: Array<[number, number]> = [];
  RULES.forEach((rule) => {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text))) {
      const r = rule.read(m, o);
      if (r) found.push({ start: m.index, end: m.index + m[0].length, text: m[0], kind: rule.kind, ...r });
      else if (rule.kind === "gregorian" || rule.kind === "hebrew" || rule.kind === "numeric") blocked.push([m.index, m.index + m[0].length]);
    }
  });
  for (let i = found.length - 1; i >= 0; i--) {
    const f = found[i];
    if (blocked.some(([a, b]) => a <= f.start && f.end <= b && b - a > f.end - f.start)) found.splice(i, 1);
  }
  const order = new Map(RULES.map((r, i) => [r.kind, i]));
  found.sort((a, b) => b.end - b.start - (a.end - a.start) || (order.get(a.kind)! - order.get(b.kind)!) || a.start - b.start);
  const out: DateMention[] = [];
  for (const f of found) if (!out.some((x) => f.start < x.end && x.start < f.end)) out.push(f);
  return out.sort((a, b) => a.start - b.start);
}

/**
 * A task's due date from its free text (R12.6 use): the first day-precise
 * date in the description, as YYYY-MM-DD, or null. A suggestion for the
 * task editor; the obsidian-tasks line format (📅) stays the stored form.
 */
export function suggestDueDate(description: string, today: string): string | null {
  const d = extractDates(description, { reference: today }).find((x) => x.precision === "day");
  return d ? d.from : null;
}
