/**
 * W13.W7 — a labelled set of documents for the structure critic, Hebrew and
 * English: each document is built from sections whose problems are known
 * (a skipped level, a lone subsection, an empty section, …) and from traps
 * that must stay quiet (a code fence with "####", back matter with one
 * subsection, a note that starts at H2, a 199-word paragraph, a document
 * that does close with "לסיכום" / "In conclusion").
 *
 * Every label is (kind, line). Synthetic, written for lumen-md (MIT): a dev
 * set (eval card tag "dev").
 */

export interface Labelled {
  id: string;
  lang: "he" | "en";
  text: string;
  expected: Array<{ kind: string; line: number }>;
}

/** Paragraphs that open on what they are about (≥ 4 sentences, ≥ 60 words). */
const TOPIC = {
  he: [
    "מחזור המים הוא התהליך שבו המים נעים בלי הפסקה בין הים, האוויר והיבשה. בחום השמש המים מתאדים מפני הים והאגמים. אדי המים עולים, מתקררים באוויר הגבוה והופכים לטיפות קטנות שיוצרות עננים. כשהטיפות כבדות מדי, הן יורדות כגשם או כשלג על היבשה. המים זורמים בנחלים ובנהרות ומחלחלים לאדמה, ובסוף חוזרים אל הים, וכך מחזור המים מתחיל מחדש.",
    "הספרייה העירונית היא הרבה יותר ממקום שמשאילים בו ספרים. בספרייה יש חדר עיון שקט שבו תלמידים מכינים שיעורים אחרי הלימודים. בכל שבוע הספרייה מארחת מפגשי סיפור לילדים ושיחות עם סופרים מקומיים. מבוגרים לומדים בספרייה להשתמש במחשב ולמלא טפסים מקוונים. לכן הספרייה העירונית משמשת כמרכז קהילתי של ממש, פתוח לכל תושבי העיר בלי תשלום.",
    "השינה חשובה ללמידה לא פחות מן השיעורים עצמם. בזמן השינה המוח מסדר את מה שלמדנו במשך היום ושומר אותו בזיכרון לטווח ארוך. מחקרים מראים שתלמידים שישנו היטב לפני מבחן זוכרים יותר פרטים ועונים מהר יותר. חוסר שינה פוגע בריכוז ובמצב הרוח, ולכן קשה ללמוד חומר חדש. מי שרוצה ללמוד טוב צריך לשמור על שעות שינה קבועות גם בתקופת מבחנים.",
    "גינה קהילתית מחברת בין שכנים שלא היו נפגשים אחרת. בגינה כל משפחה מקבלת ערוגה קטנה ומגדלת בה ירקות ופרחים. השכנים משתפים ביניהם זרעים, כלים ועצות על השקיה ועל דישון. ילדים לומדים בגינה מאין מגיע האוכל ואיך מטפלים בצמחים. עם הזמן הגינה הקהילתית הופכת למקום מפגש שבו נוצרות חברויות חדשות בין אנשים מכל הגילים.",
    "התחבורה הציבורית בעיר השתפרה מאוד בעשור האחרון. קווי אוטובוס חדשים מחברים היום שכונות שהיו מנותקות מן המרכז. הרכבת הקלה מקצרת את זמן הנסיעה לעבודה בחצי שעה ויותר. כרטיס אחד משמש לכל אמצעי התחבורה, והמחיר נקבע לפי המרחק. בזכות השיפורים בתחבורה הציבורית יותר תושבים משאירים את המכונית בבית ונוסעים באוטובוס או ברכבת.",
    "האקלים בים התיכון ידוע בקיץ חם ויבש ובחורף מתון וגשום. בקיץ כמעט אין גשם, והטמפרטורות עולות לעתים מעל שלושים מעלות. בחורף יורדים רוב הגשמים של השנה, בעיקר בין נובמבר למרץ. הצמחים באזור התאימו את עצמם לאקלים: יש להם עלים קשים ושורשים עמוקים שמגיעים למים. בגלל האקלים הזה גדלים באזור זיתים, גפנים ותאנים כבר אלפי שנים.",
  ],
  en: [
    "The water cycle is the process that keeps water moving between the sea, the air and the land. Heat from the sun makes water evaporate from oceans and lakes. The vapour rises, cools in the upper air and forms the tiny droplets that make clouds. When the droplets grow heavy, they fall back as rain or snow. Rivers and groundwater carry the water back to the sea, and the water cycle begins again.",
    "A public library offers far more than books to borrow. Its quiet reading room gives students a place to do homework after school. Every week the library hosts story hours for children and talks by local authors. Adults come to learn how to use a computer and fill in forms online. In this way the public library works as a real community centre, open to everyone in town free of charge.",
    "Sleep matters for learning as much as the lessons themselves. During sleep the brain sorts what we learned in the day and stores it in long-term memory. Studies show that students who sleep well before an exam recall more details and answer faster. Lack of sleep harms focus and mood, which makes new material hard to learn. Anyone who wants to learn well should keep regular sleeping hours, even during exams.",
    "A community garden brings together neighbours who would not otherwise meet. Each family gets a small bed and grows vegetables and flowers in it. Neighbours share seeds, tools and advice on watering and compost. Children learn in the garden where food comes from and how to care for plants. Over time the community garden becomes a meeting place where friendships form across all ages.",
    "Public transport in the city has improved greatly in the last decade. New bus lines now link neighbourhoods that used to be cut off from the centre. The light rail shortens the commute by half an hour or more. One card works on every mode, and the fare depends on the distance travelled. Thanks to these improvements in public transport, more residents leave the car at home and take the bus or the train.",
    "The Mediterranean climate is known for hot, dry summers and mild, rainy winters. In summer there is almost no rain, and temperatures often rise above thirty degrees. Most of the year's rain falls in winter, mainly between November and March. Plants in the region have adapted to the climate with tough leaves and deep roots that reach water. Because of this climate, olives, vines and figs have grown in the region for thousands of years.",
  ],
};

/** Paragraphs without a topic sentence: they open on a connective, a question, or a sentence that is about something else. */
const NO_TOPIC = {
  he: [
    "בנוסף, הם הביאו איתם כלים, זרעים וספרים שנשמרו עשרות שנים. החבילות הגיעו בספינה אחרי מסע ארוך של כמה שבועות בים. חלק מן הזרעים נבטו כבר באביב הראשון, וחלק לא נבטו בכלל. הספרים עברו מיד לבית הספר החדש, שהיה עדיין בלי ספרייה. הכלים שימשו את המשפחות במשך כל החורף הראשון בבתים החדשים.",
    "לעומת זאת, בצפון הארץ המצב היה שונה לגמרי מבחינת כמות המשקעים. הגשם ירד שם מוקדם יותר, ולעתים כבר באוקטובר. הנחלים התמלאו מהר, והחקלאים יכלו לזרוע לפני כולם. בחורפים קרים במיוחד ירד שלג על ההרים הגבוהים. האנשים באזור התרגלו לבנות בתים עם גגות משופעים וקירות עבים.",
    "מה קורה כשמכונה מפסיקה לעבוד באמצע הלילה? הטכנאי מקבל הודעה בטלפון ונוסע למפעל. לפעמים התקלה פשוטה, ומספיק להפעיל את המכונה מחדש. במקרים אחרים צריך להזמין חלק חלופי מספק בחו״ל. בינתיים הייצור עובר לקו אחר, והעובדים במשמרת הבאה ממשיכים משם. בסוף כל חודש מסכמים את כל התקלות בדוח אחד.",
    "גם המורים הצטרפו ליוזמה אחרי כמה חודשים של היסוס ודיונים בחדר המורים. הם קבעו שעות קבועות שבהן הכיתות פתוחות לתלמידים אחרי הלימודים. ההורים התנדבו להביא כיבוד ולעזור בהשגחה. בסוף השנה נערך טקס קטן שבו הוצגו העבודות של התלמידים. רבים ביקשו להמשיך את הפעילות גם בשנה הבאה.",
    "אחר כך נסענו צפונה לאורך החוף, ועצרנו בכל כפר קטן שראינו בדרך. בכפר הראשון אכלנו דגים טריים שנתפסו באותו בוקר. בכפר השני פגשנו אמן שמצייר רק את הים, בכל שעות היום. הדרך הייתה צרה ומפותלת, והנסיעה ארכה כמעט את כל היום. בערב הגענו לעיירה שבה תכננו לישון, עייפים ומרוצים.",
    "למשל, אפשר לקחת את השוק הישן שבמרכז העיר, שפועל במקום כבר יותר ממאה שנה. הדוכנים בו מוכרים ירקות, תבלינים, בגדים וכלי בית. בימי שישי השוק מלא באנשים שבאים לקנות לשבת. בשנים האחרונות נפתחו בשוק גם מסעדות קטנות ובתי קפה. בלילה, אחרי שהדוכנים נסגרים, הרחובות של השוק מתמלאים בצעירים.",
  ],
  en: [
    "Additionally, they brought tools, seeds and books that had been kept for decades. The crates arrived by ship after a voyage of several weeks. Some of the seeds sprouted in the first spring, and some never did. The books went straight to the new school, which had no library yet. The tools served the families through the whole first winter in their new homes.",
    "However, in the north the picture was quite different in terms of rainfall. The rain came earlier there, sometimes already in October. Streams filled quickly, and farmers could sow before anyone else. In very cold winters snow fell on the high hills. People in the area got used to building houses with sloping roofs and thick walls.",
    "What happens when a machine stops in the middle of the night? The technician gets a message on the phone and drives to the plant. Sometimes the fault is simple and a restart is enough. In other cases a spare part has to be ordered from abroad. Meanwhile production moves to another line, and the next shift carries on from there.",
    "Also the teachers joined the initiative after a few months of doubt and long debates in the staff room. They set fixed hours when classrooms stay open after school. Parents volunteered to bring snacks and help with supervision. At the end of the year a small ceremony showed the pupils' work. Many asked to keep the activity going the following year.",
    "Then we drove north along the coast and stopped in every small village we saw on the way. In the first village we ate fresh fish caught that morning. In the second we met a painter who paints only the sea, at every hour of the day. The road was narrow and winding, and the drive took almost the whole day. In the evening we reached the town where we planned to sleep, tired and happy.",
    "For example, take the old market in the city centre, which has been in the same place for over a hundred years. Its stalls sell vegetables, spices, clothes and kitchenware. On Fridays the market is full of people shopping for the weekend. In recent years small restaurants and cafés have opened there too. At night, after the stalls close, the market streets fill with young people.",
  ],
};

const SHORT = {
  he: ["זה פרק קצר שמסביר את הרעיון בקצרה.", "כאן יש פרטים נוספים על הנושא.", "החלק הזה מתאר את מה שקרה בהמשך.", "בפרק הזה נציג את הנתונים העיקריים."],
  en: ["This short section explains the idea briefly.", "Here are more details on the subject.", "This part describes what happened next.", "This section presents the main figures."],
};

const T = {
  he: { title: "דוח", intro: "המסמך הזה מסכם את הנושא ואת הממצאים העיקריים, ומה יש בכל פרק.", sec: ["רקע", "שיטה", "ממצאים", "דיון", "המלצות", "השלכות"], sub: ["פרט ראשון", "פרט שני", "פרט שלישי"], concl: "סיכום", conclOpener: "לסיכום, הממצאים מראים שהנושא חשוב ושכדאי להמשיך לבדוק אותו.", back: "מקורות", backSub: "ספרים" },
  en: { title: "Report", intro: "This document summarises the subject and the main findings, and what each section holds.", sec: ["Background", "Method", "Findings", "Discussion", "Recommendations", "Implications"], sub: ["First point", "Second point", "Third point"], concl: "Conclusion", conclOpener: "In conclusion, the findings show the subject matters and is worth further study.", back: "References", backSub: "Books" },
};

type Kind = "clean" | "skip" | "lone" | "dup" | "empty" | "intro" | "docIntro" | "concl" | "long" | "topic";

/** A document, its lines, and where each expected finding sits. */
function build(lang: "he" | "en", kind: Kind, v: number): Labelled {
  const t = T[lang];
  const lines: string[] = [];
  const expected: Array<{ kind: string; line: number }> = [];
  const topic = TOPIC[lang];
  const short = SHORT[lang];
  const para = (i: number) => (v % 2 ? topic[(v + i) % topic.length] : short[(v + i) % short.length]);
  const h = (level: number, title: string, mark?: string) => {
    if (mark) expected.push({ kind: mark, line: lines.length });
    lines.push(`${"#".repeat(level)} ${title}`, "");
  };
  const p = (text: string, mark?: string) => {
    if (mark) expected.push({ kind: mark, line: lines.length });
    lines.push(text, "");
  };
  // Traps sprinkled by variant: a code fence with hashes, a list, a note that starts at H2.
  const startsAtH2 = v % 5 === 3;
  if (startsAtH2) lines.push("---", `title: ${t.title}`, "---", "");
  else h(1, `${t.title} ${v + 1}`);
  if (kind !== "docIntro") p(t.intro);
  const secs = t.sec.slice(0, 3 + (v % 3));
  const L = startsAtH2 ? 2 : 2;
  secs.forEach((s, i) => {
    const special = i === 1;
    if (kind === "skip" && special) {
      h(L, s);
      p(para(i));
      h(L + 2, t.sub[0], "heading-skip");
      p(para(i + 1));
      h(L + 2, t.sub[1]);
      p(short[2]);
      return;
    }
    if (kind === "lone" && special) {
      h(L, s, "lone-subheading");
      p(para(i));
      h(L + 1, t.sub[0]);
      p(para(i + 1));
      return;
    }
    if (kind === "dup" && i === 2) {
      h(L, secs[1], "duplicate-heading");
      p(para(i));
      return;
    }
    if (kind === "empty" && special) {
      h(L, s, "empty-section");
      return;
    }
    if (kind === "intro" && special) {
      h(L, s, "no-intro");
      h(L + 1, t.sub[0]);
      p(para(i));
      h(L + 1, t.sub[1]);
      p(para(i + 1));
      return;
    }
    if (kind === "docIntro" && i === 0) {
      h(L, s, "no-intro");
      p(para(i));
      return;
    }
    if (kind === "long" && special) {
      h(L, s);
      p(`${topic[v % topic.length]} ${topic[(v + 1) % topic.length]} ${topic[(v + 2) % topic.length]} ${topic[(v + 3) % topic.length]}`, "long-paragraph");
      return;
    }
    if (kind === "topic" && special) {
      h(L, s);
      p(NO_TOPIC[lang][v % NO_TOPIC[lang].length], "topic-sentence");
      return;
    }
    h(L, s);
    p(para(i));
    if (v % 4 === 1 && i === 0) {
      // Trap: a code fence and a list are neither headings nor paragraphs.
      lines.push("```md", "#### not a heading", "```", "", "- " + short[0], "- " + short[1], "");
    }
    if (v % 4 === 2 && i === 0) {
      // Trap: a proper two-level subsection tree.
      h(L + 1, t.sub[0]);
      p(short[1]);
      h(L + 1, t.sub[1]);
      p(short[2]);
    }
  });
  if (kind === "concl") {
    // Long enough, several sections, and nothing closes it.
    const last = t.sec[5];
    h(L, last, "no-conclusion");
    for (let k = 0; k < 10; k++) p(topic[(v + k) % topic.length]);
  } else if (v % 3 === 0) {
    h(L, t.concl);
    p(t.conclOpener);
  } else if (v % 3 === 1 && kind !== "clean") {
    // Trap: long, but the last paragraph opens on "In conclusion".
    h(L, t.sec[5]);
    for (let k = 0; k < 6; k++) p(topic[(v + k) % topic.length]);
    p(t.conclOpener);
  } else {
    // The last section closes on "In conclusion" without a heading for it.
    p(t.conclOpener);
  }
  // Trap: back matter with a single subsection.
  if (v % 2 === 0) {
    h(L, t.back);
    h(L + 1, t.backSub);
    lines.push("- " + short[3], "");
  }
  return { id: `${lang}-${kind}-${v}`, lang, text: lines.join("\n"), expected };
}

export function structureSet(): Labelled[] {
  const kinds: Kind[] = ["clean", "skip", "lone", "dup", "empty", "intro", "docIntro", "concl", "long", "topic"];
  const out: Labelled[] = [];
  for (const lang of ["he", "en"] as const) for (const k of kinds) for (let v = 0; v < 6; v++) out.push(build(lang, k, v));
  return out;
}
