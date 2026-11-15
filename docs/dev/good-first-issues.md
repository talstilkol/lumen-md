# משימות ראשונות (good first issues)

חמש־עשרה משימות קטנות, כל אחת בקובץ אחד או שניים. כל אחת נבדקה מול הקוד
של `verify/train-5` (15.11.2026): הבעיה קיימת שם. כל משימה אומרת איפה הבעיה,
מה לא בסדר בה, ומה נחשב "גמור". ההנחיות הכלליות (ענפים, `[skip ci]`,
‏`pr:check`) נמצאות ב־[CONTRIBUTING.he.md](../../CONTRIBUTING.he.md).

התוויות ב־GitHub (`good-first-issue`, ותווית גודל) הן פריט בעלים (10.O):
כשהן קיימות, כל שורה כאן נפתחת כ־issue משלה, עם הכותרת באנגלית שבסוגריים.

גודל: **S** פחות משעה, **M** עד חצי יום.

## קוד

### 1. ‏Ctrl+Z בתוך Excalidraw לא אמור לשחזר קובץ שנמחק (S)
*(Trash undo: treat Excalidraw as an editing surface)*

- **איפה:** `src/ui/trashUndoShortcut.ts:15`, הבורר `EDITING`.
- **מה לא בסדר:** הבורר כולל את `.tl-container` של tldraw, אבל לא את
  Excalidraw. ‏Ctrl+Z על הקנבס מגיע לקיצור של הסל אם Excalidraw לא עוצר את
  האירוע קודם, ואז במקום לבטל קו, האפליקציה משחזרת קובץ שנמחק.
- **גמור כש:** ‏`.excalidraw` נמצא ב־`EDITING`, ו־`src/__tests__/trashUndo.test.ts`
  כולל בדיקה שבה Ctrl+Z עם פוקוס בתוך `.excalidraw` לא משחזר כלום. הבדיקה
  נכשלת לפני השינוי.

### 2. ‏`slugify` ב־`lib/utils.ts` לא בשימוש, ומוחק עברית (S)
*(Remove the unused, Hebrew-dropping slugify)*

- **איפה:** `src/lib/utils.ts:26`.
- **מה לא בסדר:** אף קובץ ייצור לא קורא לפונקציה, רק הבדיקה שלה. ‏`[^\w\s\-]` מוחק כל אות
  עברית, כך ש־`slugify("שלום עולם")` מחזיר `"-"`. היא גם אחת משלוש הפונקציות
  `slug` בקוד (לצד `renderer/remarkLumen.ts:234` ו־`ai/modelHosting.ts:109`).
  ההפרה היחידה של `no-useless-escape` בקובץ רשומה בשבילה ב־`eslint-suppressions.json`.
- **גמור כש:** הפונקציה והבדיקות שלה ב־`src/__tests__/utils.test.ts` נמחקו
  (אף קוד ייצור לא קורא לה), ‏`npm run lint:prune` הוריד את השורה שלה
  מ־`eslint-suppressions.json`, ו־`npm run lint` ירוק.

### 3. ‏`no-useless-escape` ב־`storage/fileFormats.ts` (S)
*(Fix the recorded no-useless-escape in fileFormats.ts)*

- **איפה:** `src/storage/fileFormats.ts`, הפרה אחת רשומה ב־`eslint-suppressions.json`.
- **גמור כש:** הביטוי הרגולרי בלי ה־escape המיותר, ‏`npm run lint:prune`
  הקטין את ה־baseline, ו־`src/__tests__/fileFormats*.test.ts` ירוק.

### 4. ‏`any` אחד ב־`plugins/CsvBlock.tsx` (S)
*(Type the one `any` in CsvBlock.tsx)*

- **איפה:** `src/plugins/CsvBlock.tsx`, הפרה אחת של
  `@typescript-eslint/no-explicit-any` ב־baseline.
- **גמור כש:** הטיפוס האמיתי (או `unknown` עם צמצום) במקום `any`,
  ו־`npm run lint:prune` ו־`npm run typecheck` ירוקים.

### 5. כפתור בלי מקלדת ב־`sync/cloud/ConflictDialog.tsx` (S)
*(Keyboard access in the sync conflict dialog)*

- **איפה:** `src/sync/cloud/ConflictDialog.tsx`, הרכיב `Side`: ‏`<div onClick={onPick}>`
  (שורה 245), והפרה של
  `jsx-a11y/click-events-have-key-events` רשומה ב־baseline.
- **גמור כש:** האלמנט הוא `<button>` (או שיש לו `onKeyDown` ו־`role`),
  אפשר לבחור צד בסכסוך עם Enter ו־Space, ו־`npm run lint:prune` הקטין את ה־baseline.

### 6. רווח לא רגיל בקוד של `lib/textDirection.ts` (S)
*(Replace the irregular whitespace literal in textDirection.ts)*

- **איפה:** `src/lib/textDirection.ts`, הפרה של `no-irregular-whitespace` ב־baseline.
- **מה לא בסדר:** בשורה 13 (`RTL_CHAR`) הטווחים כתובים בתווים עצמם, ואחד מהם
  הוא U+FEFF (רווח באורך אפס), כך שבעורך לא רואים איפה הטווח נגמר.
- **גמור כש:** הטווחים כתובים כ־`\u0590-\u08FF` וכן הלאה, עם הערה, הבדיקות
  של `textDirection` ירוקות, ו־`npm run lint:prune` הקטין את ה־baseline.

### 7. תלות חסרה ב־`useEffect` של `plugins/PlantUMLBlock.tsx` (M)
*(Fix the exhaustive-deps finding in PlantUMLBlock.tsx)*

- **איפה:** `src/plugins/PlantUMLBlock.tsx`, הפרה של
  `react-hooks/exhaustive-deps` ב־baseline.
- **גמור כש:** רשימת התלויות שלמה, בלי רינדור אינסופי. בדיקה שמוכיחה
  שהבלוק מרונדר מחדש כשהקוד שלו משתנה, ו־`npm run lint:prune`.

### 8. בדיקת הרופא מדווחת "ok" על כתוביות תמונה תמיד (S)
*(AI doctor: engines.caption is always "ok")*

- **איפה:** `src/agents/doctorEngines.ts`, הבדיקה `engines.caption` (בערך שורה 144).
- **מה לא בסדר:** הסטטוס הוא `"ok"` בכל מצב, גם כשאף מודל כתוביות לא הורד.
  הבדיקות של nikud ושל NER מעליה מבחינות בין המצבים.
- **גמור כש:** בלי מודל מוכן הסטטוס הוא `"warn"` (או סטטוס "info", אם
  מוסיפים אותו), עם הסבר שההורדה תהיה בשימוש הראשון ובהסכמה. בדיקה
  ב־`src/__tests__/aiDoctorComplete.test.ts`.

### 9. למחוק את `plugins/sandbox.ts`, שאף אחד לא מייבא (S)
*(Delete the unused plugin sandbox with the weak CSP)*

- **איפה:** `src/plugins/sandbox.ts`, רשום ב־`scripts/unused-files.baseline.json`.
- **מה לא בסדר:** הקובץ לא בשימוש. ה־CSP שבו חלש (`script-src https:`,
  ‏`connect-src https:`), ומי שיחפש איך תוספים מבודדים ימצא אותו ויטעה.
  הארגז האמיתי הוא `src/plugins/runtime/`.
- **גמור כש:** הקובץ נמחק, ‏`node scripts/check-unused-files.mjs --prune` הוריד
  אותו מה־baseline, ו־`npm run unused` ירוק.

### 10. ‏`hooks/useGit.ts` שאף אחד לא מייבא (S)
*(Delete or wire src/hooks/useGit.ts)*

- **איפה:** `src/hooks/useGit.ts`, רשום ב־`scripts/unused-files.baseline.json`.
- **גמור כש:** הקובץ נמחק, או מיובא ממקום שבאמת צריך אותו (עם בדיקה).
  אחר כך `--prune` כמו במשימה 9.

### 11. ‏`lib/cryptoStorage.ts` שאף אחד לא מייבא (S)
*(Delete or wire src/lib/cryptoStorage.ts)*

- **איפה:** `src/lib/cryptoStorage.ts`, רשום ב־baseline הקבצים הלא מיובאים.
- **שימו לב:** קובץ קריפטו נמצא ב־`.github/CODEOWNERS`, ולכן מחיקה שלו
  צריכה סקירה אנושית (`human-reviewed`). זה עדיין שינוי קטן.
- **גמור כש:** כמו במשימה 10.

### 12. ‏`ui/CanvasWhiteboard.tsx` שאף אחד לא מייבא (S)
*(Delete or wire src/ui/CanvasWhiteboard.tsx)*

- **איפה:** `src/ui/CanvasWhiteboard.tsx`, רשום ב־baseline.
- **גמור כש:** כמו במשימה 10. אם יש בו משהו שהקנבס הנוכחי צריך, מעבירים
  אותו לשם עם בדיקה.

### 13. גישה ממקלדת ב־`components/AuthDialog.tsx` (S)
*(Keyboard access in AuthDialog.tsx)*

- **איפה:** `src/components/AuthDialog.tsx`, הפרה אחת של
  `jsx-a11y/click-events-have-key-events` ב־baseline.
- **גמור כש:** כמו במשימה 5.

## בדיקות ומדידה

### 14. למדוד שהחלפת ערכת נושא לוקחת פחות מ־100ms (M)
*(Measure the < 100 ms theme switch, W1.21)*

- **איפה:** `src/lib/themeSettings.ts` (ההחלה), בדיקה חדשה ב־`e2e/`.
- **מה לא בסדר:** משימה W1.21 דורשת החלפה בפחות מ־100ms, ואף בדיקה לא
  מודדת את זה. ‏`safeThemes.test.ts` בודק רק ניגודיות.
- **גמור כש:** בדיקת Playwright שמחליפה ערכה 10 פעמים ומודדת מהפקודה עד
  ה־paint הבא (`requestAnimationFrame` כפול). החציון נרשם, ונכשל מעל 100ms.

### 15. ‏`hebrew-layout.spec.ts` מדלג על WebKit (M, צריך Mac)
*(Run the Hebrew layout e2e on WebKit too)*

- **איפה:** `e2e/hebrew-layout.spec.ts:64`:
  `test.skip(browserName === "webkit", "synthetic keyCode is not seen by CodeMirror in Playwright WebKit")`.
- **מה לא בסדר:** הבדיקה שולחת אירוע מקלדת סינתטי, ש־CodeMirror לא רואה
  ב־WebKit, ולכן פריסת המקלדת העברית לא נבדקת ב־Safari.
- **גמור כש:** הבדיקה משתמשת ב־`page.keyboard.press` (או
  `keyboard.insertText`) ורצה ירוקה ב־WebKit על Mac (`npx playwright test
  e2e/hebrew-layout.spec.ts --project=webkit`), בלי ה־skip.
