/**
 * W13.W6 — a synthetic vault with 50 planted inconsistencies and many traps.
 *
 * Planted (each one is a finding the checker must make):
 *   28 fact conflicts (dates, years, counts, lengths, money; Hebrew and English;
 *      inflected and reworded around the same predicate),
 *   12 name variants (ktiv male/haser, niqqud, a Latin name inside Hebrew),
 *   10 glossary variants (the user's glossary note).
 * Traps (each one must NOT be flagged): the same fact in another format
 * (14.5.1948 = 14 במאי 1948, 3 מיליון = 3,000,000), approximations within 10%,
 * bounds ("more than 500"), different predicates of one entity, one predicate
 * of different entities, different time qualifiers, aliases (רמב״ם / משה בן
 * מימון), prefixed and glossed names, an English note in English, a fully
 * pointed poem, glossary variants inside longer words and inside code.
 *
 * Synthetic and written for lumen-md (MIT): a dev set only (eval card tag
 * "dev"); it can never back a ✅ alone.
 */
import { entityId, type Entity } from "../../../entities/model";
import type { VaultNote } from "../../../agents/writing/consistency/vaultConsistency";

const E = (type: Entity["type"], name: string, aliases: string[] = []): Entity => ({ id: entityId(type, name), type, name, aliases });

export const ENTITIES: Entity[] = [
  E("place", "ירושלים", ["Jerusalem"]),
  E("place", "חיפה", ["Haifa"]),
  E("place", "באר שבע", ["Beersheba"]),
  E("place", "הכנרת", ["Sea of Galilee", "ים כנרת"]),
  E("place", "נהר הירדן", ["Jordan River"]),
  E("place", "הר החרמון", ["Mount Hermon"]),
  E("organization", "האוניברסיטה העברית", ["Hebrew University"]),
  E("organization", "הטכניון", ["Technion"]),
  E("organization", "הספרייה הלאומית", ["National Library"]),
  E("organization", "תיאטרון הבימה", ["Habima"]),
  E("organization", "Acme Robotics", ["אקמי רובוטיקה"]),
  E("organization", "Northwind Labs", []),
  E("person", "משה בן מימון", ["רמב״ם", "Maimonides"]),
  E("person", "רחל המשוררת", ["Rachel Bluwstein"]),
  E("person", "דוד בן גוריון", ["בן גוריון", "Ben-Gurion"]),
  E("person", "גולדה מאיר", ["Golda Meir"]),
  E("person", "Ada Lovelace", ["עדה לאבלייס"]),
  E("person", "Alan Turing", ["אלן טיורינג"]),
  E("event", "חנוכה", ["Hanukkah"]),
  E("event", "מלחמת העצמאות", ["War of Independence"]),
  E("event", "ועידת סן רמו", ["San Remo conference"]),
  E("place", "תל אביב", ["Tel Aviv"]),
  E("place", "ירוחם", ["Yeruham"]),
  E("place", "קריית שמונה", ["Kiryat Shmona"]),
];

export const GLOSSARY_NOTE: VaultNote = {
  path: "מילון מונחים.md",
  content: [
    "# מילון מונחים",
    "",
    "- דוא״ל: אימייל, מייל",
    "- מרשתת: אינטרנט",
    "- יישומון: אפליקציה",
    "- סדנה: וורקשופ",
    "- email: e-mail",
  ].join("\n"),
};

export interface PlantedFact {
  kind: "fact-conflict";
  paths: [string, string];
}
export interface PlantedSpan {
  kind: "name-variant" | "foreign-script-name" | "term-variant";
  path: string;
  /** The written text that must be flagged (first occurrence in `path` after `after`). */
  text: string;
  from: number;
  to: number;
}
export type Planted = PlantedFact | PlantedSpan;

interface Builder {
  notes: VaultNote[];
  planted: Planted[];
}

const FILLER_HE = [
  "הפסקה הזאת נכתבה כרקע כללי לפתק.",
  "כדאי לחזור לנושא הזה בהמשך השבוע.",
  "המקורות המלאים מופיעים ברשימה בסוף.",
  "יש עוד הרבה מה לברר בעניין הזה.",
];
const FILLER_EN = ["This paragraph is background for the note.", "We should come back to this later in the week.", "The full sources are listed at the end."];

function note(b: Builder, path: string, paras: string[], hebrew = true): VaultNote {
  const filler = hebrew ? FILLER_HE : FILLER_EN;
  const body = [`# ${path.replace(/\.md$/, "")}`, "", filler[b.notes.length % filler.length], "", ...paras.flatMap((p) => [p, ""]), filler[(b.notes.length + 1) % filler.length]].join("\n");
  const n = { path, content: body };
  b.notes.push(n);
  return n;
}

function span(b: Builder, n: VaultNote, kind: PlantedSpan["kind"], text: string, after = ""): void {
  const base = after ? n.content.indexOf(after) : 0;
  const from = n.content.indexOf(text, Math.max(0, base));
  if (from < 0) throw new Error(`fixture: "${text}" not in ${n.path}`);
  b.planted.push({ kind, path: n.path, text, from, to: from + text.length });
}

/** [entity mention, statement A, statement B] — B disagrees with A on one value. */
const FACT_CONFLICTS: Array<[string, string, boolean]> = [
  ["האוניברסיטה העברית נוסדה ב-1918 על הר הצופים.", "האוניברסיטה העברית, שנוסדה בשנת 1925, היא מהוותיקות.", true],
  ["הטכניון נוסד ב-1912 בחיפה.", "את הטכניון נוסד בשנת 1924 לפי מקור אחר.", true],
  ["הספרייה הלאומית נוסדה ב-1892.", "הספרייה הלאומית נוסדה ב-1898.", true],
  ["תיאטרון הבימה נוסד במוסקבה ב-1917.", "תיאטרון הבימה נוסד ב-1918 במוסקבה.", true],
  ["משה בן מימון נולד בקורדובה ב-1138.", "משה בן מימון נולד ב-1135 בקורדובה.", true],
  ["רחל המשוררת נולדה ב-20.9.1890.", "רחל המשוררת נולדה ב-21 בספטמבר 1890.", true],
  ["דוד בן גוריון נולד ב-16.10.1886 בפלונסק.", "דוד בן גוריון נולד בפלונסק ב-16 באוקטובר 1887.", true],
  ["גולדה מאיר נולדה בקייב ב-1898.", "גולדה מאיר נולדה ב-1897 בקייב.", true],
  ["בחיפה מתגוררים 285,000 תושבים.", "בחיפה מתגוררים 250,000 תושבים.", true],
  ["בבאר שבע מתגוררים 210,000 תושבים.", "בבאר שבע מתגוררים 190,000 תושבים לפי ההערכה.", true],
  ["אורכו של נהר הירדן הוא 251 ק״מ.", "אורכו של נהר הירדן 223 ק״מ בלבד.", true],
  ["גובהו של הר החרמון 2,814 מטר.", "גובהו של הר החרמון 2,224 מטר מעל פני הים.", true],
  ["שטח הכנרת הוא 166 קמ״ר.", "שטח הכנרת הוא 147 קמ״ר.", true],
  ["אקמי רובוטיקה מעסיקה 120 עובדים.", "אקמי רובוטיקה מעסיקה 180 עובדים כיום.", true],
  ["ועידת סן רמו התכנסה ב-19.4.1920.", "ועידת סן רמו התכנסה ב-25 באפריל 1921.", true],
  ["מלחמת העצמאות הסתיימה ב-1949.", "מלחמת העצמאות הסתיימה בשנת 1948.", true],
  ["תקציב הספרייה הלאומית עומד על 40 מיליון ש״ח.", "תקציב הספרייה הלאומית עומד על 55 מיליון ש״ח.", true],
  ["ירוחם נוסדה ב-1951 בנגב.", "ירוחם נוסדה ב-1955.", true],
  ["קריית שמונה נוסדה ב-1949.", "קריית שמונה נוסדה ב-1950 בצפון.", true],
  ["תל אביב נוסדה ב-1909.", "תל אביב נוסדה ב-1910 על החולות.", true],
  ["Acme Robotics was founded in 2011 in Haifa.", "Acme Robotics, founded in 2013, builds arms.", false],
  ["Northwind Labs employs 45 people.", "Northwind Labs employs 60 people in two offices.", false],
  ["Ada Lovelace was born on December 10, 1815.", "Ada Lovelace was born on 12 December 1815 in London.", false],
  ["Alan Turing was born in 1912.", "Alan Turing was born in 1911 in London.", false],
  ["The Technion was founded in 1912.", "The Technion was founded in 1913 according to the brochure.", false],
  ["The Jordan River is 251 km long.", "The Jordan River is 360 km long.", false],
  ["The National Library holds 5 million items.", "The National Library holds 4 million items.", false],
  ["Mount Hermon rises to 2,814 meters.", "Mount Hermon rises to 2,236 meters.", false],
];

/** The same fact twice in two forms, or two facts that only look alike: none is a conflict. */
const TRAPS: Array<[string, string, boolean]> = [
  ["ועידת סן רמו נפתחה ב-19.4.1920.", "ועידת סן רמו נפתחה ב-19 באפריל 1920.", true],
  ["בירושלים מתגוררים כ-950,000 תושבים.", "בירושלים מתגוררים 980,000 תושבים.", true],
  ["בתל אביב מתגוררים 3 מיליון תושבים במטרופולין.", "בתל אביב מתגוררים 3,000,000 תושבים במטרופולין.", true],
  ["Northwind Labs has more than 500 customers.", "Northwind Labs has 620 customers.", false],
  ["הטכניון מונה 14,000 סטודנטים.", "הטכניון מונה 14,000 סטודנטים ויותר מ-1,000 חוקרים.", true],
  ["הטכניון פתח את שעריו ב-1924.", "הטכניון קיבל את הסטודנטים הראשונים ב-1925.", true],
  ["חיפה נוסדה מחדש ב-1761.", "באר שבע נוסדה מחדש ב-1900.", true],
  ["בשנת 2010 מנתה אוכלוסיית ירוחם 8,000 תושבים.", "בשנת 2020 מנתה אוכלוסיית ירוחם 11,000 תושבים.", true],
  ["Alan Turing died in 1954.", "Alan Turing published his paper in 1936.", false],
  ["Acme Robotics opened an office in 2015.", "Northwind Labs was founded in 2016.", false],
  ["דוד בן גוריון נפטר ב-1973.", "דוד בן גוריון נפטר בשדה בוקר ב-1973.", true],
  ["גולדה מאיר כיהנה כראש ממשלה מ-1969.", "גולדה מאיר התפטרה ב-1974.", true],
  ["רוחבו של נהר הירדן כ-30 מטר.", "רוחבו של נהר הירדן 32 מטר בממוצע.", true],
  ["רחל המשוררת נפטרה ב-16.4.1931.", "רחל המשוררת נפטרה ב-16 באפריל 1931.", true],
];

export function buildVault(): { notes: VaultNote[]; entities: Entity[]; planted: Planted[] } {
  const b: Builder = { notes: [], planted: [] };
  b.notes.push(GLOSSARY_NOTE);

  FACT_CONFLICTS.forEach(([a, c, he], i) => {
    const pa = `facts/conflict-${String(i + 1).padStart(2, "0")}-a.md`;
    const pb = `facts/conflict-${String(i + 1).padStart(2, "0")}-b.md`;
    note(b, pa, [a], he);
    note(b, pb, [c], he);
    b.planted.push({ kind: "fact-conflict", paths: [pa, pb] });
  });
  TRAPS.forEach(([a, c, he], i) => {
    note(b, `facts/trap-${String(i + 1).padStart(2, "0")}-a.md`, [a], he);
    note(b, `facts/trap-${String(i + 1).padStart(2, "0")}-b.md`, [c], he);
  });

  // Name usage: many notes in the preferred spelling (with prefixes, aliases and glosses), then the variants.
  const usage: string[] = [
    "ביקרנו בירושלים בחורף, וירושלים הייתה קרה.",
    "מירושלים נסענו לחיפה ומשם לבאר שבע.",
    "ירושלים (Jerusalem) היא עיר הבירה.",
    "חג חנוכה מתחיל בכ״ה בכסלו; בחנוכה מדליקים נרות.",
    "הרמב״ם, משה בן מימון, כתב את משנה תורה.",
    "את ספרי הרמב״ם קוראים עד היום.",
    "שירי רחל המשוררת על הכנרת מוכרים לכולם.",
    "בן גוריון ודוד בן גוריון הם אותו אדם.",
    "בטכניון ובאוניברסיטה העברית לומדים הנדסה ומדעים.",
    "הספרייה הלאומית פתוחה לקהל.",
    "בתיאטרון הבימה מציגים מחזות קלאסיים.",
    "הר החרמון מושלג בחורף, והכנרת מתמלאת.",
    "קריית שמונה וירוחם הן עיירות פיתוח.",
    "בתל אביב ובירושלים יש רכבת קלה.",
    "עדה לאבלייס ואלן טיורינג הם מחלוצי המחשוב.",
    "אקמי רובוטיקה היא חברה מומצאת לצורך הדוגמה.",
  ];
  usage.forEach((p, i) => note(b, `usage/u-${String(i + 1).padStart(2, "0")}.md`, [p]));
  note(b, "usage/english.md", ["Jerusalem and Haifa are cities; Hanukkah is a festival. Maimonides wrote in Arabic."], false);
  note(b, "usage/poem.md", ["בִּירוּשָׁלַיִם שֶׁל זָהָב, וְשֶׁל נְחֹשֶׁת וְשֶׁל אוֹר — יְרוּשָׁלַיִם עִיר עַתִּיקָה."]);

  const variants: Array<[string, PlantedSpan["kind"], string]> = [
    ["בירושלם העתיקה יש סמטאות צרות.", "name-variant", "ירושלם"],
    ["החנוכּה של השנה יוצא בדצמבר.", "name-variant", "חנוכּה"],
    ["בחנוכּה אוכלים לביבות.", "name-variant", "חנוכּה"],
    ["ירושלם של מטה וירושלים של מעלה.", "name-variant", "ירושלם"],
    ["חגגנו את Hanukkah עם המשפחה.", "foreign-script-name", "Hanukkah"],
    ["נסענו ל-Haifa לסוף שבוע.", "foreign-script-name", "Haifa"],
    ["הכתבים של Maimonides תורגמו לעברית.", "foreign-script-name", "Maimonides"],
    ["ביקור ב-Technion היה מרשים.", "foreign-script-name", "Technion"],
    ["שטנו בכינרת בקיץ.", "name-variant", "כינרת"],
    ["חנוכּה הוא חג האורים.", "name-variant", "חנוכּה"],
    ["שוב Jerusalem, הפעם בשלג.", "foreign-script-name", "Jerusalem"],
    ["הטיול לקרית שמונה נדחה.", "name-variant", "קרית שמונה"],
  ];
  variants.forEach(([p, kind, text], i) => {
    const n = note(b, `variants/v-${String(i + 1).padStart(2, "0")}.md`, [p]);
    span(b, n, kind, text, p);
  });

  const terms: Array<[string, string, boolean]> = [
    ["שלחתי לך אימייל עם הקבצים.", "אימייל", true],
    ["המייל הגיע בבוקר.", "מייל", true],
    ["חיפשתי את זה באינטרנט.", "אינטרנט", true],
    ["האפליקציה נסגרת לבד.", "אפליקציה", true],
    ["נרשמתי לוורקשופ בכתיבה.", "וורקשופ", true],
    ["Please send an e-mail before Friday.", "e-mail", false],
    ["ובאינטרנט כתוב אחרת.", "אינטרנט", true],
    ["שלחו אימייל תזכורת.", "אימייל", true],
    ["האפליקציה החדשה מהירה יותר.", "אפליקציה", true],
    ["E-mail is still the main channel.", "E-mail", false],
  ];
  terms.forEach(([p, text, he], i) => {
    const n = note(b, `terms/t-${String(i + 1).padStart(2, "0")}.md`, [p], he);
    span(b, n, "term-variant", text, p);
  });
  // Term traps: a longer word, inline code, a link target.
  note(b, "terms/trap.md", ["קיבלתי שלושה מיילים היום, ויש לי `email` בקוד.", "ראו [כאן](https://example.org/internet) ובאתר."]);

  const n = b.notes.length;
  void n;
  return { notes: b.notes, entities: ENTITIES, planted: b.planted };
}
