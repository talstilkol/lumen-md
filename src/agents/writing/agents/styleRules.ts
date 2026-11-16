/**
 * The clarity and style coach's rules (plan W13.W3), Hebrew and English.
 * Each rule is a pattern with a fix (or advice only, when no fix is safe),
 * the levels it applies at, and a base confidence. Hebrew patterns accept
 * the one-letter prefixes (ו, ש, ב, ל, כ, ה, מ) in front and keep them in
 * the fix ("וחזר שוב" → "וחזר").
 */
import type { WritingLevel } from "../agent";
import type { SuggestionKind } from "../suggestion";

export interface StyleRule {
  id: string;
  lang: "he" | "en";
  kind: SuggestionKind;
  /** Levels the rule runs at (default: all). */
  levels?: readonly WritingLevel[];
  re: RegExp;
  /** The fix for a match (null = advice only). `m[1]` is the Hebrew prefix when the rule has one. */
  fix: ((m: RegExpExecArray) => string) | null;
  confidence: number;
  en: string;
  he: string;
}

const ALL: readonly WritingLevel[] = ["everyday", "professional", "academic"];
const PRO: readonly WritingLevel[] = ["professional", "academic"];

/* ── helpers ─────────────────────────────────────────────────────────── */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A whole Hebrew phrase, optional prefix letters in group 1; `open`: the phrase ends in a bound particle (ל, ש). */
const heRe = (phrases: readonly string[], open = false) =>
  new RegExp(`(?<![\\p{L}\\p{M}])([והבכלמש]{0,2})(${phrases.map(esc).join("|")})${open ? "" : "(?![\\p{L}\\p{M}])"}`, "gu");
const enRe = (phrases: readonly string[]) => new RegExp(`\\b(${phrases.map((p) => esc(p).replace(/ /g, "\\s+")).join("|")})\\b`, "gi");

/** Keep the case of the first letter ("In order to" → "To"). */
const cased = (src: string, to: string) => (to && /^[A-Z]/.test(src) ? to[0].toUpperCase() + to.slice(1) : to);

function table(lang: "he" | "en", id: string, kind: SuggestionKind, map: Record<string, string>, o: { levels?: readonly WritingLevel[]; confidence: number; en: string; he: string; open?: boolean }): StyleRule {
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase().replace(/\s+/g, " "), v]));
  return {
    id,
    lang,
    kind,
    levels: o.levels ?? ALL,
    re: lang === "he" ? heRe(keys, o.open) : enRe(keys),
    fix: (m) => {
      if (lang === "he") return m[1] + (map[m[2]] ?? m[2]);
      const to = lower.get(m[1].toLowerCase().replace(/\s+/g, " ")) ?? m[1];
      return cased(m[1], to);
    },
    confidence: o.confidence,
    en: o.en,
    he: o.he,
  };
}

/* ── English ─────────────────────────────────────────────────────────── */

const EN_WORDY: Record<string, string> = {
  "in order to": "to", "due to the fact that": "because", "owing to the fact that": "because", "in light of the fact that": "because",
  "at this point in time": "now", "at the present time": "now", "in the event that": "if", "for the purpose of": "for",
  "in spite of the fact that": "although", "despite the fact that": "although", "with regard to": "about", "with respect to": "about",
  "in the near future": "soon", "a large number of": "many", "a great deal of": "much", "the majority of": "most",
  "has the ability to": "can", "have the ability to": "can", "is able to": "can", "are able to": "can", "prior to": "before",
  "in close proximity to": "near", "on a daily basis": "daily", "on a regular basis": "regularly", "until such time as": "until",
  "each and every": "every", "first and foremost": "first", "in the process of": "", "it is important to note that": "",
  "it should be noted that": "", "the fact that": "that", "in a timely manner": "promptly", "at all times": "always",
  "is indicative of": "indicates", "in excess of": "more than", "a number of": "several", "subsequent to": "after",
};
const EN_REDUNDANT: Record<string, string> = {
  "end result": "result", "past history": "history", "free gift": "gift", "close proximity": "proximity", "advance planning": "planning",
  "basic fundamentals": "fundamentals", "final outcome": "outcome", "unexpected surprise": "surprise", "added bonus": "bonus",
  "completely finished": "finished", "revert back": "revert", "repeat again": "repeat", "join together": "join", "future plans": "plans",
  "true facts": "facts", "each individual": "each", "absolutely essential": "essential", "collaborate together": "collaborate",
  "merge together": "merge", "new innovation": "innovation", "general consensus": "consensus", "brief summary": "summary",
  "still remains": "remains", "postpone until later": "postpone", "return back": "return", "combine together": "combine",
  "estimated at about": "estimated at", "mutual cooperation": "cooperation", "sum total": "total", "over exaggerate": "exaggerate",
};
/** Verb + noun phrases that hide a verb, with every tense: [forms of the light verb], noun phrase, [forms of the real verb]. */
const EN_NOMINAL: Array<[string[], string, string[]]> = [
  [["make", "makes", "made", "making"], "a decision", ["decide", "decides", "decided", "deciding"]],
  [["make", "makes", "made", "making"], "an assumption", ["assume", "assumes", "assumed", "assuming"]],
  [["make", "makes", "made", "making"], "a recommendation", ["recommend", "recommends", "recommended", "recommending"]],
  [["make", "makes", "made", "making"], "an improvement", ["improve", "improves", "improved", "improving"]],
  [["make", "makes", "made", "making"], "a change", ["change", "changes", "changed", "changing"]],
  [["give", "gives", "gave", "giving"], "consideration to", ["consider", "considers", "considered", "considering"]],
  [["conduct", "conducts", "conducted", "conducting"], "an analysis of", ["analyze", "analyzes", "analyzed", "analyzing"]],
  [["perform", "performs", "performed", "performing"], "an evaluation of", ["evaluate", "evaluates", "evaluated", "evaluating"]],
  [["perform", "performs", "performed", "performing"], "an analysis of", ["analyze", "analyzes", "analyzed", "analyzing"]],
  [["carry out", "carries out", "carried out", "carrying out"], "an investigation of", ["investigate", "investigates", "investigated", "investigating"]],
  [["reach", "reaches", "reached", "reaching"], "a conclusion", ["conclude", "concludes", "concluded", "concluding"]],
  [["come", "comes", "came", "coming"], "to an agreement", ["agree", "agrees", "agreed", "agreeing"]],
  [["have", "has", "had", "having"], "a discussion about", ["discuss", "discusses", "discussed", "discussing"]],
  [["provide", "provides", "provided", "providing"], "assistance to", ["help", "helps", "helped", "helping"]],
  [["take", "takes", "took", "taking"], "into consideration", ["consider", "considers", "considered", "considering"]],
  [["give", "gives", "gave", "giving"], "a presentation on", ["present", "presents", "presented", "presenting"]],
  [["do", "does", "did", "doing"], "an evaluation of", ["evaluate", "evaluates", "evaluated", "evaluating"]],
];
const EN_NOMINAL_MAP: Record<string, string> = Object.fromEntries(EN_NOMINAL.flatMap(([verbs, noun, real]) => verbs.map((v, i) => [`${v} ${noun}`, real[i]])));

const PARTICIPLES = "written|done|made|given|taken|seen|shown|built|sent|found|held|told|paid|kept|left|brought|bought|taught|caught|chosen|driven|eaten|forgotten|hidden|broken|spoken|stolen|begun|drawn|grown|thrown|known|sung|won|cut|put|set|read|led|met|sold|spent|lost|meant|heard|understood|hit|shut|beaten|bitten|frozen|ridden|woken|sworn|torn|worn";
/** Adjectives that look like participles ("is interested") are not passives. */
const NOT_PASSIVE = /^(?:interested|tired|excited|bored|married|located|based|supposed|used|concerned|involved|pleased|surprised|worried|scared|determined|qualified|prepared|exhausted|satisfied|disappointed|confused|amazed|annoyed|ashamed|embarrassed|frightened|relieved|shocked|stressed|thrilled|delighted|dedicated|committed|related|allowed|required|needed|expected|considered|called|named|aged|limited|closed|opened|finished|done)$/i;

const EN_HEDGES: Array<[string, readonly WritingLevel[]]> = [
  ["kind of", ALL], ["sort of", ALL], ["basically", ALL], ["I think that", ALL], ["I believe that", PRO], ["I feel that", ALL],
  ["really", PRO], ["very", PRO], ["quite", PRO], ["just", PRO], ["actually", PRO], ["literally", ALL], ["totally", PRO], ["somewhat", ["academic"]],
  ["extremely", PRO], ["incredibly", PRO], ["it seems that", ["academic"]], ["in my opinion,", PRO],
];

/* ── Hebrew ──────────────────────────────────────────────────────────── */

const HE_WORDY: Record<string, string> = {
  "באופן ש": "כך ש", "על מנת ש": "כדי ש", "על מנת ל": "כדי ל", "בשל העובדה ש": "כי ", "לאור העובדה ש": "מכיוון ש", "למרות העובדה ש": "אף ש",
  "במידה ו": "אם ", "ישנה אפשרות ש": "ייתכן ש", "קיימת אפשרות ש": "ייתכן ש", "חשוב לציין כי ": "", "חשוב לציין ש": "", "יש לציין כי ": "", "ראוי לציין ש": "",
};
const HE_WORDY_CLOSED: Record<string, string> = {
  "באופן מיידי": "מיד", "באופן מלא": "לגמרי", "באופן חלקי": "חלקית", "באופן אישי": "אישית", "באופן ידני": "ידנית", "באופן אוטומטי": "אוטומטית",
  "באופן רשמי": "רשמית", "באופן זמני": "זמנית", "באופן משמעותי": "משמעותית", "באופן ישיר": "ישירות", "באופן מהיר": "מהר", "באופן ברור": "בבירור",
  "באופן מדויק": "בדיוק", "באופן יומיומי": "מדי יום", "באופן קבוע": "בקביעות", "באופן מוחלט": "לחלוטין", "באופן הדרגתי": "בהדרגה", "באופן כללי": "בכלל",
  "בזמן הקרוב": "בקרוב", "בעת הנוכחית": "כעת", "בתקופה הנוכחית": "כעת", "מספר רב של": "הרבה", "רוב רובם של": "רובם של", "כמות גדולה של": "הרבה",
};
const HE_REDUNDANT: Record<string, string> = {
  "חזר שוב": "חזר", "חזרה שוב": "חזרה", "חזרו שוב": "חזרו", "חוזר שוב": "חוזר", "חוזרת שוב": "חוזרת", "חוזרים שוב": "חוזרים", "לחזור שוב": "לחזור",
  "עלה למעלה": "עלה", "עלתה למעלה": "עלתה", "עלו למעלה": "עלו", "לעלות למעלה": "לעלות", "ירד למטה": "ירד", "ירדה למטה": "ירדה", "ירדו למטה": "ירדו", "לרדת למטה": "לרדת",
  "כל אחד ואחד": "כל אחד", "מתוכנן מראש": "מתוכנן", "מתוכננת מראש": "מתוכננת", "תכנון מראש": "תכנון", "התאחדו יחד": "התאחדו", "שיתוף פעולה משותף": "שיתוף פעולה",
  "חידוש חדש": "חידוש", "הפתעה בלתי צפויה": "הפתעה", "המשיך הלאה": "המשיך", "המשיכו הלאה": "המשיכו", "להמשיך הלאה": "להמשיך", "יחד ביחד": "יחד",
  "התחברו יחד": "התחברו", "תוצאה סופית": "תוצאה", "עובדה אמיתית": "עובדה", "מאוד מאוד": "מאוד",
};
/** Light verb + action noun → the verb itself, per form (שם פעולה). */
const HE_NOMINAL: Record<string, string> = {
  "לבצע בדיקה": "לבדוק", "ביצע בדיקה": "בדק", "ביצעה בדיקה": "בדקה", "ביצעו בדיקה": "בדקו", "מבצע בדיקה": "בודק", "מבצעים בדיקה": "בודקים", "נבצע בדיקה": "נבדוק",
  "לבצע ניתוח של": "לנתח את", "ביצעו ניתוח של": "ניתחו את", "לבצע השוואה בין": "להשוות בין", "ביצעו השוואה בין": "השוו בין",
  "לבצע עדכון של": "לעדכן את", "ביצע עדכון של": "עדכן את", "ביצעו עדכון של": "עדכנו את", "לבצע תיקון של": "לתקן את", "ביצעו תיקון של": "תיקנו את",
  "לבצע הערכה של": "להעריך את", "לבצע סקירה של": "לסקור את", "לבצע מדידה של": "למדוד את", "לבצע שינוי ב": "לשנות את",
  "לקבל החלטה": "להחליט", "קיבל החלטה": "החליט", "קיבלה החלטה": "החליטה", "קיבלו החלטה": "החליטו", "מקבלים החלטה": "מחליטים", "נקבל החלטה": "נחליט",
  "לתת עזרה ל": "לעזור ל", "נתן עזרה ל": "עזר ל", "נתנו עזרה ל": "עזרו ל", "לערוך דיון על": "לדון ב", "ערכו דיון על": "דנו ב", "לקיים פגישה": "להיפגש", "קיימו פגישה": "נפגשו",
  "לעשות שימוש ב": "להשתמש ב", "עשה שימוש ב": "השתמש ב", "עשתה שימוש ב": "השתמשה ב", "עשו שימוש ב": "השתמשו ב", "עושים שימוש ב": "משתמשים ב", "עושה שימוש ב": "משתמש ב",
  "לתת תשובה": "לענות", "נתן תשובה": "ענה", "נתנו תשובה": "ענו", "לבצע הכנה של": "להכין את"
};
const HE_ACTION_NOUNS = "ביצוע|בדיקה|ניתוח|הכנה|הערכה|בחינה|השוואה|עדכון|שינוי|תיקון|סקירה|מדידה|הגשה|כתיבה|הפעלה|התקנה|הוספה|מחיקה|שליחה|יצירה|פיתוח|ניהול|טיפול|יישום|הטמעה|הצגה|איסוף|בנייה|עריכה|הפקה|תכנון|קביעה|אישור|בירור|חקירה";
const HE_PASSIVE_VERBS = "נעשה|נעשתה|נעשו|נכתב|נכתבה|נכתבו|נבדק|נבדקה|נבדקו|נקבע|נקבעה|נקבעו|נערך|נערכה|נערכו|בוצע|בוצעה|בוצעו|אושר|אושרה|אושרו|נשלח|נשלחה|נשלחו|הוכן|הוכנה|הוכנו|נחתם|נחתמה|נחתמו|נבנה|נבנתה|נבנו|פותח|פותחה|פותחו|נוסח|נוסחה|נוסחו|נבחר|נבחרה|נבחרו|הוחלט|נמסר|נמסרה|נמסרו|תוכנן|תוכננה|תוכננו|נוהל|נוהלה|הוצג|הוצגה|הוצגו|נאסף|נאספה|נאספו|נחקר|נחקרה|נחקרו|יושם|יושמה|יושמו|תורגם|תורגמה|תורגמו";
const HE_HEDGES: Array<[string, readonly WritingLevel[], string]> = [
  ["כאילו", ALL, ""], ["סוג של", ALL, ""], ["בעצם", ALL, ""], ["נראה לי ש", PRO, ""], ["אני חושב ש", PRO, ""], ["אני חושבת ש", PRO, ""], ["אני מרגיש ש", ALL, ""],
  ["אני מרגישה ש", ALL, ""], ["ממש", PRO, ""], ["פשוט", PRO, ""], ["די", ["academic"], ""], ["קצת", ["academic"], ""], ["בערך כזה", ALL, ""], ["וכאלה", ALL, ""],
];
/** Doubled words a Hebrew writer means ("לאט לאט", "צעד צעד"). */
const HE_DOUBLE_OK = new Set(["לאט", "צעד", "אחד", "אחת", "יום", "שנה", "פעם", "מעט", "קצת", "טיפה", "רגע", "אט", "כמה", "שתיים", "בית", "דור", "ממש", "מאוד"]);
const EN_DOUBLE_OK = new Set(["that", "had", "is", "do", "very", "bye", "no", "so", "ha", "knock", "now", "well", "there"]);

export const STYLE_RULES: StyleRule[] = [
  /* English */
  table("en", "en.wordy", "wordiness", EN_WORDY, { confidence: 0.8, en: "Wordy phrase", he: "ביטוי מסורבל" }),
  table("en", "en.redundancy", "redundancy", EN_REDUNDANT, { confidence: 0.85, en: "Redundant words", he: "כפל משמעות" }),
  table("en", "en.nominalization", "nominalization", EN_NOMINAL_MAP, { confidence: 0.8, en: "A noun where a verb would do", he: "שם פעולה במקום פועל" }),
  {
    id: "en.passive",
    lang: "en",
    kind: "passive",
    re: new RegExp(`\\b(?:am|is|are|was|were|be|been|being)\\s+(?:\\w+ly\\s+)?(\\w+ed|${PARTICIPLES})\\b(\\s+by\\b)?`, "gi"),
    fix: null,
    confidence: 0.6,
    en: "Passive voice: say who does it",
    he: "סביל: מי עושה את הפעולה?",
  },
  ...EN_HEDGES.map(([w, levels]): StyleRule => ({
    id: `en.hedge.${w.replace(/\W+/g, "_")}`,
    lang: "en",
    kind: "hedge",
    levels,
    re: new RegExp(`(?:^|(?<=[\\s(]))${esc(w).replace(/ /g, "\\s+")}(?=[\\s,.;:!?)]|$)\\s?`, "gi"),
    fix: () => "",
    confidence: 0.65,
    en: `Filler or hedge: "${w}"`,
    he: `מילת גידור או מילוי: "${w}"`,
  })),
  { id: "en.double", lang: "en", kind: "repetition", re: /\b([A-Za-z]+)\s+\1\b/gi, fix: (m) => m[1], confidence: 0.85, en: "Repeated word", he: "מילה כפולה" },
  /* Hebrew */
  table("he", "he.wordy", "wordiness", HE_WORDY, { confidence: 0.8, en: "Wordy phrase", he: "ביטוי מסורבל", open: true }),
  table("he", "he.wordyClosed", "wordiness", HE_WORDY_CLOSED, { confidence: 0.75, en: "Wordy phrase", he: "ביטוי מסורבל" }),
  table("he", "he.redundancy", "redundancy", HE_REDUNDANT, { confidence: 0.85, en: "Redundant words", he: "כפל משמעות" }),
  table("he", "he.nominalization", "nominalization", HE_NOMINAL, { confidence: 0.75, en: "A noun where a verb would do", he: "שם פעולה במקום פועל", open: true }),
  {
    id: "he.actionNounOf",
    lang: "he",
    kind: "nominalization",
    re: new RegExp(`(?<![\\p{L}\\p{M}])([וש]?ה?)(?:${HE_ACTION_NOUNS})\\s+של(?![\\p{L}\\p{M}])`, "gu"),
    fix: null,
    confidence: 0.6,
    en: "Action noun with 'of' (של): a verb, or the construct form, is clearer",
    he: "שם פעולה עם ״של״: פועל (או סמיכות) ברור יותר",
  },
  {
    id: "he.passiveBy",
    lang: "he",
    kind: "passive",
    re: new RegExp(`(?<![\\p{L}\\p{M}])([וש]?)(?:${HE_PASSIVE_VERBS})(?:\\s+[^\\s.,;:!?]+){0,4}?\\s+על[\\s\\-־]ידי(?![\\p{L}\\p{M}])`, "gu"),
    fix: null,
    confidence: 0.8,
    en: "Passive with 'by' (על ידי): name who does it",
    he: "סביל עם ״על ידי״: כתבו מי עושה את הפעולה",
  },
  ...HE_HEDGES.map(([w, levels]): StyleRule => ({
    id: `he.hedge.${w.replace(/\s+/g, "_")}`,
    lang: "he",
    kind: "hedge",
    levels,
    re: new RegExp(`(?<![\\p{L}\\p{M}])${esc(w)}${w.endsWith("ש") ? "" : "(?![\\p{L}\\p{M}])"}${w.endsWith("ש") ? "" : "\\s?"}`, "gu"),
    fix: () => "",
    confidence: 0.65,
    en: `Filler or hedge: "${w}"`,
    he: `מילת גידור או מילוי: ״${w}״`,
  })),
  {
    id: "he.double",
    lang: "he",
    kind: "repetition",
    re: /(?<![\p{L}\p{M}])([א-ת\p{M}]{2,})\s+\1(?![\p{L}\p{M}])/gu,
    fix: (m) => m[1],
    confidence: 0.85,
    en: "Repeated word",
    he: "מילה כפולה",
  },
];

export function isPassiveFalseAlarm(participle: string): boolean {
  return NOT_PASSIVE.test(participle);
}
export const DOUBLE_OK = { he: HE_DOUBLE_OK, en: EN_DOUBLE_OK };

/** Longest sentence the coach lets pass, in words, by level. */
export const LONG_SENTENCE: Record<"he" | "en", Record<WritingLevel, number>> = {
  en: { everyday: 25, professional: 28, academic: 35 },
  he: { everyday: 22, professional: 25, academic: 32 },
};
