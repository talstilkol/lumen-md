/**
 * Function words (W13.W11): the words a repetition check must never flag.
 * Pronouns, prepositions with their pronoun suffixes, conjunctions,
 * particles, the copula and auxiliaries, quantifiers and the commonest
 * adverbs — in comparison form (niqqud stripped, final letters folded:
 * ם → מ, ן → נ, ך → כ, ף → פ, ץ → צ).
 *
 * A Hebrew word is a function word when it, or the word without up to three
 * prefix letters (ו ה ב ל מ ש כ), is listed: "ושלא", "וכשהוא" and "שבהמ"
 * are function words like "לא", "הוא" and "בהמ".
 *
 * Hand-written for lumen-md (CC0); no external list was copied.
 */

const HE = `
אני אתה את אתמ אתנ הוא היא הם המ הנ הן אנחנו אנו נחנו
זה זו זאת אלה אלו הלז ההוא ההיא ההמ ההנ
של שלי שלכ שלו שלה שלנו שלכמ שלכנ שלהמ שלהנ
את אותי אותכ אותו אותה אותנו אתכמ אתכנ אותמ אותנ
על עלי עליי עליכ עליו עליה עלינו עליכמ עליהמ עליהנ
אל אלי אליי אליכ אליו אליה אלינו אליכמ אליהמ
עמ עמי איתי איתכ איתו איתה איתנו איתכמ איתמ איתנ אתי
בי בכ בו בה בנו בכמ בהמ בהנ לי לכ לו לה לנו לכמ להמ להנ
ממני ממכ ממנו ממנה מכמ מהמ מהנ כמוני כמוכ כמוהו כמוה כמונו כמוהמ
בין ביני בינכ בינו בינה בינינו ביניהמ לפני אחרי אחר אחרת אחרימ אחרות
תחת מתחת מעל ליד אצל עד מנ מאז בלי ללא לגבי אודות בשביל למענ כדי מפני בגלל עקב לקראת נגד כלפי דרכ
כמו כ אשר כי ש אמ או וגמ גמ אכ אבל אולמ אלא לכנ לפיככ כלומר אפילו אפ אפשר
לא אינ אינני אינכ אינו אינה איננו אינמ לו לולא בל אל
כנ יש אינ היה היתה הייתה היו יהיה תהיה יהיו נהיה אהיה הייתי היינו הייתמ להיות הוה
כל כול כלל הרבה מעט קצת כמה מספר יותר פחות מאוד ממש די כה ככ ככה כנ
רק עוד כבר גמ אז עכשיו כעת היומ אתמול מחר תמיד לפעמימ שוב פה כאנ שמ הנה הלא
מה מי מתי איפה היכנ איכ כיצד למה מדוע האמ איזה איזו אילו כמה
עצמו עצמה עצמי עצמנו עצממ
`;

const EN = `
a an the this that these those there here it its it's itself i me my mine myself you your yours yourself
he him his himself she her hers herself we us our ours ourselves they them their theirs themselves
who whom whose which what when where why how whether if then than so because as since while although though
and or nor but yet also not no yes only just even very quite rather too more most less least much many
some any all each every both either neither few several such same other another
of in on at by for with without from to into onto upon over under about above below between among through
during before after against within along across toward towards around up down out off near via per
is are was were be been being am do does did done doing have has had having
will would shall should can could may might must ought let get got
one ones lot lots thing things way ways really still again ever never always often already
now today well like
`;

const words = (s: string) => s.split(/\s+/).filter(Boolean);
export const HEBREW_FUNCTION_WORDS: ReadonlySet<string> = new Set(words(HE));
export const ENGLISH_FUNCTION_WORDS: ReadonlySet<string> = new Set(words(EN));

const PREFIX = /^[והבלמשכ]/;

/** Is this (comparison-form) word a function word? */
export function isFunctionWord(norm: string): boolean {
  if (ENGLISH_FUNCTION_WORDS.has(norm) || HEBREW_FUNCTION_WORDS.has(norm)) return true;
  let w = norm;
  for (let i = 0; i < 3 && w.length > 1 && PREFIX.test(w); i++) {
    w = w.slice(1);
    if (HEBREW_FUNCTION_WORDS.has(w)) return true;
  }
  return false;
}
