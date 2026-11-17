/**
 * Parts of speech for Hebrew, on this device (plan W13.R5, phase 1): noun,
 * verb, adjective, or other (function words, pronouns, adverbs, numbers).
 * Rules and a small hand-made lexicon — no model, no download. Phase 2
 * swaps in a local model (DictaBERT-joint, once its licence clears gate
 * 0.10) behind the same `tagHebrew` signature.
 *
 * How a word is tagged, first match wins:
 *  1. closed classes: prepositions, pronouns (and their inflected forms:
 *     שלי, אותו, עליה), conjunctions, particles, question words, adverbs and
 *     numbers → other;
 *  2. the lexicon of common verbs and adjectives, after peeling up to three
 *     prefix letters (ו ש כש ה ב ל מ);
 *  3. verb morphology: infinitive (לכתוב, להגיע, להתחיל), the hitpael
 *     (התקדם), future and past forms by their affixes;
 *  4. adjective morphology: the relational -י / -ית / -יים / -יות
 *     (כלכלי, ישראלית) and the agreement rule — after a noun with the
 *     article, a word with the article that is not a noun of the lexicon is
 *     its adjective (הבית הגדול);
 *  5. context: after a personal pronoun a participle is a verb (הוא כותב);
 *  6. otherwise a noun (most open-class Hebrew words are).
 *
 * Accuracy on a held-out set of 300 hand-tagged words is in
 * src/__tests__/immersivePos.test.ts (the set was never used to tune these
 * rules; src/text/posDev.ts is the development set).
 */

export type Pos = "noun" | "verb" | "adj" | "other";

const MARKS = /[֑-ׇ]/g;
/** Letters only: niqqud and cantillation removed, maqaf and quotes kept out. */
export const plainHebrew = (w: string) => w.normalize("NFD").replace(MARKS, "").normalize("NFC").replace(/^[^א-ת]+|[^א-ת"״'׳]+$/g, "");

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const OTHER = words(`
את של על אל עם מן מ ב ל כ ו ש ה גם רק לא אין יש כי אם או אבל אך אלא כמו כל זה זאת זו אלה אלו הוא היא הם הן אני אתה אנחנו אתם אתן
מה מי איך למה מדוע מתי איפה היכן לאן מאין כמה האם כאן פה שם עכשיו כעת אז היום מחר אתמול עוד כבר מאוד אחרי לפני בין תחת מול ליד אצל בלי
בגלל למען כדי אשר אף אפילו בערך כן לכן אולי תמיד לעולם שוב יחד ביחד הרבה מעט קצת די רוב חלק כגון כלומר אמנם אולם לעומת עד מאז כאשר
כש בזמן כיוון מפני היות מכיוון אילו לו אלמלא אחד אחת שניים שתיים שני שתי שלושה שלוש ארבעה ארבע חמישה חמש שישה שש שבעה שבע שמונה
תשעה תשע עשרה עשר עשרים שלושים ארבעים חמישים מאה מאות אלף אלפים מיליון לי לך לו לה לנו לכם לכן להם להן שלי שלך שלו שלה שלנו שלכם
שלהם שלהן אותי אותך אותו אותה אותנו אתכם אותם אותן איתי איתך איתו איתה איתנו איתם עליי עליך עליו עליה עלינו עליהם אליי אליך אליו אליה
אלינו אליהם בי בך בו בה בנו בכם בהם בהן ממני ממך ממנו ממנה מהם מהן לפניו אחריו ביניהם בשבילי בשביל עבור אצלי אצלו אצלה אצלנו כמוני
כמוהו כמוה כזה כזאת כאלה ככה כך כן לא-ל לאחר לקראת סביב בתוך מתוך דרך נגד אודות ע"י ע״י לגבי אצל אחר אחרת אחרים אחרות עצמו עצמה עצמם
עצמי עצמך עצמנו זהו זוהי הנה הרי שוב בכל בשום שום אף-אחד משהו מישהו כלום דבר-מה איזה איזו אילו אלו עדיין רק-לא בעצם בדיוק במיוחד בעיקר
לפחות ממש פשוט כנראה בטח אכן ודאי בוודאי באמת כמעט יותר פחות הכי ביותר כה כל-כך לגמרי לעתים לפעמים בדרך-כלל מיד מייד אחר-כך בקרוב
לפי במשך הביתה מחדש כדאי אפשר אלפי אלפיים מהר מאוחר מוקדם בחינם בשקט לאט פתאום יחסית כמובן שלא לחינם בכלל-לא
הלאה לשם משם לכאן מכאן למעלה למטה בחוץ בפנים קודם קודם-כל לבסוף בסוף בהתחלה כלל-לא בכלל אגב בינתיים במקום ואילו הואיל אפוא לכן-גם
`);

/** Verbs as written in their common forms (past, present, future, infinitive), without prefix letters. */
const VERBS = words(`
היה היתה הייתה היו יהיה תהיה יהיו להיות הייתי היינו אמר אמרה אמרו אומר אומרת אומרים לומר אמרתי יאמר הלך הלכה הלכו הולך הולכת הולכים ללכת
אלך ילך תלך נלך בא באה באו בואו לבוא יבוא תבוא ראה ראתה ראו רואה רואים לראות ראיתי יראה ידע ידעה ידעו יודע יודעת יודעים לדעת ידעתי
עשה עשתה עשו עושה עושים לעשות עשיתי יעשה נתן נתנה נתנו נותן לתת נתתי ייתן לקח לקחה לקחו לוקח לקחת לקחתי יקח רצה רצתה רצו רוצה רוצים
לרצות רציתי יכול יכולה יכולים יכלה יכלו יוכל תוכל לכתוב כתב כתבה כתבו כותב כותבת כותבים כתבתי יכתוב תכתוב קרא קראה קראו קורא קוראת
קוראים לקרוא קראתי יקרא תקרא שמע שמעה שמעו שומע לשמוע שמעתי ישמע חשב חשבה חשבו חושב חושבת חושבים לחשוב חשבתי ישב ישבה ישבו יושב
יושבת לשבת עמד עמדה עמדו עומד עומדת לעמוד קם קמה קמו קום לקום מצא מצאה מצאו מוצא למצוא מצאתי ימצא שאל שאלה שאלו שואל לשאול שאלתי
ענה ענתה ענו עונה לענות דיבר דיברה דיברו מדבר מדברת מדברים לדבר ביקש ביקשה ביקשו מבקש מבקשת לבקש סיפר סיפרה סיפרו מספר לספר סיפרתי
התחיל התחילה התחילו מתחיל מתחילה להתחיל יתחיל הגיע הגיעה הגיעו מגיע מגיעה להגיע יגיע הבין הבינה הבינו מבין מבינה להבין הבנתי החליט
החליטה החליטו מחליט להחליט הסביר הסבירה מסביר להסביר המשיך המשיכה ממשיך להמשיך ימשיך הרגיש הרגישה מרגיש להרגיש הציע הציעה מציע להציע
הראה הראתה מראה להראות עבד עבדה עבדו עובד עובדת עובדים לעבוד עבדתי למד למדה למדו לומד לומדת לומדים ללמוד למדתי לימד מלמד ללמד אהב אהבה
אהבו אוהב אוהבת אוהבים לאהוב אכל אכלה אכלו אוכל אוכלת לאכול שתה שתתה שותה לשתות ישן ישנה ישנו לישון גר גרה גרו גרים לגור נסע נסעה נסעו
נוסע לנסוע יצא יצאה יצאו יוצא לצאת יצאתי נכנס נכנסה נכנסו להיכנס חזר חזרה חזרו חוזר לחזור חזרתי שם שמה לשים קנה קנתה קנו קונה לקנות
מכר מכרה מוכר למכור פתח פתחה פתחו פותח לפתוח סגר סגרה סוגר לסגור שלח שלחה שלחו שולח לשלוח קיבל קיבלה קיבלו מקבל לקבל בנה בנתה בנו בונה
לבנות נולד נולדה נולדו מת מתה מתו נפטר נפטרה נשאר נשארה נשארו להישאר נראה נראית נראים נמצא נמצאת נמצאים נעשה נעשתה נקבע נקבעה נאמר
נכתב נכתבה פורסם פורסמה הוקם הוקמה הוחלט בוצע בוצעה צריך צריכה צריכים צריך-ל חייב חייבת חייבים מותר אסור שכח שכחה שוכח לשכוח זכר
זכרה זוכר לזכור עזר עזרה עוזר לעזור ניסה ניסתה מנסה לנסות שינה שינתה משנה לשנות שיחק שיחקה משחק לשחק פגש פגשה פוגש לפגוש קרה קרתה
קורה לקרות קרו הפך הפכה הופך להפוך נהיה נהייתה הוסיף הוסיפה מוסיף להוסיף הודיע הודיעה מודיע להודיע טען טענה טוען טוענת לטעון ציין
ציינה מציין לציין הדגיש הדגישה מדגיש להדגיש נדרש נדרשה דורש לדרוש התקדם מתקדם להתקדם התפתח מתפתח להתפתח השתמש משתמש משתמשים להשתמש
התחלתי התחלנו הבאתי מביא להביא הביא הביאה ניהל מנהל לנהל בדק בדקה בודק לבדוק כתבנו אמרנו עשינו הלכנו ראינו ישבנו שמענו קראנו
מצליח הצליח הצליחה להצליח נכשל נכשלה להיכשל רץ רצה רצים לרוץ עף עפה לעוף נפל נפלה נופל ליפול צחק צחקה צוחק לצחוק בכה בכתה בוכה לבכות
`);

/** Adjectives in their four forms, without the article. */
const ADJS = words(`
גדול גדולה גדולים גדולות קטן קטנה קטנים קטנות טוב טובה טובים טובות רע רעה רעים רעות חדש חדשה חדשים חדשות ישן ישנה ישנים ישנות יפה יפים יפות
ארוך ארוכה ארוכים ארוכות קצר קצרה קצרים קצרות גבוה גבוהה גבוהים נמוך נמוכה חזק חזקה חזקים חלש חלשה חם חמה חמים קר קרה קרים מהיר מהירה
מהירים איטי איטית קשה קשים קשות קל קלה קלים קלות חשוב חשובה חשובים חשובות רב רבה רבים רבות ראשון ראשונה ראשונים אחרון אחרונה אחרונים
שני שנייה שלישי שלישית רביעי חמישי מלא מלאה ריק ריקה עשיר עשירה עני ענייה צעיר צעירה צעירים זקן זקנה שמח שמחה שמחים עצוב עצובה עייף עייפה
רעב רעבה נכון נכונה נכונים פשוט פשוטה פשוטים מסובך מסובכת ברור ברורה ברורים שונה שונים שונות דומה דומים כבד כבדה יקר יקרה יקרים זול זולה
לבן לבנה שחור שחורה אדום אדומה ירוק ירוקה כחול כחולה צהוב צהובה חכם חכמה טיפש נחמד נחמדה נעים נעימה מעניין מעניינת מעניינים מסוים מסוימת
אפשרי אפשרית מיוחד מיוחדת מיוחדים כללי כללית מרכזי מרכזית עיקרי עיקרית אישי אישית ציבורי ציבורית לאומי לאומית מקומי מקומית עברי עברית
ישראלי ישראלית אמריקאי חברתי חברתית כלכלי כלכלית פוליטי פוליטית ממשלתי מדעי מדעית טכנולוגי דיגיטלי מודרני מודרנית עתיק עתיקה רחב רחבה
צר צרה עמוק עמוקה רחוק רחוקה קרוב קרובה אמיתי אמיתית מושלם מושלמת שלם שלמה שלמים בטוח בטוחה מסוכן מסוכנת נקי נקייה מלוכלך פתוח פתוחה
סגור סגורה חופשי חופשית עסוק עסוקה מוכן מוכנה מוכנים ידוע ידועה ידועים מפורסם מפורסמת חי חיה חיים-ת חולה חולים בריא בריאה יחיד יחידה
אחרונות קודם קודמת הבא הבאה הבאים נוסף נוספת נוספים נוספות מלא-ה שקט שקטה רועש רועשת עצום עצומה זעיר משמעותי משמעותית יעיל יעילה
`);

/** Nouns that the rules above would take for something else (a הX-י-X noun, a word in -ית, a ל-noun). */
const NOUNS = words(`
בית ספר עברית ערבית תעשייה עירייה ספרייה מדינה ממשלה משפחה חברה עבודה שאלה תשובה שנה שנים יום ימים לילה בוקר ערב זמן מקום עיר ארץ עולם
אדם אנשים איש אישה נשים ילד ילדה ילדים אב אם הורים אח אחות מורה תלמיד תלמידים סטודנט ספר ספרים מכתב שיר דף עמוד פרק סיפור מילה מילים
משפט משפטים שפה שפות ראש יד ידיים רגל עין עיניים פה לב כסף מחיר רכב מכונית דרך רחוב כביש שוק חנות מחשב טלפון מים אוכל לחם תשבץ מבחן
שיעור כיתה הכיתה מוזיאון אוניברסיטה מחקר מאמר נושא רעיון בעיה פתרון תוכנית תכנית מערכת חוק החלטה ועדה כנסת בחירות מלחמה שלום צבא ים
הר שמש ירח כוכב שמיים אור חושך רוח אש עץ עצים פרח פרחים גן כלב חתול ציפור דג חיים מוות אהבה שמחה פחד כאב תקווה חלום אמת שקר קול צבע
ישיבה פגישה הודעה דוח תוצאה תוצאות אפשרות סיבה דרכים ארגון מנהל מנהלת ראש-הממשלה נשיא שר מחלקה בעלים לקוח לקוחות מוצר שירות אתר דפדפן
`);

/** Peel up to three prefix letters in a valid order (ו first; ה, ב, ל end the prefix; כ only before ש; מ before ה or ש). */
const NEXT: Record<string, string> = { ו: "שהבכלמ", ש: "הבכלמ", כ: "ש", מ: "הש", ה: "", ב: "", ל: "" };
export function peel(word: string): Array<{ stem: string; prefix: string }> {
  const out = [{ stem: word, prefix: "" }];
  let rest = word;
  let prev: string | null = null;
  for (let i = 0; i < 3 && rest.length > 2 && rest[0] in NEXT && (prev === null || NEXT[prev].includes(rest[0])); i++) {
    prev = rest[0];
    rest = rest.slice(1);
    out.push({ stem: rest, prefix: word.slice(0, word.length - rest.length) });
    if (rest.startsWith("וו")) out.push({ stem: rest.slice(1), prefix: word.slice(0, word.length - rest.length) });
  }
  return out;
}

const PRONOUNS = words("אני אתה את הוא היא אנחנו אתם אתן הם הן");

/** The class of one word, with what came before (for the agreement and pronoun rules). */
export function tagHebrewWord(raw: string, prev?: { plain: string; pos: Pos }): Pos {
  const w = plainHebrew(raw).replace(/["״'׳]/g, (q) => (q === "״" ? '"' : q));
  if (!w) return "other";
  if (/^\d/.test(w)) return "other";
  // Acronyms with gershayim (צה"ל, ארה"ב) are names: nouns.
  if (/"/.test(w)) return OTHER.has(w) ? "other" : "noun";
  if (OTHER.has(w)) return "other";
  const cands = peel(w);
  // Prefix letters that only a noun or adjective takes: the article (ה) and ב/כ/ל absorbing it.
  for (const { stem, prefix } of cands) {
    if (NOUNS.has(stem)) return "noun";
    if (ADJS.has(stem)) {
      // An adjective after a noun with the same article; a bare one after a bare noun; or standing alone.
      return "adj";
    }
    if (VERBS.has(stem) && !/[הבכ]$/.test(prefix) && !(prefix.endsWith("ל") && !/^(ל|ול|של|כשל)$/.test(prefix))) return "verb";
    if (OTHER.has(stem) && prefix && stem.length > 1) return "other";
  }
  const base = cands.find((c) => !/[הבכלמ]$/.test(c.prefix))?.stem ?? w;
  const hasArticle = cands.some((c) => /ה$/.test(c.prefix) && c.stem.length >= 2);
  // Infinitive: ל + root in its infinitive patterns.
  if (/^(ו|ש)?(ל[א-ת]ו[א-ת]{2}|לה[א-ת]{1,2}י[א-ת]|להת[א-ת]{3,4}|לה[א-ת]{3}|לי[א-ת]{3})$/.test(w) && !/(ות|ים)$/.test(w)) return "verb";
  // Hitpael (התקדם, מתקדמים, יתקדם) — not its nouns in -ות.
  if (/^(הת|מת|ית|נת|תת|את)[א-ת]{3,4}$/.test(base) && !/(ות|ה)$/.test(base)) return "verb";
  // Past: -תי -תם -תן -נו after a three-letter root (not a possessive -נו after a noun ending).
  if (/^[א-ת]{3,4}(תי|תם|תן)$/.test(base) && !hasArticle) return "verb";
  // Future: א/ת/י/נ + C C ו C (יכתוב), + C י C (יגיע).
  if (/^[יתנא][א-ת]{2}ו[א-ת]$/.test(base) && !hasArticle) return "verb";
  if (/^[יתנ][א-ת]{1,2}י[א-ת]ו?$/.test(base) && base.length >= 4 && !hasArticle) return "verb";
  if (!hasArticle) {
    // Past 1st person plural (נסענו, אכלנו) and 1st singular are verbs; a noun with "our" (ביתנו) is rarer in prose.
    if (/^[א-ת]{3,4}נו$/.test(base)) return "verb";
    // Nif'al past (נשמר, נפתח) and pu'al / huf'al past plural (פורסמו).
    if (/^נ[א-ת]{3}$/.test(base) && !/[הת]$/.test(base)) return "verb";
    if (/^[א-ת]ו[א-ת]{3}ו$/.test(base)) return "verb";
    // Future: prefix + three root letters (יגדל, יפעל), the huf'al (יופעל), plural -ו (יגיעו).
    if (/^[יתנא]ו?[א-ת]{3}ו?$/.test(base) && !/(ה|ת|ם|ן|ים|ות)$/.test(base) && base.length >= 4) return "verb";
    // Infinitives the first test missed: ל + C C ו C (לכתוב, ללחוץ), ל + C C ות (לכבות), להי + root (להירגע).
    if (/^(ו|ש)?(ל[א-ת]{2}ו[א-ת]|ל[א-ת]{2}ות|להי[א-ת]{3})$/.test(w)) return "verb";
    // A participle after its subject — a noun or a pronoun — is the verb of the clause:
    // מ- forms (מתלוננים, מספרת, מגדלת), C ו C C forms (טוענים, עורכים), nif'al נ- forms (נכנסים).
    const subject = prev && (PRONOUNS.has(prev.plain) || prev.pos === "noun" || prev.pos === "adj");
    if (subject && (/^([א-ת]ו[א-ת]{2}|נ[א-ת]{3})(ת|ים|ות)$/.test(base) || /^מ[א-ת]{3,4}(ת|ה|ים|ות)?$/.test(base))) return "verb";
    // After ש (that, who), a three-letter word is the past tense (שעבר, שישן).
    if (cands.some((c) => /^(ש|כש|וש)$/.test(c.prefix) && /^[א-ת]{3}$/.test(c.stem) && !/[הת]$/.test(c.stem))) return "verb";
  }
  // Present participle of the qal, feminine (זורחת, דורשת, כותבת): the verb of its clause.
  if (/^[א-ת]ו[א-ת]{2}ת$/.test(base) && !hasArticle && prev && !/^(של|על|את|עם|אל|כל|בין|לפני|אחרי)$/.test(prev.plain)) return "verb";
  // Pi'el past after its subject (החברה פיתחה, המנהל ביקש).
  if (/^[א-ת]י[א-ת]{2}(ה|ו)?$/.test(base) && !hasArticle && (prev?.pos === "noun" || prev?.pos === "adj")) return "verb";
  // Relational adjectives: -י, -ית, -יים, -יות on a stem of 3+ letters.
  if (/^[א-ת]{3,}(י|ית|יים|יות)$/.test(base) && !/(ות|ית)$/.test(base.slice(0, -1)) && base.length >= 5) {
    // An -ית word right after a noun agrees with it; at the head of a phrase it is more often a noun (חנית, תוכנית).
    if (!base.endsWith("ית") || prev?.pos === "noun") return "adj";
  }
  // Agreement: a word with the article right after a noun with the article.
  if (hasArticle && prev?.pos === "noun" && /^(ה|וה|שה|כשה)/.test(prev.plain) && !/^(ה|וה|שה)?(זה|זאת|זו|אלה|הוא|היא|הם|הן)$/.test(w)) return "adj";
  // A participle after a personal pronoun is the verb of the clause (הוא כותב, אנחנו מבינים).
  if (prev && PRONOUNS.has(prev.plain) && !hasArticle && /^[א-ת]{3,6}$/.test(base) && (/^מ/.test(base) || /^[א-ת]ו[א-ת]{2}(ת|ים|ות)?$/.test(base))) return "verb";
  return "noun";
}

/** Tag every word of `text`: the word, where it is, and its class. */
export function tagHebrew(text: string): Array<{ word: string; from: number; to: number; pos: Pos }> {
  const out: Array<{ word: string; from: number; to: number; pos: Pos }> = [];
  let prev: { plain: string; pos: Pos } | undefined;
  // Maqaf (U+05BE) joins two words that are tagged apart (על־פני).
  for (const m of text.matchAll(/[\u05d0-\u05ea][\u05d0-\u05ea\u0591-\u05bd\u05bf-\u05c7"״'׳]*/g)) {
    const pos = tagHebrewWord(m[0], prev);
    out.push({ word: m[0], from: m.index ?? 0, to: (m.index ?? 0) + m[0].length, pos });
    prev = { plain: plainHebrew(m[0]), pos };
  }
  return out;
}
