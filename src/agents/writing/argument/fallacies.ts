/**
 * W13.W8 — the labelled list of common fallacies, with Hebrew and English
 * patterns and a Hebrew and English example and fix for each. A pattern is
 * a cue, not a verdict: each rule names what it saw, so the user can judge
 * (Grammarly's Expert Review does this in the cloud; here it is local rules).
 *
 * Precision comes first: a cue fires only in an assertive sentence (not a
 * question, not a quote, not a hedge such as "לדעתי" / "I think"), and
 * benign idioms that share the words ("כל הכבוד", "all right", "either way",
 * "תמיד שמחתי") are excluded.
 */

export type FallacyKind = "hasty-generalization" | "straw-man" | "slippery-slope" | "ad-hominem" | "false-dilemma" | "appeal-to-popularity" | "post-hoc";

export interface FallacyInfo {
  kind: FallacyKind;
  he: { name: string; why: string; example: string; fix: string };
  en: { name: string; why: string; example: string; fix: string };
  patterns: RegExp[];
  confidence: number;
}

const W = "[\\p{L}\\p{M}'\"׳״-]";
const B = `(?<!${W})`; // start of a word, for Hebrew too (\b is ASCII only)
const E = `(?!${W})`;
const r = (s: string) => new RegExp(s.replace(/\\b</g, B).replace(/\\b>/g, E), "iu");

export const FALLACIES: readonly FallacyInfo[] = [
  {
    kind: "straw-man",
    he: {
      name: "איש קש",
      why: "המשפט מציג את עמדת הצד השני בגרסה קיצונית או מעוותת, ואז תוקף את הגרסה הזאת במקום את מה שנאמר.",
      example: "״המתנגדים לתוכנית בעצם רוצים שהילדים יישארו בלי חינוך בכלל.״",
      fix: "לצטט את הטענה של הצד השני במדויק, עם מקור, ולהשיב עליה.",
    },
    en: {
      name: "Straw man",
      why: "The sentence restates the other side in an extreme or distorted form and attacks that instead of what was said.",
      example: "\"Opponents of the plan basically want children to get no education at all.\"",
      fix: "Quote the other side's claim exactly, with a source, and answer that.",
    },
    patterns: [
      r("\\b<(?:אז )?(?:אתה|את|אתם|הם|הוא|היא) (?:בעצם |פשוט )?(?:אומר|אומרת|אומרים|טוען|טוענת|טוענים) ש"),
      r("\\b<(?:המתנגדים|מתנגדי|המבקרים|השמאל|הימין|הצד השני)\\b>.{0,40}\\b<(?:בעצם|פשוט|בסך הכל)\\b> (?:רוצים|רוצה|מבקשים)"),
      r("\\b<so (?:you're|you are|they're|they are|he's|she's) (?:basically |really )?saying\\b>"),
      r("\\b<(?:opponents|critics|the other side|liberals|conservatives)\\b>.{0,40}\\b<(?:basically|simply|just|really) wants?\\b>"),
    ],
    confidence: 0.75,
  },
  {
    kind: "slippery-slope",
    he: {
      name: "מדרון חלקלק",
      why: "המשפט טוען שצעד אחד יוביל בהכרח לשרשרת של תוצאות קיצוניות, בלי להראות למה כל צעד בשרשרת יקרה.",
      example: "״אם נרשה טלפונים בהפסקה, בקרוב ירשו אותם בשיעור, ובסוף אף אחד לא ילמד.״",
      fix: "להראות ראיה לכל חוליה בשרשרת, או לטעון רק על הצעד הראשון.",
    },
    en: {
      name: "Slippery slope",
      why: "The sentence claims one step will inevitably set off a chain of extreme results, without showing why each link would happen.",
      example: "\"If we allow phones at break, soon they'll be allowed in class, and before long nobody will learn.\"",
      fix: "Give evidence for each link in the chain, or argue only about the first step.",
    },
    patterns: [
      r("\\b<אם (?:נ|י|ת)[\\p{L}]+.{3,80}\\b<(?:בקרוב|אחר כך|ואחר כך|ובסוף|ולבסוף|ומשם|עד ש)\\b>.{3,80}\\b<(?:ובסוף|ולבסוף|בסוף|ומשם|וזה הסוף)\\b>"),
      r("\\b<(?:זה רק עניין של זמן עד ש|זה יוביל ל.{2,40}(?:שיוביל|ומשם|ובסוף)|מדרון חלקלק)"),
      r("\\b<if we [a-z]+.{3,80}\\b<(?:soon|next|then|before long)\\b>.{3,80}\\b<(?:eventually|before long|in the end|and then|until)\\b>"),
      r("\\b<(?:it's only a matter of time before|the next thing you know|will inevitably lead to|slippery slope)\\b>"),
    ],
    confidence: 0.8,
  },
  {
    kind: "ad-hominem",
    he: {
      name: "התקפה אישית (אד הומינם)",
      why: "המשפט פוסל טענה בגלל מי שאמר אותה (אופי, גיל, השתייכות), לא בגלל מה שנאמר.",
      example: "״אין טעם להקשיב לה על כלכלה, היא בכלל סטודנטית.״",
      fix: "להשיב לטענה עצמה: מה בה לא נכון ולמה.",
    },
    en: {
      name: "Ad hominem",
      why: "The sentence dismisses a claim because of who made it (character, age, affiliation), not because of what was said.",
      example: "\"There's no point listening to her on economics, she's just a student.\"",
      fix: "Answer the claim itself: what in it is wrong, and why.",
    },
    patterns: [
      r("\\b<(?:אין טעם להקשיב ל|אי אפשר לסמוך על|אסור להאמין ל|מה (?:הוא|היא|הם) כבר (?:מבין|מבינה|מבינים|יודע|יודעת|יודעים))"),
      r("\\b<(?:הוא|היא|הם) (?:בכלל|סתם|רק) (?:שקרן|שקרנית|שקרנים|טיפש|טיפשה|מושחת|מושחתת|ילד|ילדה|סטודנט|סטודנטית|פוליטיקאי|חובבן|חובבנית)"),
      r("\\b<(?:there's no point listening to|you can't trust|don't listen to|what (?:does (?:he|she|it)|do (?:they|you)) (?:even )?know about)\\b>"),
      r("\\b<(?:he|she|they)(?:'s|'re| is| are) (?:just|only|merely) (?:a|an)? ?(?:liar|idiot|student|kid|politician|amateur|crook)\\b>"),
    ],
    confidence: 0.8,
  },
  {
    kind: "false-dilemma",
    he: {
      name: "דילמה כוזבת",
      why: "המשפט מציג רק שתי אפשרויות כאילו אין אחרות.",
      example: "״או שתומכים בתוכנית במלואה, או שמפקירים את העיר.״",
      fix: "להראות למה אין דרך שלישית, או להציג גם אותה.",
    },
    en: {
      name: "False dilemma",
      why: "The sentence offers only two options as if there were no others.",
      example: "\"Either we back the plan in full, or we abandon the city.\"",
      fix: "Show why there is no third way, or present it too.",
    },
    patterns: [
      r("\\b<או ש.{3,60}\\b<או ש"),
      r("\\b<(?:יש רק שתי אפשרויות|אין דרך שלישית|מי שלא (?:איתנו|בעדנו) (?:הוא )?נגדנו)"),
      r("^\\s*either\\b>(?! way| one| of)\\s.{3,80}\\b<or\\b>\\s"),
      r("\\b<(?:there are only two (?:options|choices|ways)|you're either with us or against us|there is no third way)\\b>"),
    ],
    confidence: 0.7,
  },
  {
    kind: "appeal-to-popularity",
    he: {
      name: "פנייה לרוב",
      why: "המשפט מציג משהו כנכון כי רבים מאמינים בו, לא כי יש לו ראיה.",
      example: "״כולם יודעים שקפה בערב מזיק.״",
      fix: "להביא את הראיה עצמה, או לכתוב ״רבים מאמינים ש…״ בלי להציג זאת כעובדה.",
    },
    en: {
      name: "Appeal to popularity",
      why: "The sentence presents something as true because many believe it, not because of evidence.",
      example: "\"Everyone knows coffee in the evening is bad for you.\"",
      fix: "Give the evidence itself, or write \"many believe…\" without presenting it as fact.",
    },
    patterns: [
      r("\\b<(?:כולם יודעים|כל אחד יודע|ברור לכולם|רוב האנשים (?:מסכימים|חושבים|יודעים)|מיליוני אנשים לא יכולים לטעות)"),
      r("\\b<(?:everyone knows|everybody knows|it's common knowledge|most people (?:agree|think|know)|millions of people can't be wrong)\\b>"),
    ],
    confidence: 0.8,
  },
  {
    kind: "post-hoc",
    he: {
      name: "אחריו ולכן בגללו",
      why: "המשפט מסיק שדבר אחד גרם לשני רק כי הוא קרה קודם.",
      example: "״מאז שהתקינו את המצלמות ירדה הפשיעה, אז ברור שהמצלמות עובדות.״",
      fix: "להראות מנגנון או השוואה (מה קרה במקומות בלי מצלמות) לפני שטוענים לסיבה.",
    },
    en: {
      name: "Post hoc",
      why: "The sentence concludes that one thing caused another only because it came first.",
      example: "\"Since the cameras went up, crime has dropped, so clearly the cameras work.\"",
      fix: "Show a mechanism or a comparison (what happened where there were no cameras) before claiming a cause.",
    },
    patterns: [
      r("\\b<(?:מאז ש|אחרי ש|מיד אחרי ש).{3,80}\\b<(?:אז ברור ש|ולכן ברור ש|מה שמוכיח ש|זה מוכיח ש|אז כנראה ש|ולכן זה בגלל|כך שברור ש)"),
      r("\\b<(?:ever since|since|after|right after)\\b> .{3,80}\\b<(?:so clearly|which proves|that proves|so obviously|so it must be|it must be because)\\b>"),
    ],
    confidence: 0.75,
  },
  {
    kind: "hasty-generalization",
    he: {
      name: "הכללה נמהרת",
      why: "המשפט אומר משהו על כל הקבוצה (״כל ה…״, ״תמיד״, ״אף אחד״) על סמך מקרים מעטים או בלי ראיה.",
      example: "״פגשתי שני נהגי מונית גסים, אז כל נהגי המוניות גסים.״",
      fix: "לצמצם (״חלק מ…״, ״לעתים קרובות״) או להביא נתונים על הקבוצה כולה.",
    },
    en: {
      name: "Hasty generalization",
      why: "The sentence says something about a whole group (\"all\", \"always\", \"nobody\") on the strength of a few cases or none.",
      example: "\"I met two rude taxi drivers, so all taxi drivers are rude.\"",
      fix: "Narrow it (\"some\", \"often\") or bring data about the whole group.",
    },
    patterns: [
      r("\\b<כל ה[\\p{L}]{2,}(?:ים|ות)\\b> (?:הם|הן|הינם|תמיד|פשוט|בעצם)?\\s*[\\p{L}]"),
      r("\\b<(?:all|every) [a-z]+s? (?:are|is|always|never)\\b>"),
      r("\\b<[a-z]+s (?:are always|always are|never|are all)\\b>"),
      r("(?:\\b<(?:אז|לכן|ולכן|מכאן ש)\\b>.{0,40}\\b<(?:כל ה|כולם|תמיד|אף פעם|אף אחד)\\b>)"),
      r("\\b<(?:so|therefore|which means)\\b>.{0,40}\\b<(?:all|every|always|never|nobody|no one)\\b>"),
      r("\\b<(?:פגשתי|ראיתי|שמעתי על|הכרתי) (?:פעם |שני |שלושה |כמה )?.{0,40}\\b<(?:אז|לכן|ולכן)\\b>"),
      r("\\b<(?:I met|I saw|I know) (?:a|one|two|three|a few|some) .{0,60}\\b<(?:so|therefore)\\b>"),
    ],
    confidence: 0.75,
  },
];

/** Idioms that share a fallacy's words and are not arguments. */
export const BENIGN = r("\\b<(?:כל הכבוד|כל טוב|כל הזמן הזה|תמיד שמח|תמיד שמחתי|all right|all in all|either way|either one|after all|everyone is welcome|כולם מוזמנים)\\b>");
