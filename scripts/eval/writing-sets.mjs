#!/usr/bin/env node
/**
 * Plan W13.W2 — the writing agents' eval sets, generated (synthetic, so
 * every card on them is `dev`: eval:card refuses heldout/public on a
 * synthetic set, W7.13).
 *
 *   node scripts/eval/writing-sets.mjs [--check]
 *
 * Writes eval/writing/<agent>/{he,en}.jsonl (≥ 150 items each) and
 * eval/writing/<agent>/manifest.json. Every item has an `id`, `lang`,
 * `origin: "synthetic"` and a `split`: 30 % of the items are `heldout`,
 * built from a separate half of every bank (other sentences, other issue
 * phrasings, other names), so the held-out score is not a score on the
 * phrases the dev items show. The real held-out set (W6.17: drawn with the
 * evaluator key, encrypted, never in the repo) and real texts (W10.B13)
 * are owed by the owner; until then the cards say dev.
 *
 * --check: exit 1 when a committed file differs from what this writes.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const OUT = join(ROOT, "eval/writing");
export const VERSION = "1";
const PER_LANG = 160;
const HELDOUT_SHARE = 0.3;

/** mulberry32 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
/** Even entries for dev, odd for held-out: the two halves never share a sentence. */
const half = (xs, split) => xs.filter((_, i) => (split === "heldout" ? i % 2 === 1 : i % 2 === 0));

/* ── styleCoach ──────────────────────────────────────────────────────── */

/** [kind, sentence, the span the coach should flag]. Some are phrased so the rules do not cover them (recall is honest). */
const COACH = {
  en: {
    issues: [
      ["passive", "The budget was approved by the board.", "was approved by"],
      ["passive", "The tests were run by the night shift.", "were run by"],
      ["passive", "The house was built in 1990.", "was built"],
      ["passive", "Mistakes were made during the move.", "were made"],
      ["passive", "The letter was sent yesterday.", "was sent"],
      ["passive", "The results have been analysed carefully.", "been analysed"],
      ["passive", "The code is being reviewed now.", "being reviewed"],
      ["passive", "The bridge was swept away by the flood.", "was swept away by"],
      ["passive", "The prize was won by a student from Haifa.", "was won by"],
      ["passive", "The window got broken last night.", "got broken"],
      ["passive", "The report was written by Dana.", "was written by"],
      ["passive", "Her novel was translated into French.", "was translated"],
      ["wordiness", "We met in order to plan the launch.", "in order to"],
      ["wordiness", "The train was late due to the fact that it snowed.", "due to the fact that"],
      ["wordiness", "At this point in time we have no answer.", "At this point in time"],
      ["wordiness", "Call me in the event that the server fails.", "in the event that"],
      ["wordiness", "A large number of users asked for dark mode.", "A large number of"],
      ["wordiness", "Please read the guide prior to the meeting.", "prior to"],
      ["wordiness", "I have a question with regard to the invoice.", "with regard to"],
      ["wordiness", "We back up the files on a daily basis.", "on a daily basis"],
      ["wordiness", "The majority of the staff voted yes.", "The majority of"],
      ["wordiness", "The app has the ability to sync offline.", "has the ability to"],
      ["wordiness", "In terms of cost, the plan is fine.", "In terms of"],
      ["wordiness", "At the end of the day, the client decides.", "At the end of the day"],
      ["redundancy", "The end result surprised everyone.", "end result"],
      ["redundancy", "Her past history explains the choice.", "past history"],
      ["redundancy", "Every buyer gets a free gift.", "free gift"],
      ["redundancy", "Please revert back to the old version.", "revert back"],
      ["redundancy", "The two teams will join together next year.", "join together"],
      ["redundancy", "It was an unexpected surprise.", "unexpected surprise"],
      ["redundancy", "The added bonus is the view.", "added bonus"],
      ["redundancy", "We discussed our future plans.", "future plans"],
      ["redundancy", "Here is a brief summary of the call.", "brief summary"],
      ["redundancy", "They gave us advance warning of the strike.", "advance warning"],
      ["redundancy", "That is my final conclusion.", "final conclusion"],
      ["redundancy", "The general consensus is to wait.", "general consensus"],
      ["nominalization", "We made a decision to close the office.", "made a decision"],
      ["nominalization", "The team will conduct an analysis of the data.", "conduct an analysis of"],
      ["nominalization", "They reached a conclusion after a week.", "reached a conclusion"],
      ["nominalization", "Please give consideration to the second offer.", "give consideration to"],
      ["nominalization", "The city provided assistance to the families.", "provided assistance to"],
      ["nominalization", "We had a discussion about the budget.", "had a discussion about"],
      ["nominalization", "She made an attempt to fix the bug.", "made an attempt"],
      ["nominalization", "They performed a review of the contract.", "performed a review of"],
      ["nominalization", "The board will make a recommendation soon.", "make a recommendation"],
      ["nominalization", "We came to an agreement on the price.", "came to an agreement"],
      ["hedge", "Basically, the plan works.", "Basically"],
      ["hedge", "The design is kind of confusing.", "kind of"],
      ["hedge", "It was sort of a mess.", "sort of"],
      ["hedge", "The new version is really fast.", "really"],
      ["hedge", "The meeting was very long.", "very"],
      ["hedge", "The answer is quite simple.", "quite"],
      ["hedge", "I just wanted to check the date.", "just"],
      ["hedge", "I think that we should wait.", "I think that"],
      ["hedge", "The fix actually made it worse.", "actually"],
      ["hedge", "The queue was literally endless.", "literally"],
      ["hedge", "The plan is pretty much done.", "pretty much"],
      ["hedge", "The numbers are more or less right.", "more or less"],
      ["repetition", "Send the the file to Noa.", "the the"],
      ["repetition", "We will meet on on Sunday.", "on on"],
      ["repetition", "It was a a long night.", "a a"],
      ["repetition", "Check the logs for for errors.", "for for"],
    ],
    clean: [
      "She is interested in history.", "The shop is located near the station.", "We were tired after the trip.", "Our plan is simple.",
      "Dana writes short reports.", "The museum opens at nine.", "He had had enough.", "Prices rose by 3% in May.", "They decided to move to Haifa.",
      "The cat sleeps on the sofa.", "Noa fixed the printer.", "The team shipped the update on Friday.", "Rain fell all night.", "We need two more chairs.",
      "The library closes at six.", "Yossi drives to Tel Aviv every Monday.", "The draft needs a title.", "Read the second chapter first.", "The soup is hot.",
      "Our office moved to the fourth floor.", "The bus leaves at 7:15.", "I like this font.", "The client signed the deal.", "Ten people came to the talk.",
      "Bring a coat.", "The data looks clean.", "She is married to a doctor.", "The road is closed for repairs.", "He answered every email.", "The test passed.",
      "Lior is based in Jerusalem.", "We were pleased with the result.", "The file is used by three teams.", "Write the summary in Hebrew.", "The garden needs water.",
    ],
    long: [
      "The committee, which had met every Tuesday for the last three years in the small room behind the library, finally agreed that the new budget, despite its many flaws and the objections of several members, should go to a vote before the end of the month.",
      "When we moved the servers from the old building to the new data center across the river, we discovered that half of the cables were mislabeled, that the backup power had never been tested, and that nobody remembered the password for the main switch.",
      "Although the first version of the app was slow and hard to use, the team kept listening to every complaint from the early users, rewrote the sync engine twice, and shipped a release that people now describe as fast, simple and reliable.",
      "If you plan to visit the old city in the summer, you should start early in the morning, carry plenty of water, wear comfortable shoes and a hat, and leave the busiest streets for the evening when the heat finally breaks and the shops reopen.",
      "The report that the research group published last week argues that the decline in reading among teenagers is not caused by phones alone but by a mix of school schedules, the cost of books, the loss of local libraries and the habits of their parents.",
      "During the long negotiation, which lasted through two holidays and several sleepless nights, both sides slowly gave up their hardest demands, and by the time the final draft was signed nobody could remember what the original dispute had been about.",
    ],
  },
  he: {
    issues: [
      ["passive", "הדוח נכתב על ידי דנה.", "נכתב על ידי"],
      ["passive", "ההחלטה התקבלה על ידי הוועדה.", "התקבלה על ידי"],
      ["passive", "הבדיקה בוצעה על ידי הצוות.", "בוצעה על ידי"],
      ["passive", "החוזה נחתם על ידי שני הצדדים.", "נחתם על ידי"],
      ["passive", "התוכנית אושרה על ידי ההנהלה.", "אושרה על ידי"],
      ["passive", "המכתב נשלח על ידי המזכירה.", "נשלח על ידי"],
      ["passive", "הבית נבנה על ידי סבא שלי.", "נבנה על ידי"],
      ["passive", "התוצאות נאספו על ידי הסטודנטים.", "נאספו על ידי"],
      ["passive", "הספר תורגם על ידי משה.", "תורגם על ידי"],
      ["passive", "השיר הושר על ידי המקהלה.", "הושר על ידי"],
      ["passive", "הכלי פותח על ידי חברה קטנה.", "פותח על ידי"],
      ["passive", "המחקר נערך על ידי שני חוקרים.", "נערך על ידי"],
      ["nominalization", "ביצוע של הבדיקה נמשך שבוע.", "ביצוע של"],
      ["nominalization", "הם קיבלו החלטה לסגור את הסניף.", "קיבלו החלטה"],
      ["nominalization", "צריך לבצע בדיקה לכל הקבצים.", "לבצע בדיקה"],
      ["nominalization", "הם עשו שימוש בכלי חדש.", "עשו שימוש ב"],
      ["nominalization", "השכנים נתנו עזרה למשפחה.", "נתנו עזרה ל"],
      ["nominalization", "הצוותים קיימו פגישה בבוקר.", "קיימו פגישה"],
      ["nominalization", "עריכה של המסמך לקחה יומיים.", "עריכה של"],
      ["nominalization", "הכנה של התוכנית התחילה בינואר.", "הכנה של"],
      ["nominalization", "המשטרה ביצעה חקירה מקיפה.", "ביצעה חקירה"],
      ["nominalization", "המורה נתן הסבר מפורט.", "נתן הסבר"],
      ["nominalization", "אנחנו מקבלים החלטה כל שבוע.", "מקבלים החלטה"],
      ["nominalization", "הוא עשה שימוש במילון.", "עשה שימוש ב"],
      ["wordiness", "צריך לענות באופן מיידי.", "באופן מיידי"],
      ["wordiness", "נפגשנו על מנת לתכנן את ההשקה.", "על מנת ל"],
      ["wordiness", "סידרנו את החדר באופן שכולם יראו.", "באופן ש"],
      ["wordiness", "במידה ויירד גשם, נישאר בבית.", "במידה ו"],
      ["wordiness", "איחרנו בשל העובדה שהכביש נחסם.", "בשל העובדה ש"],
      ["wordiness", "מספר רב של משתמשים ביקשו מצב לילה.", "מספר רב של"],
      ["wordiness", "המחירים ירדו באופן משמעותי.", "באופן משמעותי"],
      ["wordiness", "נחזור אליכם בזמן הקרוב.", "בזמן הקרוב"],
      ["wordiness", "חשוב לציין כי הפגישה נדחתה.", "חשוב לציין כי"],
      ["wordiness", "בסופו של יום הלקוח מחליט.", "בסופו של יום"],
      ["wordiness", "הקובץ נשמר באופן אוטומטי.", "באופן אוטומטי"],
      ["wordiness", "לאור העובדה שהשרת נפל, דחינו את ההשקה.", "לאור העובדה ש"],
      ["redundancy", "הם חזרו שוב למשרד.", "חזרו שוב"],
      ["redundancy", "המחיר עלה למעלה בחדות.", "עלה למעלה"],
      ["redundancy", "הטמפרטורה ירדה למטה בלילה.", "ירדה למטה"],
      ["redundancy", "כל אחד ואחד קיבל מתנה.", "כל אחד ואחד"],
      ["redundancy", "הוא המשיך הלאה בלי לעצור.", "המשיך הלאה"],
      ["redundancy", "תכנון מראש חוסך זמן.", "תכנון מראש"],
      ["redundancy", "זו הייתה הפתעה בלתי צפויה.", "הפתעה בלתי צפויה"],
      ["redundancy", "התחלנו מההתחלה אחרי התקלה.", "התחלנו מההתחלה"],
      ["redundancy", "היא חוזרת שוב על אותה טעות.", "חוזרת שוב"],
      ["redundancy", "הסרט היה מאוד מאוד ארוך.", "מאוד מאוד"],
      ["hedge", "כאילו, זה לא עובד.", "כאילו"],
      ["hedge", "זה סוג של בעיה.", "סוג של"],
      ["hedge", "בעצם, התוכנית מוכנה.", "בעצם"],
      ["hedge", "הגרסה החדשה ממש מהירה.", "ממש"],
      ["hedge", "פשוט תשלחו את הקובץ.", "פשוט"],
      ["hedge", "נראה לי שכדאי לחכות.", "נראה לי ש"],
      ["hedge", "אני חושב שהמחיר גבוה.", "אני חושב ש"],
      ["hedge", "איכשהו הכול הסתדר.", "איכשהו"],
      ["hedge", "אני מרגישה שהטקסט ארוך.", "אני מרגישה ש"],
      ["repetition", "שלחו את את הקובץ לנועה.", "את את"],
      ["repetition", "נדבר על על זה מחר.", "על על"],
      ["repetition", "זה הספר של של אבא.", "של של"],
      ["repetition", "הם הלכו הלכו הביתה.", "הלכו הלכו"],
    ],
    clean: [
      "לאט לאט הבנו את המצב.", "דנה כתבה את הדוח.", "הצוות בדק את התוצאות.", "ישבנו יחד בערב.", "הוא חזר הביתה מאוחר.", "יום יום אני הולך לעבודה.",
      "המחיר עלה ב־3% במאי.", "הם החליטו לעבור לחיפה.", "החתול ישן על הספה.", "נועה תיקנה את המדפסת.", "הספרייה נסגרת בשש.", "צריך עוד שני כיסאות.",
      "יוסי נוסע לתל אביב בכל יום שני.", "הטיוטה צריכה כותרת.", "קראו קודם את הפרק השני.", "המרק חם.", "המשרד עבר לקומה הרביעית.", "האוטובוס יוצא ב־7:15.",
      "אני אוהבת את הגופן הזה.", "הלקוח חתם על העסקה.", "עשרה אנשים הגיעו להרצאה.", "קחו מעיל.", "הנתונים נראים נקיים.", "הכביש סגור לתיקונים.",
      "הוא ענה על כל המיילים.", "הבדיקה עברה.", "צעד צעד התקדמנו.", "ליאור גר בירושלים.", "שמחנו מהתוצאה.", "כתבו את הסיכום בעברית.", "הגינה צריכה מים.",
      "הם נפגשו אתמול בקפה.", "המנהלת אישרה את התקציב.", "הילדים שיחקו בחצר.", "כתבתי שלושה עמודים היום.",
    ],
    long: [
      "הוועדה, שהתכנסה בכל יום שלישי בשלוש השנים האחרונות בחדר הקטן שמאחורי הספרייה, הסכימה סוף סוף שהתקציב החדש, למרות פגמיו הרבים וההתנגדות של כמה מחבריה, יעלה להצבעה לפני סוף החודש הזה.",
      "כשהעברנו את השרתים מהבניין הישן למרכז הנתונים החדש שמעבר לנהר, גילינו שחצי מהכבלים מסומנים לא נכון, שאיש לא בדק את גיבוי החשמל מעולם ושאף אחד לא זוכר את הסיסמה של המתג הראשי.",
      "אף שהגרסה הראשונה של האפליקציה הייתה איטית וקשה לשימוש, הצוות המשיך להקשיב לכל תלונה של המשתמשים הראשונים, כתב מחדש את מנוע הסנכרון פעמיים והוציא גרסה שאנשים מתארים היום כמהירה, פשוטה ואמינה מאוד.",
      "אם אתם מתכננים לבקר בעיר העתיקה בקיץ, כדאי לצאת מוקדם בבוקר, לקחת הרבה מים, לנעול נעליים נוחות ולחבוש כובע, ולהשאיר את הרחובות העמוסים לערב, כשהחום נשבר והחנויות נפתחות שוב.",
      "הדוח שקבוצת המחקר פרסמה בשבוע שעבר טוען שהירידה בקריאה בקרב בני נוער לא נגרמת רק בגלל הטלפונים אלא בגלל שילוב של מערכת השעות בבית הספר, מחיר הספרים, סגירת הספריות המקומיות והרגלי ההורים.",
      "במהלך המשא ומתן הארוך, שנמשך לאורך שני חגים וכמה לילות בלי שינה, שני הצדדים ויתרו לאט על הדרישות הקשות שלהם, וכשהטיוטה הסופית נחתמה אף אחד כבר לא זכר על מה בדיוק היה הוויכוח בהתחלה.",
    ],
  },
};

function coachItems(lang) {
  const out = [];
  for (let i = 0; i < PER_LANG; i++) {
    const split = i < Math.round(PER_LANG * HELDOUT_SHARE) ? "heldout" : "dev";
    const r = rng(1000 + i * 7 + (lang === "he" ? 1 : 0));
    const bank = COACH[lang];
    const issues = half(bank.issues, split);
    const clean = half(bank.clean, split);
    const parts = [];
    const expect = [];
    // A fifth of the items are clean (false alarms show there); the others carry one or two issues.
    const nIssues = i % 5 === 0 ? 0 : 1 + (r() < 0.35 ? 1 : 0);
    const used = new Set();
    for (let k = 0; k < nIssues; k++) {
      const [kind, sentence, span] = pick(r, issues);
      if (used.has(sentence)) continue;
      used.add(sentence);
      parts.push(sentence);
      expect.push({ kind, text: span });
    }
    if (i % 9 === 4) {
      const s = pick(r, half(bank.long, split));
      parts.push(s);
      expect.push({ kind: "clarity", text: s });
    }
    for (let k = 0, n = 1 + Math.floor(r() * 2); k < n; k++) parts.splice(Math.floor(r() * (parts.length + 1)), 0, pick(r, clean));
    out.push({ id: `coach-${lang}-${String(i).padStart(3, "0")}`, lang, split, origin: "synthetic", level: "professional", text: parts.join(" "), expect });
  }
  return out;
}

/* ── toneShifter: the fact guard on rewrites ─────────────────────────── */

const NAMES = { en: ["Dana", "Yossi", "Noa", "Lior", "Maya", "Avi", "Tamar", "Eitan", "Shira", "Omer"], he: ["דנה", "יוסי", "נועה", "ליאור", "מאיה", "אבי", "תמר", "איתן", "שירה", "עומר"] };
const PLACES = { en: ["Haifa", "Tel Aviv", "Jerusalem", "Eilat", "Nazareth", "Beersheba"], he: ["חיפה", "תל אביב", "ירושלים", "אילת", "נצרת", "באר שבע"] };
/** [source, formal, friendly] with {N} a name, {P} a place, {X} a number, {Y} another number. Negated templates say so. */
const TONE_T = {
  en: [
    ["{N} will send the {X} reports on Monday.", "{N} will submit the {X} reports on Monday.", "{N}'s sending the {X} reports on Monday!"],
    ["The meeting in {P} starts at {X}:00.", "The meeting in {P} will commence at {X}:00.", "We're kicking off in {P} at {X}:00."],
    ["We did not approve the {X} invoices from {N}.", "We have not approved the {X} invoices from {N}.", "We didn't okay the {X} invoices from {N}."],
    ["{N} paid {X} shekels for the {Y} tickets.", "{N} paid {X} shekels for the {Y} tickets.", "{N} paid {X} shekels for {Y} tickets, nice!"],
    ["Please call {N} before you leave {P}.", "Kindly contact {N} before departing {P}.", "Give {N} a call before you head out of {P}."],
    ["The {X} new laptops never arrived in {P}.", "The {X} new laptops never reached {P}.", "Those {X} new laptops never showed up in {P}."],
    ["{N} has worked here for {X} years.", "{N} has been employed here for {X} years.", "{N}'s been with us for {X} years."],
    ["We cannot open the office in {P} before {X} May.", "We are unable to open the office in {P} before {X} May.", "We can't open the {P} office before {X} May."],
    ["Thanks, {N}, the {X} files are fixed.", "Thank you, {N}; the {X} files have been corrected.", "Thanks so much, {N}! All {X} files are fixed."],
    ["The train to {P} leaves every {X} minutes.", "Trains to {P} depart every {X} minutes.", "There's a train to {P} every {X} minutes."],
  ],
  he: [
    ["{N} תשלח את {X} הדוחות ביום שני.", "{N} תגיש את {X} הדוחות ביום שני.", "{N} שולחת את {X} הדוחות ביום שני!"],
    ["הפגישה ב{P} מתחילה ב־{X}:00.", "הפגישה ב{P} תיפתח בשעה {X}:00.", "נתחיל ב{P} ב־{X}:00."],
    ["לא אישרנו את {X} החשבוניות של {N}.", "החשבוניות של {N}, {X} במספר, אינן מאושרות.", "עוד לא אישרנו את {X} החשבוניות של {N}."],
    ["{N} שילם {X} שקלים על {Y} כרטיסים.", "{N} שילם סך של {X} שקלים עבור {Y} כרטיסים.", "{N} שילם {X} שקלים על {Y} כרטיסים, יופי!"],
    ["תתקשרו ל{N} לפני שאתם יוצאים מ{P}.", "נא ליצור קשר עם {N} בטרם תצאו מ{P}.", "תרימו טלפון ל{N} לפני שאתם יוצאים מ{P}."],
    ["{X} המחשבים החדשים לא הגיעו ל{P}.", "{X} המחשבים החדשים מעולם לא הגיעו ל{P}.", "{X} המחשבים החדשים פשוט לא הגיעו ל{P}."],
    ["{N} עובד כאן {X} שנים.", "{N} מועסק כאן זה {X} שנים.", "{N} איתנו כבר {X} שנים."],
    ["אי אפשר לפתוח את המשרד ב{P} לפני ה־{X} במאי.", "לא ניתן לפתוח את המשרד ב{P} לפני ה־{X} במאי.", "אי אפשר לפתוח את המשרד ב{P} לפני ה־{X} במאי, סליחה."],
    ["תודה, {N}, {X} הקבצים תוקנו.", "תודה רבה, {N}; {X} הקבצים תוקנו.", "תודה ענקית, {N}! כל {X} הקבצים מתוקנים."],
    ["הרכבת ל{P} יוצאת כל {X} דקות.", "הרכבות ל{P} יוצאות מדי {X} דקות.", "יש רכבת ל{P} כל {X} דקות."],
  ],
};

const fill = (t, v) => t.replace(/\{N\}/g, v.N).replace(/\{P\}/g, v.P).replace(/\{X\}/g, v.X).replace(/\{Y\}/g, v.Y);
const NEG = { en: [[/\bdid not\b/, "did"], [/\bhave not\b/, "have"], [/\bnever\b/, "always"], [/\bcannot\b/, "can"], [/\bdidn't\b/, "did"], [/\bcan't\b/, "can"]], he: [[/(^|\s)לא /, "$1"], [/אינן /, ""], [/אינם /, ""], [/ מעולם/, ""], [/אי אפשר/, "אפשר"], [/לא ניתן/, "ניתן"]] };

function toneItems(lang) {
  const out = [];
  const tpls = TONE_T[lang];
  for (let i = 0; i < PER_LANG; i++) {
    const split = i < Math.round(PER_LANG * HELDOUT_SHARE) ? "heldout" : "dev";
    const r = rng(5000 + i * 13 + (lang === "he" ? 1 : 0));
    const tp = half(tpls, split);
    const names = half(NAMES[lang], split);
    const places = half(PLACES[lang], split);
    const [src, formal, friendly] = pick(r, tp);
    const v = { N: pick(r, names), P: pick(r, places), X: String(2 + Math.floor(r() * 40)), Y: String(2 + Math.floor(r() * 9)) };
    const source = fill(src, v);
    const good = fill(r() < 0.5 ? formal : friendly, v);
    // Half the items keep the facts; the others change one: a number, a name, a place or a negation.
    const kind = i % 2 === 0 ? null : pick(r, ["number", "name", "place", "negation", "added-name"]);
    let rewrite = good;
    let change = kind;
    if (kind === "number") rewrite = good.replace(v.X, String(Number(v.X) + 1 + Math.floor(r() * 5)));
    if (kind === "name") rewrite = good.replace(v.N, pick(r, NAMES[lang].filter((n) => n !== v.N)));
    if (kind === "place") rewrite = good.includes(v.P) ? good.replace(v.P, pick(r, PLACES[lang].filter((p) => p !== v.P))) : good.replace(v.X, String(Number(v.X) * 2));
    if (kind === "added-name") rewrite = lang === "he" ? `${good} ${pick(r, ["גם", "לפי"])} ${pick(r, NAMES[lang].filter((n) => !good.includes(n)))} מסכים.` : `${good} ${pick(r, NAMES[lang].filter((n) => !good.includes(n)))} agrees.`;
    if (kind === "negation") {
      const rule = NEG[lang].find(([re]) => re.test(good));
      if (rule) rewrite = good.replace(rule[0], rule[1]);
      else rewrite = lang === "he" ? good.replace(/^(\S+)\s/, "$1 לא ") : good.replace(/\b(will|is|has|leaves|starts|paid|are)\b/, "$1 not");
      if (rewrite === good) change = null;
    }
    if (rewrite === good) change = null;
    out.push({ id: `tone-${lang}-${String(i).padStart(3, "0")}`, lang, split, origin: "synthetic", source, rewrite, change, label: change ? "changed" : "kept" });
  }
  return out;
}

/* ── concision: the length and no-invention checks ───────────────────── */

const CONC_T = {
  en: [
    "In order to finish the {X} reports for {N} before the trip to {P}, the whole team basically stayed late every single night for a week, and in the end we did manage to send all of them on time.",
    "The new office in {P} has {X} desks, a small kitchen and a meeting room, and {N}, who planned the move, says that it is really quite a lot better than the old place we used to have before.",
    "Due to the fact that the server in {P} went down for {X} hours on Tuesday, {N} decided to postpone the launch until next week, which is a decision that most of the team actually agreed with.",
    "{N} called to say that the {X} chairs we ordered for the hall in {P} will not arrive before Sunday, so we should plan to borrow some from the school across the street for the event.",
  ],
  he: [
    "על מנת לסיים את {X} הדוחות של {N} לפני הנסיעה ל{P}, כל הצוות בעצם נשאר מאוחר בכל ערב במשך שבוע שלם, ובסופו של דבר הצלחנו לשלוח את כולם בזמן.",
    "במשרד החדש ב{P} יש {X} שולחנות, מטבחון וחדר ישיבות, ו{N}, שתכננה את המעבר, אומרת שהוא ממש הרבה יותר טוב מהמקום הישן שהיה לנו קודם.",
    "בשל העובדה שהשרת ב{P} נפל למשך {X} שעות ביום שלישי, {N} החליט לדחות את ההשקה לשבוע הבא, וזו החלטה שרוב הצוות בעצם הסכים איתה.",
    "{N} התקשרה להגיד ש־{X} הכיסאות שהזמנו לאולם ב{P} לא יגיעו לפני יום ראשון, ולכן כדאי לתכנן לשאול כיסאות מבית הספר שמעבר לרחוב לקראת האירוע.",
  ],
};
/** A shortening that keeps the facts, ~70 % of the words: drop the filler, keep the clause skeleton. */
const SHORT = {
  en: [
    "To finish {N}'s {X} reports before the {P} trip, the team stayed late every night for a week and sent them all on time.",
    "The new {P} office has {X} desks, a kitchen and a meeting room; {N}, who planned the move, says it beats the old one.",
    "Because the {P} server was down for {X} hours on Tuesday, {N} postponed the launch to next week, and most of the team agreed.",
    "{N} called: the {X} chairs for the {P} hall will not arrive before Sunday, so we will borrow some from the school across the street.",
  ],
  he: [
    "כדי לסיים את {X} הדוחות של {N} לפני הנסיעה ל{P}, הצוות נשאר מאוחר כל ערב במשך שבוע ושלח את כולם בזמן.",
    "במשרד החדש ב{P} יש {X} שולחנות, מטבחון וחדר ישיבות, ו{N}, שתכננה את המעבר, אומרת שהוא טוב בהרבה מהישן.",
    "כי השרת ב{P} נפל למשך {X} שעות ביום שלישי, {N} דחה את ההשקה לשבוע הבא, ורוב הצוות הסכים.",
    "{N} התקשרה: {X} הכיסאות לאולם ב{P} לא יגיעו לפני יום ראשון, ולכן נשאל כיסאות מבית הספר שמעבר לרחוב.",
  ],
};

function concisionItems(lang) {
  const out = [];
  for (let i = 0; i < PER_LANG; i++) {
    const split = i < Math.round(PER_LANG * HELDOUT_SHARE) ? "heldout" : "dev";
    const r = rng(9000 + i * 17 + (lang === "he" ? 1 : 0));
    const k = Math.floor(r() * CONC_T[lang].length);
    const v = { N: pick(r, half(NAMES[lang], split)), P: pick(r, half(PLACES[lang], split)), X: String(3 + Math.floor(r() * 30)), Y: "2" };
    const source = fill(CONC_T[lang][k], v);
    const good = fill(SHORT[lang][k], v);
    const defect = i % 2 === 0 ? null : pick(r, ["invented-number", "invented-name", "lost-number", "lost-name", "too-long", "negation"]);
    let result = good;
    if (defect === "invented-number") result = lang === "he" ? `${good} זה עלה ${100 + Math.floor(r() * 900)} שקלים.` : `${good} It cost ${100 + Math.floor(r() * 900)} shekels.`;
    if (defect === "invented-name") result = lang === "he" ? `${good} ${pick(r, NAMES[lang].filter((n) => n !== v.N))} עזר.` : `${good} ${pick(r, NAMES[lang].filter((n) => n !== v.N))} helped.`;
    if (defect === "lost-number") result = good.replace(new RegExp(`${v.X}\\s?`), "");
    if (defect === "lost-name") result = good.replace(v.N, lang === "he" ? "היא" : "she").replace(new RegExp(`${v.N}'s\\s?`), "");
    if (defect === "too-long") result = source.replace(lang === "he" ? /בעצם |ממש /g : /basically |really |actually /g, "");
    if (defect === "negation") result = lang === "he" ? good.replace(/ לא /, " ") : good.replace(/ not /, " ");
    let d = defect;
    if (result === good && d !== null) {
      result = lang === "he" ? `${good} זה קרה ב־2025.` : `${good} That was in 2025.`;
      d = "invented-number";
    }
    // The length truth, counted independently of the agent's counter (W5.8): words between spaces.
    const ws = (t) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    const target = Math.max(1, Math.round(ws(source) * 0.7));
    const lengthOk = Math.abs(ws(result) - target) <= Math.max(1, Math.round(target * 0.1));
    const factsOk = !d || d === "too-long";
    out.push({ id: `conc-${lang}-${String(i).padStart(3, "0")}`, lang, split, origin: "synthetic", mode: "shorten", percent: 30, source, result, defect: d, factsOk, lengthOk, label: factsOk && lengthOk ? "ok" : "bad" });
  }
  return out;
}

export const AGENTS = {
  styleCoach: { build: coachItems, about: "Clarity and style findings: each item is 1–4 sentences with the spans a coach should flag (kind + text); a fifth are clean." },
  toneShifter: { build: toneItems, about: "The tone shifter's fact guard: a source, a tone rewrite, and whether the rewrite changed a number, name, place or negation." },
  concision: { build: concisionItems, about: "Shortening checks: a source, a shortened result, and its defect (invented / lost number or name, flipped negation, outside the length range) or none." },
};

const digest = (s) => createHash("sha256").update(s).digest("hex");

export function render(agent) {
  const files = {};
  for (const lang of ["he", "en"]) files[`${lang}.jsonl`] = AGENTS[agent].build(lang).map((x) => JSON.stringify(x)).join("\n") + "\n";
  const manifest = {
    schema: 1,
    plan: "W13.W2",
    agent,
    version: VERSION,
    origin: "synthetic",
    license: "CC0-1.0",
    about: AGENTS[agent].about,
    generator: "scripts/eval/writing-sets.mjs",
    heldoutShare: HELDOUT_SHARE,
    heldoutNote: "The held-out split here is synthetic and written by the authors of the agents: it can never back a ✅. The sealed set (W6.17, the evaluator key) and real texts (W10.B13) are owed.",
    files: Object.fromEntries(Object.entries(files).map(([f, s]) => [f, { items: s.trim().split("\n").length, sha256: digest(s) }])),
  };
  files["manifest.json"] = JSON.stringify(manifest, null, 2) + "\n";
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let bad = 0;
  for (const agent of Object.keys(AGENTS)) {
    for (const [f, s] of Object.entries(render(agent))) {
      const p = join(OUT, agent, f);
      if (check) {
        if (!existsSync(p) || readFileSync(p, "utf8") !== s) {
          console.error(`✗ ${p} is not what the generator writes`);
          bad++;
        }
      } else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, s);
      }
    }
  }
  if (!check) console.log(`wrote eval/writing for ${Object.keys(AGENTS).join(", ")}`);
  process.exit(bad ? 1 : 0);
}
