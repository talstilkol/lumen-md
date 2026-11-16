# משימות ראשונות (good first issues)

חמש־עשרה משימות קטנות, כל אחת בקובץ אחד או שניים. כל אחת נבדקה מול הקוד
של `verify/train-7` ‏(f090c20812, ‏17.11.2026): הבעיה קיימת שם. (בביקורת r3
הוחלפו שש משימות שכבר נעשו או שהקבצים שלהן נמחקו: 1, 2, 9–12.) כל משימה אומרת איפה הבעיה,
מה לא בסדר בה, ומה נחשב "גמור". ההנחיות הכלליות (ענפים, `[skip ci]`,
‏`pr:check`) נמצאות ב־[CONTRIBUTING.he.md](../../CONTRIBUTING.he.md).

התוויות ב־GitHub (`good-first-issue`, ותווית גודל) הן פריט בעלים (10.O):
כשהן קיימות, כל שורה כאן נפתחת כ־issue משלה, עם הכותרת באנגלית שבסוגריים.

גודל: **S** פחות משעה, **M** עד חצי יום.

## קוד

### 1. רווח לא רגיל בביטוי של `storage/exportPptx.ts` (S)
*(Replace the irregular whitespace literal in exportPptx.ts)*

- **איפה:** `src/storage/exportPptx.ts:140`, ‏`RTL_RE`; הפרה של `no-irregular-whitespace` ב־`eslint-suppressions.json`.
- **מה לא בסדר:** אותו ביטוי כמו `RTL_CHAR` ב־`lib/textDirection.ts` (משימה 6), כתוב
  בתווים עצמם, ואחד מהם הוא U+FEFF. שני עותקים של אותו טווח יכולים להיפרד.
- **גמור כש:** הטווח כתוב ב־escapes (‏`\u0590-\u08FF` וכן הלאה), או ש־`exportPptx.ts`
  מייבא את הטווח מ־`lib/textDirection.ts`; הבדיקות של ייצוא PPTX ירוקות,
  ו־`npm run lint:prune` הקטין את ה־baseline.

### 2. ‏`\xa0` כתו ממשי ב־`plugins/liveJsScope.ts` (S)
*(Write the identifier ranges in liveJsScope.ts as escapes)*

- **איפה:** `src/plugins/liveJsScope.ts:58-59` (‏`isIdStart`, ‏`isIdPart`); שתי הפרות של
  `no-irregular-whitespace` ב־baseline.
- **מה לא בסדר:** הטווח מתחיל ברווח קשיח (U+00A0) שכתוב כתו, ולא כ־`\xa0`, כך שבעורך
  נראה כאילו הטווח מתחיל ברווח רגיל.
- **גמור כש:** שני הביטויים כתובים `/[A-Za-z_$\xa0-\uffff]/` ו־`/[\w$\xa0-\uffff]/` ב־escapes,
  הבדיקות של live JS ירוקות, ו־`npm run lint:prune` הקטין את ה־baseline.

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

### 9. תפריט החשבון ב־`components/AuthButton.tsx` לא מקבל פוקוס (S)
*(Make the account menu in AuthButton.tsx focusable)*

- **איפה:** `src/components/AuthButton.tsx:89-90`, ה־`<div role="menu">`; הפרה של
  `jsx-a11y/interactive-supports-focus` ב־baseline.
- **מה לא בסדר:** ‏`role="menu"` בלי `tabIndex`, כך שאי אפשר להגיע לתפריט במקלדת
  כשהוא נפתח, ו־Escape לא סוגר אותו.
- **גמור כש:** לתפריט יש `tabIndex={-1}` והפוקוס עובר אליו (או לפריט הראשון) כשהוא נפתח,
  Escape סוגר אותו ומחזיר פוקוס לכפתור, בדיקה ב־`src/__tests__/` שמוכיחה את זה,
  ו־`npm run lint:prune` הקטין את ה־baseline.

### 10. תפקידים כפולים ב־`ui/BacklinksPanel.tsx` (S)
*(Decide the redundant list roles in BacklinksPanel.tsx)*

- **איפה:** `src/ui/BacklinksPanel.tsx:94` ו־`:96`: ‏`<ul role="list">` ו־`<li role="listitem">`;
  שתי הפרות של `jsx-a11y/no-redundant-roles` ב־baseline.
- **מה לא בסדר:** אלה התפקידים שהאלמנטים כבר נושאים. יש סיבה ידועה להשאיר את `role="list"`
  (Safari ו־VoiceOver מורידים את הסמנטיקה של רשימה עם `list-style: none`), אבל אז
  היא צריכה להיכתב בקוד ולא להסתתר ב־baseline.
- **גמור כש:** או שהתפקידים הוסרו, או ש־`role="list"` נשאר עם `// eslint-disable-next-line
  jsx-a11y/no-redundant-roles -- Safari: list-style none drops list semantics` ו־`role="listitem"`
  הוסר; ‏`npm run lint:prune` הקטין את ה־baseline.

### 11. ‏`autoFocus` בחיפוש של `ui/AiFab.tsx` (S)
*(Replace autoFocus in AiFab.tsx with focus on open)*

- **איפה:** `src/ui/AiFab.tsx:155`; הפרה של `jsx-a11y/no-autofocus` ב־baseline.
- **מה לא בסדר:** ‏`autoFocus` קופץ גם כשהרכיב מוצג מחדש, וקוראי מסך מאבדים את המקום.
- **גמור כש:** הפוקוס עובר לשדה ב־`useEffect` רק כשהלוח נפתח (ref), בדיקה ב־`src/__tests__/`
  שהפוקוס בשדה אחרי פתיחה, ו־`npm run lint:prune` הקטין את ה־baseline.

### 12. ‏`autoFocus` ותפקיד כפול ב־`ui/CommentsPanel.tsx` (S)
*(Focus the reply box in CommentsPanel.tsx without autoFocus)*

- **איפה:** `src/ui/CommentsPanel.tsx:290` (שדה התשובה), ו־`jsx-a11y/no-redundant-roles` אחת;
  שתיהן ב־baseline.
- **גמור כש:** כמו במשימה 11 לשדה התשובה (פוקוס כש־"השב" נלחץ), התפקיד הכפול הוסר,
  ו־`npm run lint:prune` הקטין את ה־baseline.

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
