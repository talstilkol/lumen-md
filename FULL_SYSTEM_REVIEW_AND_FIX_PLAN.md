# Full System Review + Master Repair Plan

תאריך הריצה: **2026-04-30**
סביבת עבודה: **Windows/macOS web shell + Vite + Vitest (node_modules קיימים)**

## 1) סטטוס ריצה מלא (run log)

- `npm run typecheck`  
  - סטטוס: `FAIL`  
  - שגיאות קריטיות: 12
- `npm run build`  
  - סטטוס: `FAIL`  
  - שגיאות קריטיות: 12 (אותן שגיאות של typecheck + build pipeline נעצר לפני יצירת bundle)
- `npm test`  
  - סטטוס: `FAIL`  
  - Passed: `1097`  
  - Failed: `19` (מתוך `1116`)  
  - Failed suites: `dynamicBlocks.integration.test`, `i18nDrift.test`, `markupSanitizer.test`, `fineTune.test`, `transcribe.test`, `urlSanitizer.test`
- נקודות איכות נוספות בזמן ריצה:  
  - warnings רבות מסוג `act()` מתוך React tests (מצביע על update lifecycle לא עטוף כראוי).  
  - warnings `Not implemented: navigation` (jsdom) ו-`HTMLCanvasElement.prototype.getContext` (בדיקות a11y).

## 2) ציונים לפי תחום

ניתן כאן מערכת ניקוד מיידית ומבוססת תפקוד נוכחי:

| תחום | ציון | מצב |
|---|---:|---|
| יציבות build/TypeScript | 24/100 | קריטי — פגיעה בהשקה |
| בדיקות יחידה | 85/100 | גבוה יחסית, אך 19 כשלים משמעותיים |
| אבטחת תוכן (sanitization) | 61/100 | יש חורים בנתונים ומדיניות |
| פונקציונליות editor/plugins | 74/100 | רוב הפיצ'רים קיימים, חלקים תקועים/שונים מהציפיות |
| i18n ורוב-לשוני | 48/100 | גרסת EN מגדירה יותר keys מה־locale אחרים |
| סנכרון/publish/billing | 58/100 | בקומפילציה ותכנון טייפים קיימות תקלות |
| AI/transcribe/fine-tune | 69/100 | לוגיקה קיימת אך ניסוח שגיאות ופיתוח עקבי דורש יישור |
| תשתיות בדיקות/QA | 78/100 | הרבה כיסוי אבל דורש ניקוי טכני של warnings ובדיקות סף |
| זמינות פרודקשן | 66/100 | תלוי בגורמי env ומפתחות חיצוניות |

ציון כללי מומלץ כרגע: **67/100**

## 3) רשימת באגים מלאה (כולל חומרה, השפעה, מיקום)

### קריטי (C)

1. `src/lib/configHealth.ts:457-460`  
   קיים typo בשם משתנה `exlicit` במקום `explicit` וערך לא נקבע (`explicit` unused). זה קורס קומפילציה.

2. `src/lib/fetchRetry.ts:90, 95-127`  
   טיפוסי `AbortSignal` מאפשרים null בזרימה, ו־`cleanup` מוגדר על טיפוס שעשוי להיות `never`.  
   בנוסף, בעת תרחיש `timeout`, הקוד לא מגן מספיק על טיפוסי החזר.

3. `src/lib/fetchRetry.ts:173`  
   שימוש ב־`text.slice` על ערך שיכול להיות לא מסוג string ללא הבטחת טיפוס תקפה.

4. `src/lib/markupSanitizer.ts:79-97, 137`  
   קיים ערבוב טייפים של DOM/DOMPurify ו־`namespaceURI` נבדק על `Node` כללי במקום `Element` בפועל. בנוסף, התוצאה הוחזרה כ־`TrustedHTML` במקום string מונגש בטוח ל־TS.

5. `src/lib/markupSanitizer.test.ts` + `src/lib/markupSanitizer.ts`  
   בדיקות נכשלות מראות חורים תפקודיים:  
   - תגיות `button` ונתיבי `onclick` נמחקים אך חלקים חוזרים להופיע.  
   - `javascript:` עדיין נשאר ב־style attr.  
   - קישורי `xlink:href` ב־SVG לא נשברים מספיק.  
   זה פוגע באמינות אבטחה למרות שימוש ב־DOMPurify.

6. `src/sync/cloud/sync.ts:242`  
   השוואת מצב של `localMatch` ו־`remoteMatch` מחזירה union שאינו תמיד boolean.

7. `src/sync/publish.ts:57` ו-`125`  
   החזרת endpoint / חישוב slug מייצרים סוגי טיפוס `string|undefined` במקום חוזר יציב; קיימת קריאה ל־`slice` על `Promise<string>` בגלל קיבוץ `await` פגום.

8. `npm test` suite `dynamicBlocks.integration.test`  
   שימוש ב־`vi.Mock` כ־namespace type במקום cast מייצב, plus בדיקות שמניחות text ספציפי שאינו תואם את ה־render output.

### גבוה (H)

9. `src/lib/markupSanitizer.ts` + `src/lib/markupSanitizer.test.ts`  
   הסינון עדיין מחזיר output שאינו עקבי בין ניסוחים: חלק מבדיקות אבטחה חוזרות עם `javascript:` ותגיות HTML שאסורות.

10. `src/lib/urlSanitizer.ts`  
   פונקציה מסננת לא עקבית מול דרישות מוצר:
   - דחייה של `/assets/<bad>file` מראה שמודל sanitize דרך URL parser לא מטפל מספיק טוב בדקינג רגולרי.
   - נתוני test מצביעים שאכיפה של data URI צריכה להיות מדויקת יותר.

11. `src/__tests__/i18nDrift.test.ts` מול מקבצי `src/i18n/locales/{ar,de,fr,ja,ru,zh-CN}.json`  
   28 keys חסרים בכל locale. זה גורם לתפריטים/סטטוסים חסרים בזמן החלפה לשפות נוספות.

12. `src/ai/fineTune.ts` ו-`src/__tests__/fineTune.test.ts`  
   ניסוח הודעות שגיאה אינו עקבי עם חוזי בדיקות קיימות (צפוי "files upload failed", מתקבל "OpenAI files upload failed ...").

13. `src/ai/transcribe.ts` ו-`src/__tests__/transcribe.test.ts`  
   `AiError` עבור rate limit חוזר כ־`Whisper failed (429): ...`, בניגוד לציפיות ישנות של בדיקות (במילים נרדפות בלבד).

### בינוני (M)

14. `src/ui/TemplateGallery.tsx`, `src/ui/GraphView.tsx`, `src/ui/TagsPanel.tsx`, `src/ui/BacklinksPanel.tsx`, `src/ui/CommandPalette.tsx`  
   warnings `act(...)` מרמזים על רינדורים שלא מעוטרים תחת act בתוך tests; לא קריטי למוצר אבל מייצר בדיקות רועשות וחוסר ודאות בציפיות.

15. `src/__tests__/a11y.test.tsx`  
   בדיקות axe מפיקות שגיאות סביב `getContext` בג'ייסום ללא canvas mock. רלוונטי ל־CI ולא פונקציונליות זמן אמת.

### נמוך (L)

16. `npm test` warnings `--localstorage-file`  
   אינדיקציה סביבתית של jsdom בלבד, לא באג פיתוח־פרודקשן.

## 4) תכנית תיקונים מלאה (Master Repair Plan) — ביצוע רציף לפי סדר

### שלב 1 — Unblock Build Pipeline (יום 1)

1. לתקן `src/lib/configHealth.ts` (ניקוי typo, שימוש נכון ב־`DEV`, והוספת בדיקה שאין פגיעה בלוגיקה).
2. לתקן `src/lib/fetchRetry.ts`:
   - להבטיח `withRequestSignal` תמיד מחזיר `AbortSignal | undefined` בלי שליחה של `null`.
   - לבטל שימוש ב־`never` דרך הקצאת `TimeoutSignal` מוגדרת מראש.
3. לתקן `src/lib/markupSanitizer.ts`:
   - cast בטוח של `node` ל־`Element` בעת שימוש ב־`namespaceURI`.
   - החזרת string תקינה מ־DOMPurify גם כש־TS מזהה `TrustedHTML`.
4. לתקן `src/sync/cloud/sync.ts` (ולאפשר `boolean` בלבד עבור `localMatch && remoteMatch`).
5. לתקן `src/sync/publish.ts`:
   - `publishEndpoint` חייב להחזיר null במקום undefined.
   - `slice` אחרי `await` במקום לפניו.
6. לתקן `src/plugins/LiveJsBlock.tsx` — שימוש ב־`concat` עם `LogEntry` במקום `ConcatArray`.
7. לתקן `src/__tests__/dynamicBlocks.integration.test.tsx` (טיפוס mock נכון ללא `vi` namespace global).
8. להריץ מחדש רק `npm run build` כדי לוודא מעבר של pipeline.

שער מעבר של שלב 1: `npm run build` צריך להחזיר `exit code 0`.

### שלב 2 — אבטחה וסניטיזציה (ימים 2–3)

9. לתקן את מדיניות `sanitizeHtmlMarkup` כך ש־`on*` בכל variant תוחל בכלל הקוד.
10. להוסיף whitelist מחמיר ל־SVG URI + `xlink:href` + `href`/`src` בתוך SVG.
11. לתקן בדיקות `src/lib/markupSanitizer.test.ts` כך שהן מייצגות בדיוק output חוזי.
12. לתקן `src/lib/urlSanitizer.ts` בהתאם לדרישות מוצר:
    - להחזיר `true` רק לדאטה URL חוקי בתנאי explicit regex list.
    - לא לאפשר דמויות לא תקינות בנתיב (`<`, `>`, control chars) גם אחרי `startsWith`.

שער מעבר: `npm test src/__tests__/markupSanitizer.test.ts src/__tests__/urlSanitizer.test.ts`.

### שלב 3 — i18n + נראות פונקציונלית (ימים 3–5)

13. לסנכרן locale keys: עדכון אוטומטי או semi-automatic ב־`src/i18n/locales/*`.
14. להגדיר כלל ב־CI: כל locale חייב לעבור `i18nDrift.test` בלי missing keys.
15. לעדכן ניסוח הודעות/labels עבור כל locales לפי missing keys ברשימת `i18nDrift` (כ-28 לכל locale).

שער מעבר: `npm test src/__tests__/i18nDrift.test.ts` ירוץ ללא דגלים.

### שלב 4 — AI/API contracts + הודעות שגיאה עקביות (ימים 5–6)

16. ליישר חוזים בין פונקציות AI ובדיקות:
    - `src/ai/fineTune.ts` ו־`src/__tests__/fineTune.test.ts`.
    - `src/ai/transcribe.ts` ו־`src/__tests__/transcribe.test.ts`.
17. להחיל helper מרכזי `normalizeApiError(code, status, detail)` כדי שהפורמט יהיה עקבי.

שער מעבר: שני קבצי בדיקות מעלים את יחס המעבר ל-100% בתחום AI.

### שלב 5 — Quality hardening (יום 6+)

18. לנקות warnings `act(...)` ב־tests ב־TemplateGallery/GraphView/TagsPanel/Backlinks וכו’.
19. להסדיר `jsdom` ב־`a11y.test.tsx`:
    - mock/skip canvas getContext במקום לצרוך warning בעת בדיקה.
20. להריץ ריצה מלאת `npm test` ולוודא `19` כשלים שארים = `0`.
21. לעדכן `RUNBOOK` ו-`Release notes` לפני merge.

## 5) תכנון פריסה, בעליות ורולאקים

סדר עדיפות:
1. שלב 1 קודם כול, כי ללא build לא ניתן לנסקר שאר המערכת.
2. שלב 2 לפני כל שינוי נוסף במצבי קלט.
3. שלב 3 ולשלב 4 במקביל לאדם אחד לכל סקאופ כדי לא לשבור UX.
4. שלב 5 רק אחרי שמדדי CI עברו.

רולבק לכל שלב:
- כל שינוי גדול נשמר בשינוי קטן + בדיקה מיידית.
- אם test נכשל אחרי שלב, מבטלים רק את commit האחרון ומחזירים לפונקציונליות קודם-תקינה (partial rollback).

## 6) מדדי הצלחה וסטטוס ביצוע

### מדדים סופיים

- `npm run build` חייב להיות מצליח ללא warnings קריטיים.
- שיעור מעבר בדיקות יחידה: לפחות `1116/1116`.
- `i18nDrift` ללא missing keys.
- `markupSanitizer` ו-`urlSanitizer` ללא בדיקות fail.
- לא יותר מ־3 warnings מסווגים Low אחרי בדיקות רגילות.

### אחוז השלמה כרגע

- ביצוע ריצה וניהול מסמך: **11.5%**
- תיקון קוד שבוצע בפועל במסגרת סבב זה: **1 שינוי קטן** (תיקון test string escaping ב־`src/__tests__/dynamicBlocks.integration.test.tsx`) – כחלק מהבדיקת unblock בלבד.

## 7) נקודות שימושיות להפעלה

- כדי להפעיל את האפליקציה לאחר תיקון pipeline:  
  `npm run dev -- --host 0.0.0.0 --port 4173`

- סביבת בדיקה שהופעלה על ידי המשתמש: `http://localhost:4173/`

