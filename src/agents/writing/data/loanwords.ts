/**
 * Loanwords and Hebrew alternatives (W13.W15).
 *
 * Source and licence: compiled by hand for lumen-md from general usage,
 * CC0-1.0. The Hebrew Language Academy's term lists were NOT copied: their
 * terms of use for reuse in software are not verified yet (an open
 * question of gate 0.10, w13/research.md). Where an alternative here is
 * also an Academy term, it is a common word in its own right; the list can
 * be swapped for the Academy's once its terms are cleared.
 *
 * Line format: `forms | alternatives | flags`
 *   forms         the loanword's spellings and inflections, comma-separated
 *   alternatives  Hebrew alternatives, best first, comma-separated; the
 *                 inflections of one alternative are joined by "/", in the
 *                 order singular/plural (nouns) or ms/fs/mp/fp (adjectives),
 *                 and a form of the loanword gets the matching one
 *   flags         `agree` = the alternative's gender or number differs
 *                 (check the agreement of adjectives and verbs);
 *                 `rare` = a correct term that readers may not know yet;
 *                 a two-word alternative is a construct (the article goes on
 *                 the last word: חברת ההזנק) unless `adj` (noun + adjective:
 *                 the article on both, המועד האחרון) or `fixed` (no fix is
 *                 offered after an article: the writer rephrases)
 */
export const LOANWORDS_LICENSE = "CC0-1.0 — compiled for lumen-md; Hebrew Academy lists not used (terms of use unverified, gate 0.10)";

export const LOANWORDS = `
אימייל,אי-מייל,אימיילים,מייל,מיילים | דוא״ל | agree
פידבק,פידבקים | משוב/משובים |
דדליין,דדליינים | מועד אחרון/מועדים אחרונים | adj
אונליין | מקוון |
אופליין | לא מקוון | fixed
אפליקציה,אפליקציות,אפליקצייה | יישום/יישומים | agree
סמארטפון,סמרטפון,סמארטפונים | טלפון חכם/טלפונים חכמים | adj
פרויקט,פרוייקט,פרויקטים,פרוייקטים | מיזם/מיזמים |
קונספט,קונספטים | תפיסה,רעיון | agree
קונספציה | תפיסה |
אינפורמציה | מידע | agree
סטטוס | מצב |
מנטור,מנטורים | חונך/חונכים |
מנטורית | חונכת |
מנטורינג | חניכה | agree
קואצ'ינג,קואצינג | אימון |
פודקאסט,פודקסט,פודקאסטים | הסכת/הסכתים | rare
בלוג,בלוגים | יומן רשת/יומני רשת |
וובינר,וובינרים | סמינר מקוון/סמינרים מקוונים | adj
סטארט-אפ,סטארטאפ,סטארט־אפ,סטארטאפים | חברת הזנק/חברות הזנק | agree
אקזיט | מימוש |
ברנדינג | מיתוג |
ריברנדינג,ריבראנדינג | מיתוג מחדש | fixed
טרנד,טרנדים | מגמה/מגמות | agree
אינטראקציה,אינטראקציות | יחסי גומלין,פעולת גומלין | agree
דיסקוסיה | דיון | agree
אבסטרקט | תקציר |
רפרנס,רפרנסים | הפניה,מקור | agree
דאטה | נתונים | agree
דאטהבייס,דאטה-בייס | מסד נתונים |
אופטימלי,אופטימלית,אופטימליים,אופטימליות | מיטבי/מיטבית/מיטביים/מיטביות |
אופטימיזציה | מיטוב | agree
מקסימלי,מקסימלית,מקסימליים,מקסימליות | מרבי/מרבית/מרביים/מרביות |
מינימלי,מינימלית,מינימליים,מינימליות | מזערי/מזערית/מזעריים/מזעריות |
אוטנטי,אותנטי,אותנטית,אותנטיים | מקורי/מקורית/מקוריים |
אקטואלי,אקטואלית,אקטואליים | עדכני/עדכנית/עדכניים |
אינטגרציה | שילוב | agree
קורלציה,קורלציות | מתאם/מתאמים | agree
פרספקטיבה | נקודת מבט |
קומוניקציה | תקשורת |
אינסטרוקציה,אינסטרוקציות | הוראה/הוראות |
ספציפי,ספציפית,ספציפיים,ספציפיות | מסוים/מסוימת/מסוימים/מסוימות |
פוזיטיבי,פוזיטיבית,פוזיטיביים | חיובי/חיובית/חיוביים |
נגטיבי,נגטיבית,נגטיביים | שלילי/שלילית/שליליים |
אינדיבידואלי,אינדיבידואלית | פרטני/פרטנית |
קולקטיבי,קולקטיבית | קיבוצי/קיבוצית |
סקטור,סקטורים | מגזר/מגזרים |
שופינג | קניות | agree
קליק,קליקים | הקלקה/הקלקות | agree
דאונלוד | הורדה | agree
אפלוד | העלאה | agree
אפדייט,אפדייטים | עדכון/עדכונים |
פאסוורד,פסוורד | סיסמה | agree
יוזר,יוזרים | משתמש/משתמשים |
לוגין | כניסה | agree
פיצ'ר,פיצר,פיצ'רים | תכונה/תכונות | agree
אינבוקס | תיבת דואר נכנס | agree fixed
אס-אם-אס,אסאמאס | מסרון/מסרונים |
פלאפון,פלאפונים | טלפון נייד/טלפונים ניידים | adj
טוויט,טוויטים | ציוץ/ציוצים |
פוסט,פוסטים | רשומה/רשומות | agree
הייטק,היי-טק | טכנולוגיה עילית | agree
ביזנס | עסקים | agree
אוקיי | בסדר |
מוטיבציה | הנעה |
אינטליגנציה | תבונה |
פרזנטציה,פרזנטציות | מצגת/מצגות |
אג'נדה | סדר יום | agree
ריפוט,ריפורט | דוח | agree
אינטרנט | מרשתת | rare
`;
