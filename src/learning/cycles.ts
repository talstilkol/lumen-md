/**
 * Study cycles (plan W12.H4): Daf Yomi (Babylonian Talmud), Mishnah Yomit
 * and the daily Rambam (one chapter, three chapters), computed here from
 * the day alone. No library and no network: the tables below are the
 * public structure of the texts (folios per tractate, mishnayot per chapter,
 * chapters per section of the Mishneh Torah) and the cycles' published
 * start dates. Our own code (MIT). The weekly portion is in
 * daily/hebrewCalendar.ts (W2.10).
 *
 * Checked against an outside table (hebcal-learning's output, generated
 * outside the app: scripts/learning/reference-from-hebcal-learning.mjs, the
 * W10.E76 method) in src/__tests__/learningCycles.test.ts.
 *
 * Days are counted as fixed day numbers (hebrewCalendar.ts `fixedOf`), so a
 * reading belongs to a civil date, whatever the time zone.
 */
import { fixedOf, type GDay } from "../daily/hebrewCalendar";

// ── Daf Yomi ────────────────────────────────────────────────────────────

/**
 * The tractates in Daf Yomi order: Sefaria's title, the Hebrew title, the
 * first and the last folio learned. Shekalim is the Jerusalem Talmud's, as
 * printed in the Vilna Shas (22 folios from cycle 8; 13 before). Kinnim,
 * Tamid and Middot are learned on the folios after Me'ilah that they occupy
 * in the printed volume.
 */
const SHAS: ReadonlyArray<readonly [en: string, he: string, first: number, last: number]> = [
  ["Berakhot", "ברכות", 2, 64],
  ["Shabbat", "שבת", 2, 157],
  ["Eruvin", "עירובין", 2, 105],
  ["Pesachim", "פסחים", 2, 121],
  ["Shekalim", "שקלים", 2, 22],
  ["Yoma", "יומא", 2, 88],
  ["Sukkah", "סוכה", 2, 56],
  ["Beitzah", "ביצה", 2, 40],
  ["Rosh Hashanah", "ראש השנה", 2, 35],
  ["Taanit", "תענית", 2, 31],
  ["Megillah", "מגילה", 2, 32],
  ["Moed Katan", "מועד קטן", 2, 29],
  ["Chagigah", "חגיגה", 2, 27],
  ["Yevamot", "יבמות", 2, 122],
  ["Ketubot", "כתובות", 2, 112],
  ["Nedarim", "נדרים", 2, 91],
  ["Nazir", "נזיר", 2, 66],
  ["Sotah", "סוטה", 2, 49],
  ["Gittin", "גיטין", 2, 90],
  ["Kiddushin", "קידושין", 2, 82],
  ["Bava Kamma", "בבא קמא", 2, 119],
  ["Bava Metzia", "בבא מציעא", 2, 119],
  ["Bava Batra", "בבא בתרא", 2, 176],
  ["Sanhedrin", "סנהדרין", 2, 113],
  ["Makkot", "מכות", 2, 24],
  ["Shevuot", "שבועות", 2, 49],
  ["Avodah Zarah", "עבודה זרה", 2, 76],
  ["Horayot", "הוריות", 2, 14],
  ["Zevachim", "זבחים", 2, 120],
  ["Menachot", "מנחות", 2, 110],
  ["Chullin", "חולין", 2, 142],
  ["Bekhorot", "בכורות", 2, 61],
  ["Arakhin", "ערכין", 2, 34],
  ["Temurah", "תמורה", 2, 34],
  ["Keritot", "כריתות", 2, 28],
  ["Meilah", "מעילה", 2, 22],
  ["Kinnim", "קינים", 23, 25],
  ["Tamid", "תמיד", 26, 33],
  ["Middot", "מידות", 34, 37],
  ["Niddah", "נדה", 2, 73],
];

/** Cycle 1 began on 11 September 1923; cycles 1–7 had Shekalim's 13 folios. */
const DAF_CYCLE1 = fixedOf({ y: 1923, m: 9, d: 11 });
const DAF_CYCLE8 = fixedOf({ y: 1975, m: 6, d: 24 });
const OLD_SHEKALIM_LAST = 14; // 13 folios: 2–14
export const DAF_YOMI_DAYS = SHAS.reduce((n, [, , a, b]) => n + b - a + 1, 0); // 2,711
const OLD_DAF_YOMI_DAYS = DAF_YOMI_DAYS - (22 - OLD_SHEKALIM_LAST); // 2,702

export interface Daf {
  cycle: number;
  /** Sefaria's title: "Berakhot". */
  tractate: string;
  he: string;
  daf: number;
  /** "Berakhot 2" (Sefaria addresses the whole folio). */
  ref: string;
}

/** The day's Daf Yomi, or null before 11 September 1923. */
export function dafYomi(day: GDay): Daf | null {
  const f = fixedOf(day);
  if (f < DAF_CYCLE1) return null;
  let cycle: number;
  let n: number;
  let shekalimLast = 22;
  if (f < DAF_CYCLE8) {
    cycle = 1 + Math.floor((f - DAF_CYCLE1) / OLD_DAF_YOMI_DAYS);
    n = (f - DAF_CYCLE1) % OLD_DAF_YOMI_DAYS;
    shekalimLast = OLD_SHEKALIM_LAST;
  } else {
    cycle = 8 + Math.floor((f - DAF_CYCLE8) / DAF_YOMI_DAYS);
    n = (f - DAF_CYCLE8) % DAF_YOMI_DAYS;
  }
  for (const [en, he, first, lastAll] of SHAS) {
    const last = en === "Shekalim" ? shekalimLast : lastAll;
    const len = last - first + 1;
    if (n < len) return { cycle, tractate: en, he, daf: first + n, ref: `${en} ${first + n}` };
    n -= len;
  }
  return null; // unreachable: n < the cycle's length
}

/** The first day of a Daf Yomi cycle (cycle ≥ 1). */
export function dafYomiCycleStart(cycle: number): number {
  return cycle < 8 ? DAF_CYCLE1 + (cycle - 1) * OLD_DAF_YOMI_DAYS : DAF_CYCLE8 + (cycle - 8) * DAF_YOMI_DAYS;
}

// ── Mishnah Yomit ───────────────────────────────────────────────────────

/**
 * Mishnayot per chapter, in order (the standard Vilna/Kehati division, as
 * Sefaria has it). Pirkei Avot's sixth chapter (Kinyan Torah, a baraita) is
 * not part of the cycle. 63 tractates, 524 chapters, 4,192 mishnayot.
 */
const MISHNAH: ReadonlyArray<readonly [en: string, he: string, chapters: readonly number[]]> = [
  ["Berakhot", "ברכות", [5, 8, 6, 7, 5, 8, 5, 8, 5]],
  ["Peah", "פאה", [6, 8, 8, 11, 8, 11, 8, 9]],
  ["Demai", "דמאי", [4, 5, 6, 7, 11, 12, 8]],
  ["Kilayim", "כלאים", [9, 11, 7, 9, 8, 9, 8, 6, 10]],
  ["Sheviit", "שביעית", [8, 10, 10, 10, 9, 6, 7, 11, 9, 9]],
  ["Terumot", "תרומות", [10, 6, 9, 13, 9, 6, 7, 12, 7, 12, 10]],
  ["Maasrot", "מעשרות", [8, 10, 10, 6, 8]],
  ["Maaser Sheni", "מעשר שני", [7, 10, 13, 12, 15]],
  ["Challah", "חלה", [9, 8, 10, 11]],
  ["Orlah", "ערלה", [9, 17, 9]],
  ["Bikkurim", "ביכורים", [11, 11, 12, 5]],
  ["Shabbat", "שבת", [11, 7, 6, 2, 4, 10, 4, 7, 7, 6, 6, 6, 7, 4, 3, 8, 8, 3, 6, 5, 3, 6, 5, 5]],
  ["Eruvin", "עירובין", [10, 6, 9, 11, 9, 10, 11, 11, 4, 15]],
  ["Pesachim", "פסחים", [7, 8, 8, 9, 10, 6, 13, 8, 11, 9]],
  ["Shekalim", "שקלים", [7, 5, 4, 9, 6, 6, 7, 8]],
  ["Yoma", "יומא", [8, 7, 11, 6, 7, 8, 5, 9]],
  ["Sukkah", "סוכה", [11, 9, 15, 10, 8]],
  ["Beitzah", "ביצה", [10, 10, 8, 7, 7]],
  ["Rosh Hashanah", "ראש השנה", [9, 8, 9, 9]],
  ["Taanit", "תענית", [7, 10, 9, 8]],
  ["Megillah", "מגילה", [11, 6, 6, 10]],
  ["Moed Katan", "מועד קטן", [10, 5, 9]],
  ["Chagigah", "חגיגה", [8, 7, 8]],
  ["Yevamot", "יבמות", [4, 10, 10, 13, 6, 6, 6, 6, 6, 9, 7, 6, 13, 9, 10, 7]],
  ["Ketubot", "כתובות", [10, 10, 9, 12, 9, 7, 10, 8, 9, 6, 6, 4, 11]],
  ["Nedarim", "נדרים", [4, 5, 11, 8, 6, 10, 9, 7, 10, 8, 12]],
  ["Nazir", "נזיר", [7, 10, 7, 7, 7, 11, 4, 2, 5]],
  ["Sotah", "סוטה", [9, 6, 8, 5, 5, 4, 8, 7, 15]],
  ["Gittin", "גיטין", [6, 7, 8, 9, 9, 7, 9, 10, 10]],
  ["Kiddushin", "קידושין", [10, 10, 13, 14]],
  ["Bava Kamma", "בבא קמא", [4, 6, 11, 9, 7, 6, 7, 7, 12, 10]],
  ["Bava Metzia", "בבא מציעא", [8, 11, 12, 12, 11, 8, 11, 9, 13, 6]],
  ["Bava Batra", "בבא בתרא", [6, 14, 8, 9, 11, 8, 4, 8, 10, 8]],
  ["Sanhedrin", "סנהדרין", [6, 5, 8, 5, 5, 6, 11, 7, 6, 6, 6]],
  ["Makkot", "מכות", [10, 8, 16]],
  ["Shevuot", "שבועות", [7, 5, 11, 13, 5, 7, 8, 6]],
  ["Eduyot", "עדיות", [14, 10, 12, 12, 7, 3, 9, 7]],
  ["Avodah Zarah", "עבודה זרה", [9, 7, 10, 12, 12]],
  ["Pirkei Avot", "אבות", [18, 16, 18, 22, 23]],
  ["Horayot", "הוריות", [5, 7, 8]],
  ["Zevachim", "זבחים", [4, 5, 6, 6, 8, 7, 6, 12, 7, 8, 8, 6, 8, 10]],
  ["Menachot", "מנחות", [4, 5, 7, 5, 9, 7, 6, 7, 9, 9, 9, 5, 11]],
  ["Chullin", "חולין", [7, 10, 7, 7, 5, 7, 6, 4, 8, 4, 2, 5]],
  ["Bekhorot", "בכורות", [7, 9, 4, 10, 6, 12, 7, 10, 8]],
  ["Arakhin", "ערכין", [4, 6, 5, 4, 6, 5, 5, 7, 8]],
  ["Temurah", "תמורה", [6, 3, 5, 4, 6, 5, 6]],
  ["Keritot", "כריתות", [7, 6, 10, 3, 8, 9]],
  ["Meilah", "מעילה", [4, 9, 8, 6, 5, 6]],
  ["Tamid", "תמיד", [4, 5, 9, 3, 6, 4, 4]],
  ["Middot", "מידות", [9, 6, 8, 7, 4]],
  ["Kinnim", "קינים", [4, 5, 6]],
  ["Kelim", "כלים", [9, 8, 8, 4, 11, 4, 6, 11, 8, 8, 9, 8, 8, 8, 6, 8, 17, 9, 10, 7, 3, 10, 5, 17, 9, 9, 12, 10, 8, 4]],
  ["Oholot", "אהלות", [8, 7, 7, 6, 7, 7, 6, 6, 16, 7, 9, 8, 6, 7, 10, 5, 5, 10]],
  ["Negaim", "נגעים", [6, 5, 8, 11, 5, 8, 5, 10, 3, 10, 12, 7, 12, 13]],
  ["Parah", "פרה", [4, 5, 11, 11, 9, 5, 12, 11, 9, 6, 9, 11]],
  ["Tahorot", "טהרות", [9, 8, 8, 13, 9, 10, 9, 9, 9, 8]],
  ["Mikvaot", "מקואות", [8, 10, 4, 5, 6, 11, 7, 5, 7, 8]],
  ["Niddah", "נדה", [7, 7, 7, 7, 9, 14, 5, 4, 11, 8]],
  ["Makhshirin", "מכשירין", [6, 11, 8, 10, 11, 8]],
  ["Zavim", "זבים", [6, 4, 3, 7, 12]],
  ["Tevul Yom", "טבול יום", [5, 8, 6, 7]],
  ["Yadayim", "ידיים", [5, 4, 5, 8]],
  ["Oktzin", "עוקצים", [6, 10, 12]],
];

export interface MishnahPoint {
  tractate: string;
  he: string;
  chapter: number;
  mishnah: number;
}

/** Every mishnah of the cycle, in order (built once). */
let mishnayot: MishnahPoint[] | null = null;
function allMishnayot(): MishnahPoint[] {
  if (mishnayot) return mishnayot;
  mishnayot = [];
  for (const [tractate, he, chapters] of MISHNAH) chapters.forEach((n, c) => {
    for (let m = 1; m <= n; m++) mishnayot!.push({ tractate, he, chapter: c + 1, mishnah: m });
  });
  return mishnayot;
}
export const MISHNAH_COUNT = MISHNAH.reduce((n, [, , cs]) => n + cs.reduce((a, b) => a + b, 0), 0); // 4,192
export const MISHNAH_YOMIT_DAYS = MISHNAH_COUNT / 2; // 2,096

/** Mishnah Yomit's first cycle began on 20 May 1947 (two mishnayot a day). */
const MISHNAH_CYCLE1 = fixedOf({ y: 1947, m: 5, d: 20 });

export interface MishnahYomit {
  cycle: number;
  /** The day's two mishnayot (they can be in two chapters or two tractates). */
  mishnayot: [MishnahPoint, MishnahPoint];
  /** Sefaria references, one per tractate: ["Mishnah Berakhot 1:1-2"]. */
  refs: string[];
}

const mishnahTitle = (t: string) => (t === "Pirkei Avot" ? t : `Mishnah ${t}`);

/** Sefaria refs for a run of consecutive mishnayot, one per tractate. */
export function mishnahRefs(points: readonly MishnahPoint[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < points.length; ) {
    let j = i;
    while (j + 1 < points.length && points[j + 1].tractate === points[i].tractate) j++;
    const a = points[i];
    const b = points[j];
    const span = a === b ? `${a.chapter}:${a.mishnah}` : a.chapter === b.chapter ? `${a.chapter}:${a.mishnah}-${b.mishnah}` : `${a.chapter}:${a.mishnah}-${b.chapter}:${b.mishnah}`;
    out.push(`${mishnahTitle(a.tractate)} ${span}`);
    i = j + 1;
  }
  return out;
}

/** The day's Mishnah Yomit, or null before 20 May 1947. */
export function mishnahYomit(day: GDay): MishnahYomit | null {
  const f = fixedOf(day);
  if (f < MISHNAH_CYCLE1) return null;
  const all = allMishnayot();
  const cycle = 1 + Math.floor((f - MISHNAH_CYCLE1) / MISHNAH_YOMIT_DAYS);
  const n = ((f - MISHNAH_CYCLE1) % MISHNAH_YOMIT_DAYS) * 2;
  const pair: [MishnahPoint, MishnahPoint] = [all[n], all[n + 1]];
  return { cycle, mishnayot: pair, refs: mishnahRefs(pair) };
}

// ── Daily Rambam ────────────────────────────────────────────────────────

/**
 * The Mishneh Torah in order: Sefaria's section title (after "Mishneh
 * Torah, "), the Hebrew title, the chapters as the one-chapter schedule
 * counts them. The 83 sections of halakhot have 1,000 chapters; the
 * schedule also learns "The Order of Prayer" (the prayer texts at the end of
 * Sefer Ahavah, its own section on Sefaria) and the text of the Haggadah,
 * which Sefaria and the schedule count as chapter 9 of "Leavened and
 * Unleavened Bread". Sources: the published daily schedule (chabad.org's
 * daily Rambam) as tabulated by hebcal-learning (BSD-2-Clause,
 * src/mishnehTorah.json at 63fadce4), whose names are Sefaria's titles.
 */
const RAMBAM: ReadonlyArray<readonly [en: string, he: string, chapters: number]> = [
  ["Foundations of the Torah", "יסודי התורה", 10],
  ["Human Dispositions", "דעות", 7],
  ["Torah Study", "תלמוד תורה", 7],
  ["Foreign Worship and Customs of the Nations", "עבודה זרה וחוקות הגויים", 12],
  ["Repentance", "תשובה", 10],
  ["Reading the Shema", "קריאת שמע", 4],
  ["Prayer and the Priestly Blessing", "תפילה וברכת כהנים", 15],
  ["Tefillin, Mezuzah and the Torah Scroll", "תפילין ומזוזה וספר תורה", 10],
  ["Fringes", "ציצית", 3],
  ["Blessings", "ברכות", 11],
  ["Circumcision", "מילה", 3],
  ["The Order of Prayer", "סדר התפילות", 4],
  ["Sabbath", "שבת", 30],
  ["Eruvin", "עירובין", 8],
  ["Rest on the Tenth of Tishrei", "שביתת עשור", 3],
  ["Rest on a Holiday", "שביתת יום טוב", 8],
  ["Leavened and Unleavened Bread", "חמץ ומצה", 9],
  ["Shofar, Sukkah and Lulav", "שופר וסוכה ולולב", 8],
  ["Sheqel Dues", "שקלים", 4],
  ["Sanctification of the New Month", "קידוש החודש", 19],
  ["Fasts", "תעניות", 5],
  ["Scroll of Esther and Hanukkah", "מגילה וחנוכה", 4],
  ["Marriage", "אישות", 25],
  ["Divorce", "גירושין", 13],
  ["Levirate Marriage and Release", "יבום וחליצה", 8],
  ["Virgin Maiden", "נערה בתולה", 3],
  ["Woman Suspected of Infidelity", "סוטה", 4],
  ["Forbidden Intercourse", "איסורי ביאה", 22],
  ["Forbidden Foods", "מאכלות אסורות", 17],
  ["Ritual Slaughter", "שחיטה", 14],
  ["Oaths", "שבועות", 12],
  ["Vows", "נדרים", 13],
  ["Nazariteship", "נזירות", 10],
  ["Appraisals and Devoted Property", "ערכים וחרמין", 8],
  ["Diverse Species", "כלאים", 10],
  ["Gifts to the Poor", "מתנות עניים", 10],
  ["Heave Offerings", "תרומות", 15],
  ["Tithes", "מעשר", 14],
  ["Second Tithes and Fourth Year's Fruit", "מעשר שני ונטע רבעי", 11],
  ["First Fruits and other Gifts to Priests Outside the Sanctuary", "ביכורים ושאר מתנות כהונה שבגבולין", 12],
  ["Sabbatical Year and the Jubilee", "שמיטה ויובל", 13],
  ["The Chosen Temple", "בית הבחירה", 8],
  ["Vessels of the Sanctuary and Those who Serve Therein", "כלי המקדש והעובדין בו", 10],
  ["Admission into the Sanctuary", "ביאת המקדש", 9],
  ["Things Forbidden on the Altar", "איסורי המזבח", 7],
  ["Sacrificial Procedure", "מעשה הקרבנות", 19],
  ["Daily Offerings and Additional Offerings", "תמידים ומוספין", 10],
  ["Sacrifices Rendered Unfit", "פסולי המוקדשין", 19],
  ["Service on the Day of Atonement", "עבודת יום הכפורים", 5],
  ["Trespass", "מעילה", 8],
  ["Paschal Offering", "קרבן פסח", 10],
  ["Festival Offering", "חגיגה", 3],
  ["Firstlings", "בכורות", 8],
  ["Offerings for Unintentional Transgressions", "שגגות", 15],
  ["Offerings for Those with Incomplete Atonement", "מחוסרי כפרה", 5],
  ["Substitution", "תמורה", 4],
  ["Defilement by a Corpse", "טומאת מת", 25],
  ["Red Heifer", "פרה אדומה", 15],
  ["Defilement by Leprosy", "טומאת צרעת", 16],
  ["Those Who Defile Bed or Seat", "מטמאי משכב ומושב", 13],
  ["Other Sources of Defilement", "שאר אבות הטומאות", 20],
  ["Defilement of Foods", "טומאת אוכלים", 16],
  ["Vessels", "כלים", 28],
  ["Immersion Pools", "מקואות", 11],
  ["Damages to Property", "נזקי ממון", 14],
  ["Theft", "גניבה", 9],
  ["Robbery and Lost Property", "גזילה ואבידה", 18],
  ["One Who Injures a Person or Property", "חובל ומזיק", 8],
  ["Murderer and the Preservation of Life", "רוצח ושמירת נפש", 13],
  ["Sales", "מכירה", 30],
  ["Ownerless Property and Gifts", "זכייה ומתנה", 12],
  ["Neighbors", "שכנים", 14],
  ["Agents and Partners", "שלוחין ושותפין", 10],
  ["Slaves", "עבדים", 9],
  ["Hiring", "שכירות", 13],
  ["Borrowing and Deposit", "שאלה ופקדון", 8],
  ["Creditor and Debtor", "מלווה ולווה", 27],
  ["Plaintiff and Defendant", "טוען ונטען", 16],
  ["Inheritances", "נחלות", 11],
  ["The Sanhedrin and the Penalties within their Jurisdiction", "סנהדרין והעונשין המסורין להם", 26],
  ["Testimony", "עדות", 22],
  ["Rebels", "ממרים", 7],
  ["Mourning", "אבל", 14],
  ["Kings and Wars", "מלכים ומלחמות", 12],
];
/** The 83 sections of halakhot: neither "The Order of Prayer" nor the Haggadah's chapter. */
export const RAMBAM_CHAPTERS = RAMBAM.reduce((n, [en, , c]) => n + (en === "The Order of Prayer" ? 0 : en === "Leavened and Unleavened Bread" ? c - 1 : c), 0); // 1,000

/**
 * Before the first section both schedules learn the Mishneh Torah's
 * introduction: the transmission of the Oral Law, the positive and the
 * negative commandments, and the list of commandments by section. Each of
 * the four is learned in three parts (12 days at one chapter a day, one day
 * each at three), with these spans, as the published schedule has them
 * (Sefaria references: verses of a one-level text, or chapter:verse).
 */
const RAMBAM_INTRO: ReadonlyArray<readonly [en: string, he: string, spans: readonly [string, string, string]]> = [
  ["Transmission of the Oral Law", "מסירת תורה שבעל פה", ["1-21", "22-33", "34-45"]],
  ["Positive Mitzvot", "מצוות עשה", ["1-83", "84-166", "167-248"]],
  ["Negative Mitzvot", "מצוות לא תעשה", ["1-122", "123-245", "246-365"]],
  ["Overview of Mishneh Torah Contents", "תוכן החיבור", ["1:1-4:8", "5:1-9:9", "10:1-14:10"]],
];
export const RAMBAM_INTRO_UNITS = RAMBAM_INTRO.length * 3; // 12

export interface RambamUnit {
  /** Sefaria's title: "Mishneh Torah, Foundations of the Torah". */
  title: string;
  he: string;
  /** The unit's number within its section, from 1. */
  chapter: number;
  /** What the schedule prints for it: "3", "4-5" (two chapters on one day), "1-21" (verses). */
  span: string;
  intro: boolean;
}

/**
 * The two schedules differ in two places, so that each day of the
 * three-chapter cycle stays together (hebcal-learning src/rambam3Base.ts,
 * after chabad.org):
 * - one chapter a day: "The Order of Prayer" in 4 days, its chapters 4 and 5
 *   on the fourth; the Haggadah (chapter 9 of "Leavened and Unleavened
 *   Bread") on a day of its own;
 * - three a day: "The Order of Prayer" in 5 units; chapters 8 and 9 of
 *   "Leavened and Unleavened Bread" as one unit.
 * Both come to 1,017 units: 1,017 days at one chapter, 339 at three. The
 * Sefer HaMitzvot track runs alongside the three-chapter cycle (339 days),
 * not the one-chapter cycle; it is not computed here.
 */
const rambamUnits: { 1?: RambamUnit[]; 3?: RambamUnit[] } = {};
function allRambam(perDay: 1 | 3): RambamUnit[] {
  const cached = rambamUnits[perDay];
  if (cached) return cached;
  const out: RambamUnit[] = [];
  for (const [en, he, spans] of RAMBAM_INTRO) spans.forEach((span, i) => out.push({ title: `Mishneh Torah, ${en}`, he, chapter: i + 1, span, intro: true }));
  for (const [en, heTitle, n] of RAMBAM) {
    const he = en === "The Order of Prayer" ? heTitle : `הלכות ${heTitle}`;
    const spans: string[] = [];
    if (en === "The Order of Prayer") {
      if (perDay === 1) spans.push("1", "2", "3", "4-5");
      else spans.push("1", "2", "3", "4", "5");
    } else if (en === "Leavened and Unleavened Bread" && perDay === 3) {
      for (let c = 1; c < n - 1; c++) spans.push(String(c));
      spans.push(`${n - 1}-${n}`);
    } else for (let c = 1; c <= n; c++) spans.push(String(c));
    spans.forEach((span, i) => out.push({ title: `Mishneh Torah, ${en}`, he, chapter: i + 1, span, intro: false }));
  }
  return (rambamUnits[perDay] = out);
}
/** Units in a cycle (the same for both schedules): 1,017. */
export const RAMBAM_UNITS = allRambam(1).length;
/** Days in a cycle: 1,017 at one chapter, 339 at three. */
export const rambamCycleDays = (perDay: 1 | 3): number => allRambam(perDay).length / perDay;

/** Both daily Rambam cycles began on 27 Nisan 5744, 29 April 1984. */
const RAMBAM_START = fixedOf({ y: 1984, m: 4, d: 29 });

export interface RambamDaily {
  cycle: number;
  perDay: 1 | 3;
  units: RambamUnit[];
  /** Sefaria references, one per run in a section: ["Mishneh Torah, Sabbath 3-5"]. */
  refs: string[];
}

/** The day's Rambam, one chapter or three, or null before 29 April 1984. */
export function dailyRambam(day: GDay, perDay: 1 | 3): RambamDaily | null {
  const f = fixedOf(day);
  if (f < RAMBAM_START) return null;
  const all = allRambam(perDay);
  const days = all.length / perDay;
  const cycle = 1 + Math.floor((f - RAMBAM_START) / days);
  const n = ((f - RAMBAM_START) % days) * perDay;
  const units = all.slice(n, n + perDay);
  const refs: string[] = [];
  for (let i = 0; i < units.length; ) {
    let j = i;
    while (j + 1 < units.length && units[j + 1].title === units[i].title) j++;
    const from = units[i].span.split("-")[0];
    const to = units[j].span.split("-").pop()!;
    refs.push(`${units[i].title} ${from === to ? from : `${from}-${to}`}`);
    i = j + 1;
  }
  return { cycle, perDay, units, refs };
}

// ── Labels and links ────────────────────────────────────────────────────

/** sefaria.org's page for a reference (a link the user opens; nothing is fetched). */
export function sefariaUrl(ref: string): string {
  const m = /^(.*) (\d[\d:-]*)$/.exec(ref);
  const [title, span] = m ? [m[1], m[2]] : [ref, ""];
  const path = encodeURIComponent(title.replace(/ /g, "_")).replace(/%2C/g, ",") + (span ? `.${span.replace(/:/g, ".")}` : "");
  return `https://www.sefaria.org/${path}`;
}
