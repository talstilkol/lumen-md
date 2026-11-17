/**
 * W13.W8 — 150 labelled arguments (75 Hebrew, 75 English): six of each of
 * the seven fallacies, ten unsupported claims, five logical leaps and
 * eighteen that are fine (a cited claim, a hedged opinion, a question, a
 * benign idiom with a trigger word, plain narrative).
 *
 * Label = the one finding the checker should make ("none" = no finding).
 * Written for lumen-md (MIT), synthetic: a dev set (eval card tag "dev").
 */

export interface ArgItem {
  id: string;
  lang: "he" | "en";
  text: string;
  label: string;
}

const HE: Record<string, string[]> = {
  "hasty-generalization": [
    "פגשתי שני נהגי מונית גסים, אז כל נהגי המוניות גסים.",
    "כל הפוליטיקאים הם שקרנים, אין מה לדבר.",
    "ראיתי פעם סטודנט מעתיק במבחן, ולכן אי אפשר לסמוך על אף סטודנט.",
    "כל המתבגרים פשוט מכורים לטלפון.",
    "שמעתי על שני מקרים כאלה בעיר, אז ברור שכולם שם עושים את זה.",
    "כל החתולים הם אנוכיים מטבעם.",
  ],
  "straw-man": [
    "המתנגדים לתוכנית בעצם רוצים שהילדים יישארו בלי חינוך בכלל.",
    "אז אתה בעצם אומר שלא אכפת לך מהסביבה.",
    "מתנגדי הרפורמה פשוט רוצים שהכול יישאר מושחת לנצח.",
    "הם טוענים שצריך לבטל את כל המבחנים, כלומר שלא ילמדו כלום.",
    "המבקרים של ההחלטה בסך הכל רוצים שהעירייה תפשוט רגל.",
    "היא אומרת שצריך לחסוך בחשמל, כלומר שנחיה בחושך.",
  ],
  "slippery-slope": [
    "אם נרשה טלפונים בהפסקה, בקרוב ירשו אותם בשיעור, ובסוף אף אחד לא ילמד.",
    "אם נוריד את המחיר עכשיו, אחר כך ידרשו עוד הנחה, ובסוף נסגור את העסק.",
    "זה רק עניין של זמן עד שכל הרחוב יהפוך לחניון.",
    "אם יאשרו בניין אחד גבוה, בקרוב יבנו עשרה, ובסוף לא יישאר פה שום שטח ירוק.",
    "אם נוותר להם על השעה הזאת, אחר כך הם ירצו את כל היום, ובסוף לא תהיה לנו עבודה.",
    "זה יוביל לפיטורים, שיוביל למשבר, ובסוף כל העיר תתרוקן.",
  ],
  "ad-hominem": [
    "אין טעם להקשיב לה על כלכלה, היא בכלל סטודנטית.",
    "אי אפשר לסמוך על המחקר שלו, הוא בכלל שקרן ידוע.",
    "מה הוא כבר מבין בחינוך, הוא לא גידל ילדים.",
    "אסור להאמין לנתונים שלה, היא סתם פוליטיקאית.",
    "מה הם כבר יודעים על חקלאות, הם גרים בתל אביב.",
    "הוא בכלל חובבן, אז אין מה להתייחס להצעה שלו.",
  ],
  "false-dilemma": [
    "או שתומכים בתוכנית במלואה, או שמפקירים את העיר.",
    "יש רק שתי אפשרויות: לסגור את הסניף או לפשוט רגל.",
    "או שאתה לומד רפואה או שאתה מבזבז את החיים.",
    "מי שלא איתנו הוא נגדנו.",
    "או שנבנה את הכביש עכשיו, או שהעיר תמות.",
    "אין דרך שלישית: מקבלים את ההצעה או מוותרים על הפרויקט.",
  ],
  "appeal-to-popularity": [
    "כולם יודעים שקפה בערב מזיק.",
    "רוב האנשים חושבים שהשיטה הזאת עובדת, אז היא עובדת.",
    "ברור לכולם שהתוכנית תצליח.",
    "מיליוני אנשים לא יכולים לטעות, אז הדיאטה הזאת נכונה.",
    "כל אחד יודע שאי אפשר לסמוך על תחזית מזג האוויר.",
    "רוב האנשים מסכימים שהמס הזה מיותר, ולכן צריך לבטל אותו.",
  ],
  "post-hoc": [
    "מאז שהתקינו את המצלמות ירדה הפשיעה, אז ברור שהמצלמות עובדות.",
    "אחרי שהחלפנו את הלוגו המכירות עלו, מה שמוכיח שהלוגו החדש הצליח.",
    "מיד אחרי שהתחלתי לשתות תה ירוק הכאב נעלם, זה מוכיח שהתה ריפא אותי.",
    "מאז שהמנהל החדש הגיע יש יותר גשם, אז כנראה שהוא מביא מזל.",
    "אחרי שהעירייה צבעה את הספסלים ירד מספר התאונות, ולכן זה בגלל הצבע.",
    "מאז שעברנו לשבוע עבודה מקוצר הרווחים עלו, אז ברור שזה בזכות הקיצור.",
  ],
  "unsupported-claim": [
    "שישים אחוז מהתלמידים בארץ לא קוראים ספרים בכלל.",
    "הרעש בכבישים גורם לירידה של עשרה אחוזים בשעות השינה.",
    "מחקרים מראים שעבודה מהבית מעלה את התפוקה.",
    "העיר שלנו היא הכי צפופה במדינה.",
    "מחיר הדירות עלה פי שלושה בעשור האחרון.",
    "צריכת סוכר גבוהה מובילה לירידה בריכוז אצל ילדים.",
    "יותר מחצי מהעסקים הקטנים נסגרים בשנה הראשונה.",
    "האוטובוסים בעיר מאחרים בממוצע ב-12 דקות.",
    "תוכנית ההזנה הורידה את הנשירה מבית הספר ב-20%.",
    "התחבורה הציבורית היא הגורם העיקרי לזיהום האוויר בעיר.",
  ],
  "logical-leap": [
    "הספרייה פתוחה עד שמונה בערב. התלמידים אוהבים ללמוד בקבוצות. לכן צריך לבטל את שיעורי הספורט.",
    "בחודש שעבר ירד הרבה גשם. החנות בפינה החליפה בעלים. מכאן שהמחירים בשוק יעלו.",
    "הצוות עבד קשה על הגרסה החדשה. הלקוחות ביקשו צבעים בהירים. לפיכך יש להעביר את המשרד לחיפה.",
    "הקיץ השנה היה ארוך. הילדים התחילו ללמוד נגינה. על כן העירייה צריכה לסלול כביש חדש.",
    "המסעדה מקבלת ביקורות טובות. השכנים קנו כלב. לכן כדאי למכור את הרכב.",
  ],
  none: [
    "לפי הלשכה המרכזית לסטטיסטיקה, 40% מהמשקים מחזיקים רכב אחד [@cbs2024].",
    "לדעתי כדאי לפתוח את הספרייה גם בשבת.",
    "האם יש דרך לקצר את זמן ההמתנה לאוטובוס?",
    "כל הכבוד לצוות שעבד על הפרויקט.",
    "תמיד שמחתי לעזור לשכנים כשהיה צריך.",
    "אתמול הלכנו לים, ובערב אכלנו ארוחה עם המשפחה.",
    "אולי כדאי לבדוק את זה שוב בשבוע הבא.",
    "במחקר של אוניברסיטת חיפה נמצא שהמתנה ארוכה מעלה את הלחץ (כהן, 2021).",
    "הישיבה נקבעה ליום שלישי בבוקר.",
    "הטבלה שלמטה מסכמת את התוצאות של שני הניסויים.",
    "נראה לי שהשיטה החדשה נוחה יותר.",
    "קראתי את הספר בשבוע שעבר ונהניתי ממנו.",
    "כל טוב, ונתראה בפגישה הבאה.",
    "המורה ביקשה להגיש את העבודה עד יום חמישי.",
    "על פי הדוח השנתי של משרד החינוך, מספר התלמידים עלה ב-3%.",
    "בגינה יש עץ לימון ושני עצי זית.",
    "כנראה שהרכבת תאחר גם היום.",
    "הסרט מתחיל בשמונה, ואחריו יש דיון עם הבמאית.",
  ],
};

const EN: Record<string, string[]> = {
  "hasty-generalization": [
    "I met two rude taxi drivers, so all taxi drivers are rude.",
    "All politicians are liars, end of story.",
    "I saw one student cheat in the exam, so no student can be trusted.",
    "Teenagers are always glued to their phones.",
    "Every teacher is underpaid and lazy.",
    "I know a few people who tried it and failed, so it never works.",
  ],
  "straw-man": [
    "Opponents of the plan basically want children to get no education at all.",
    "So you're saying you don't care about the environment.",
    "Critics of the reform simply want everything to stay corrupt forever.",
    "So they're basically saying we should abolish all exams.",
    "The other side just wants the city to go bankrupt.",
    "So she's really saying we should all live in the dark.",
  ],
  "slippery-slope": [
    "If we allow phones at break, soon they'll be allowed in class, and before long nobody will learn.",
    "If we lower the price now, next they'll want another discount, and eventually we'll close the shop.",
    "It's only a matter of time before the whole street becomes a car park.",
    "If we approve one tall building, soon there will be ten, and in the end there will be no green space left.",
    "This rule will inevitably lead to a ban on everything.",
    "Give them an hour today and the next thing you know they'll want the whole week off.",
  ],
  "ad-hominem": [
    "There's no point listening to her on economics, she's just a student.",
    "You can't trust his study, he's a known liar.",
    "What does he even know about education, he has no kids.",
    "Don't listen to her figures, she's only a politician.",
    "What do they know about farming, they live in the city.",
    "He's just an amateur, so his proposal isn't worth a reply.",
  ],
  "false-dilemma": [
    "Either we back the plan in full, or we abandon the city.",
    "There are only two options: close the branch or go bankrupt.",
    "Either you study medicine or you waste your life.",
    "You're either with us or against us.",
    "Either we build the road now or the town dies.",
    "There is no third way: we accept the offer or drop the project.",
  ],
  "appeal-to-popularity": [
    "Everyone knows coffee in the evening is bad for you.",
    "Most people think this method works, so it works.",
    "It's common knowledge that the plan will succeed.",
    "Millions of people can't be wrong, so this diet is right.",
    "Everybody knows weather forecasts can't be trusted.",
    "Most people agree this tax is pointless, so it should go.",
  ],
  "post-hoc": [
    "Since the cameras went up, crime has dropped, so clearly the cameras work.",
    "After we changed the logo sales went up, which proves the new logo worked.",
    "Right after I started drinking green tea the pain went away, so it must be the tea.",
    "Ever since the new manager arrived it has rained more, so obviously he brings luck.",
    "After the council painted the benches accidents fell, so it must be because of the paint.",
    "Since we moved to a four-day week profits rose, which proves the short week works.",
  ],
  "unsupported-claim": [
    "Sixty percent of pupils in the country never read a book.",
    "Traffic noise causes a ten percent drop in sleep.",
    "Studies show that working from home raises productivity.",
    "Our city is the most crowded in the country.",
    "House prices have tripled in the last decade.",
    "High sugar intake leads to poor concentration in children.",
    "More than half of small businesses close in their first year.",
    "Buses in the city are late by 12 minutes on average.",
    "The meals programme cut school dropout by 20%.",
    "Public transport is the main cause of air pollution in the city.",
  ],
  "logical-leap": [
    "The library is open until eight. Pupils like to study in groups. Therefore sports lessons should be cancelled.",
    "It rained a lot last month. The corner shop changed hands. Hence market prices will rise.",
    "The team worked hard on the new release. Customers asked for lighter colours. Thus the office should move to Haifa.",
    "Summer was long this year. The children took up music. Consequently the council must pave a new road.",
    "The restaurant gets good reviews. The neighbours bought a dog. Therefore we should sell the car.",
  ],
  none: [
    "According to the national statistics office, 40% of households own one car [@cbs2024].",
    "I think the library should open on Saturdays too.",
    "Is there a way to shorten the wait for the bus?",
    "All right, let's meet at ten.",
    "Either way, the meeting is on Tuesday.",
    "Yesterday we went to the beach, and in the evening we had dinner with the family.",
    "Maybe we should check it again next week.",
    "A study by the University of Haifa found that long waits raise stress (Cohen, 2021).",
    "The meeting is set for Tuesday morning.",
    "The table below sums up the results of both experiments.",
    "It seems the new method is easier to use.",
    "I read the book last week and enjoyed it.",
    "After all, it was only a draft.",
    "The teacher asked us to hand in the essay by Thursday.",
    "Data from the ministry's annual report show pupil numbers rose by 3%.",
    "There is a lemon tree and two olive trees in the garden.",
    "The train will probably be late again today.",
    "The film starts at eight, followed by a talk with the director.",
  ],
};

export function argumentSet(): ArgItem[] {
  const out: ArgItem[] = [];
  for (const [lang, table] of [["he", HE], ["en", EN]] as const) {
    for (const [label, texts] of Object.entries(table)) texts.forEach((text, i) => out.push({ id: `${lang}-${label}-${i + 1}`, lang, text, label }));
  }
  return out;
}
