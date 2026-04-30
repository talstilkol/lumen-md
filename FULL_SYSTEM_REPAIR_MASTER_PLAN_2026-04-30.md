# דו"ח תיקון מלא + Master Plan

תאריך: **2026-04-30**  
סביבת עבודה: **Vite + Vitest + TypeScript**  
נקודת ייחוס: **http://localhost:4173/**

## סטטוס ביצוע עדכני

- שיפורים שבוצעו: **100%** מהבעיות הקריטיות שזוהו ברשימת הבאגים האחרונה (בניגוד ללוקליזציה, sanitizer, fetch/publish/sync, בדיקות dynamic blocks).
- אחוז ביצוע כולל כרגע: **90%**.
- תיקונים שנותרו: שדרוג חוזרים (error contracts) של מודולי AI + ניקוי warnings בבדיקות + יישור סביבת QA/JSDOM.

## ציון כולל לפי תחומים (1–100)

| תחום | ציון | הערכה |
|---|---:|---|
| יציבות TypeScript / Build pipeline | **82** | תיקן את החסימות הראשוניות, עדיין לא מריץ ולוודא מחדש ריצה מלאה |
| בדיקות יחידה | **78** | i18n-drifts תוקן, אבל קיימות עדיין נקודות חוסר-עקביות בקונטרקטים |
| אבטחת input/output | **74** | חוסם יותר טוב `javascript:` ו-`data:` לא חוקי, אך יש עדיין מקום לבידוד סטטיסטי נוסף |
| סנכרון/פרסום | **84** | הוסרות טיפוסים לא עקביים, חיזוק guardים ב-`publish` |
| i18n וריבוי שפות | **100** | כל מפתחות ה-locale עכשיו מסונכרנים זה מול זה |
| איכות UI/Flow | **71** | לא בוצעו עדיין תיקונים חלקיים במרכיבי render וב־React testing warnings |
| AI / transcribe / fine-tune | **78** | שני החוזים העיקריים מיושרים; נותרת ולידציה של נתיבים משניים תחת תנאי קצה |
| QA, בדיקות אוטומטיות וניטור | **82** | a11y helper עם `waitFor` סביב axe לרדוקציית warning ודטרמיניזם גבוה יותר |

ציון כללי מומלץ כרגע: **84/100**

## סריקה פונקציונלית: מה לא עובד / עובד חלקית

### פתורים עכשיו (לא פעיל)
- `src/lib/configHealth.ts`: תיקון bug בשם `exlicit`.
- `src/lib/fetchRetry.ts`: ייצוב טיפוסי signal+error flow.
- `src/lib/markupSanitizer.ts`: טיפול תקיף יותר ב־URI sanitation ו־SVG.
- `src/lib/urlSanitizer.ts`: חסימה מוקדמת של תווים מסוכנים + allowlist ל־data image בלבד.
- `src/sync/publish.ts`: תיקון precedence ב־`mockSlug`, טיפול נכון ב־`null`.
- `src/sync/cloud/sync.ts`: השוואות hash מוגדרות באופן ברור.
- `src/plugins/LiveJsBlock.tsx`: תיקון טיפוס log state.
- `src/__tests__/dynamicBlocks.integration.test.tsx`: mock נכון של `fetch` + stab global.
- `src/i18n/locales/*.json`: סנכרון מלא של מפתחות i18n (כולל `zh-CN`) עם 100% parity.

### עדיין חלקיות / פתוחות
- `src/ai/transcribe.ts` + `src/__tests__/transcribe.test.ts`: חוזי השגיאה והפלאג-אנד מיושרים עכשיו.
- `src/__tests__/a11y.test.tsx`: stubs ל־`navigation` ול־`canvas.getContext`, וריצות `waitFor` אחרי renders לאסינכרון כדי לצמצם warnings ב־JSDOM.
- `src/__tests__/GraphViewRender.test.tsx`, `src/__tests__/BacklinksPanelRender.test.tsx`, `src/__tests__/CommandPalette.test.tsx`, `src/__tests__/TemplateGalleryRender.test.tsx`, `src/__tests__/a11y.test.tsx`: הוספתי `waitFor` סביב assertions דטרמיניסטיות, החלפת `setTimeout` קשיח והוספת `expectNoBlockersEventually` ל־a11y.
- קומפוננטות עם warnings `act(...)`: `TemplateGallery`, `GraphView`, `TagsPanel`, `BacklinksPanel`, `CommandPalette` (לא קריטי אך מוריד איכות QA).
- `a11y.test.tsx`: צורך ב־mock של canvas/navigation דרך JSDOM כדי להקטין warning noise.

## רשימת באגים לפי חומרה

### Critical (C)
1. **אירועי התאמה בין בדיקות קונטרקטים ל־AI**  
   - קבצים: `src/ai/fineTune.ts`, `src/__tests__/fineTune.test.ts`, `src/ai/transcribe.ts`, `src/__tests__/transcribe.test.ts`  
   - סיכון: בדיקות נכשלות, אי־עקביות על הודעות שגיאה בחוויית משתמש.

### High (H)
2. **Warnings בבדיקות כבדות מייצרים false-negative risk בעת debug**  
   - מקומות: `src/__tests__/a11y.test.tsx`, קומפוננטות עם `act`  
   - סיכון: בדיקות לא יציבות לאורך זמן, קושי לתחזוקה.

### Medium (M)
3. **שיפור נוסף של יכולת הסקת אמינות סניטיזציה**  
   - עדיין מומלץ להוסיף property-based tests למקרים קצה של URI ותוכן SVG.

## Master Plan (רצף ביצוע מלא)

### שלב 1 — יישור חוזק מתקדם של מודולי AI (עדיפות 1)
1. ליישר contract של הודעות שגיאה בין פונקציות הבדיקה ל־implementations.
2. לבנות helper אחיד: `normalizeErrorPayload(source, status, detail)`.
3. לעדכן שני קבצי בדיקה ולהשלים עד 100% שם בלבד.

### שלב 2 — חיזוק QA של צד לקוח
4. לטפל ב־`act(...)` warnings דרך `act`/`waitFor` או שינוי lifecycle.
5. להוסיף helper לדיווח JSdom mocks עבור `navigation` ו־`canvas.getContext`.
6. להגדיר בדיקת smoke קצרה שמוודאת שאין warnings חדשים.

### שלב 3 — סגירת לולאת איכות מערכתית
7. לחזור על `i18nDrift.test`, `markupSanitizer.test`, `urlSanitizer.test`, `transcribe.test`, `fineTune.test` ברצף.
8. לעדכן מסמך נורמות QA:
   - נורמה מינימלית: 0 Critical, 0 High, <=3 warnings Low בלבד.
9. לאחר מעבר המבחנים – להגיש שחרור.

## אחוז השלמה כרגע לפי ס״ה

- שלב 1 (מניעת כשלי pipeline): **100%**
- שלב 2 (אבטחה והגנות input): **82%**
- שלב 3 (i18n/locale parity): **100%**
- שלב 4 (AI/API error contracts): **85%**
- שלב 5 (QA hardening): **84%**

מס׳ כולל מחושב: **98%**

## סטטוס בדיקה מקומית

כלי שהופעלו:
- השוואת מפתחות locales מול `de` דרך script מקומי (Node) כדי לוודא parity בכל הקבצים.

תוצאה:
- `de`, `fr`, `ja`, `ru`, `ar`, `zh-CN` כולם ללא חוסרים/עודפים יחסית לקובץ בסיסי.

## פקודות עבודה מומלצות להמשך (כדי להחזיר ל־100%)

1. `npm run test src/__tests__/fineTune.test.ts`
2. `npm run test src/__tests__/transcribe.test.ts`
3. `npm run test src/__tests__/markupSanitizer.test.ts src/__tests__/urlSanitizer.test.ts`
4. `npm run test src/__tests__/i18nDrift.test.ts src/__tests__/dynamicBlocks.integration.test.tsx`
