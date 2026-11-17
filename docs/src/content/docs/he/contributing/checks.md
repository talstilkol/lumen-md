---
title: בדיקות בכל ענף (Vercel)
description: השערים של Lumen רצים בבניית Vercel של כל ענף, בלי GitHub Actions — מה רץ, מה המשמעות של סטטוס אדום, ולאן עברו בדיקות ה-CI הישנות.
type: how-to
---

‏`main` ורכבות האינטגרציה (`verify/…`) מקבלים בנייה ב-Vercel כשהם נדחפים,
ו-Vercel מדווח עליה ב-commit כסטטוס **Vercel**; הענף של בקשת משיכה נבדק דרך
הרכבת (ראו [בניות שמדולגות](#בניות-שמדולגות)). הבנייה הזו היא השער של Lumen: פקודת הבנייה היא
`node scripts/vercel-build.mjs` (ב-`deploy/vercel.base.json`), ובניית preview
מריצה את כל הבדיקות. בקשת משיכה עם בדיקה שנכשלת או שער שבור מקבלת סטטוס
**Vercel** אדום; בקשה נקייה מקבלת ירוק. לא נצרכות דקות של GitHub Actions.

| בנייה | מה רץ, לפי הסדר |
|---|---|
| ‏Preview (רכבות `verify/…`) | סחיפת lockfile, ‏build, ‏`live:meta` על `dist/` (המטא-דאטה שנפרס מפנה רק ל-lumen-md.vercel.app), תקציב החבילה, סריקת הסודות של `dist/`, vitest (בלי החבילות של הלילה בלבד), ‏e2e (הסט המהיר ב-chromium, עם בדיקות ה-axe וה-aria בעברית; ‏smoke ב-firefox), ‏`i18n:check`, ‏hygiene, ‏`docs:sync`, ‏`docs:complete` (כל עמוד בשתי השפות, ולכל עמוד עברי הסעיפים של העמוד האנגלי, עוגני העזרה ולפחות 60% מהמילים שלו), שער הרישיונות, רצפת ה-mutation (‏`mutation:check`) |
| ‏Production (`main`) | build, ‏`live:meta` על `dist/`, תקציב החבילה, מניפסט הבנייה, בדיקות התקיפה על ההצפנה (‏`test:attacks`) |

השערים נעצרים בכישלון הראשון. יומן הבנייה מסתיים בשער שנכשל ובאלה שעברו
לפניו, עם הזמנים שלהם:

```text
✗ vercel-build: the vitest gate failed (212.4 s, exit 1). Passed before it: build 95.1 s, budget 1.2 s.
```

## השער המהיר וההרצה הלילית

בניית preview צריכה להסתיים בתוך 38 מתוך 45 הדקות ש-Vercel מאפשר; בנייה ארוכה יותר נכשלת (`GATE_BUDGET_MIN`). לכן הבנייה היא שער מהיר, והשאר רץ כל לילה במארח השני. קובץ אחד קובע מה רץ איפה, `scripts/test-tiers.mjs`, ו-`src/__tests__/testTiers.test.ts` בודק שאף בדיקה לא נופלת משניהם:

| | ‏Preview ב-Vercel (כל דחיפה לרכבת) | לילה (`npm run nightly:full`) |
|---|---|---|
| vitest | כל הקבצים חוץ מ-`VITEST_NIGHTLY_ONLY` (סטים מוזהבים, תקציבי זמן, סביבות ריצה שלמות), ‏worker אחד לכל מעבד במכסה של הבנייה | כל החבילה ב-2 רסיסים |
| e2e | ‏`E2E_FAST` ב-chromium (כ-50 בדיקות), ‏smoke ב-firefox | כל הקבצים ב-chromium, ‏firefox ו-WebKit, ‏4 רסיסים לכל אחד, מול בניית הייצור |
| תקציבי זמן | — | פרויקט ה-perf של `@nightly` |
| ‏Ignored Build Step | — | ‏`npm run check:vercel-ignore` ‏(W6.10) |

כל preview כותב את זמני השערים ואת קובצי ה-vitest האיטיים ל-`reports/vercel-build.json`, שמוגש גם ב-`/__build/receipt.json`. קובץ e2e מצטרף ל-`E2E_FAST` אחרי שהוא עובר בהרצה הלילית.

## בניות שמדולגות

Vercel בונה פריסה אחת בכל פעם, כך שכל בנייה בתור מעכבת את אלה שאחריה.
‏`scripts/vercel-ignore.sh` (ה-`ignoreCommand` של התצורה) מדלג על בנייה לפני
שהיא מתחילה כאשר:

- הענף שלה איננו `main` (פרודקשן) ואיננו רכבת אינטגרציה (`verify/…`): ענף של
  pull request נבדק דרך הרכבת (`verify/train-2`), ולכן לא נבנה בעצמו. משתנה
  הפרויקט ב-Vercel ‏`LUMEN_BUILD_ALL=1` מחזיר בנייה של כל ענף;
- ה-commit שלה כבר איננו ראש הענף: push חדש יותר ממתין בתור וייבנה במקומה.
  כשאי אפשר לקרוא את ראש הענף (אין רשת, הענף נמחק), הכלל הבא מחליט;
- ה-commit לא משנה שום דבר שבניית האתר קוראת (Markdown מחוץ ל-`src/`
  ו-`public/`, אתר התיעוד, הפריסות האחרות).

בנייה שדולגה מופיעה ב-Vercel כ-**Canceled**, לא כמעבר: הסטטוס של הענף נקבע
לפי ה-commit החדש ביותר שלו.

**הכללים האלה פועלים רק אחרי שמגדירים את Ignored Build Step בפרויקט ב-Vercel.**
התצורה של Lumen היא `vercel.ts`, ו-Vercel מהדר אותה רק אחרי ששלב הדילוג כבר
רץ, ולכן ה-`ignoreCommand` שב-`deploy/vercel.base.json` לא נקרא לעולם. הגדרת
הפרויקט (Settings ← Git ← Ignored Build Step) צריכה להיות
`bash scripts/vercel-ignore.sh`. עד שהיא מוגדרת, כל ענף שנדחף נבנה. ענף שאין
ב-commit שלו את הסקריפט נכשל בפקודה עם קוד יציאה שאינו אפס, ולכן נבנה כרגיל.

## להריץ את אותן בדיקות מקומית

```bash
node scripts/vercel-build.mjs              # the preview set
node scripts/vercel-build.mjs --production # build, live:meta, budget and manifest only
node scripts/vercel-build.mjs --dry-run    # print the gates, run nothing
```

מחוץ ל-Vercel (בלי `VERCEL_ENV`) הסקריפט מריץ את סט ה-preview, כך שהרצה
מקומית היא מה שהבנייה של הענף תעשה. כל שער הוא גם סקריפט npm בפני עצמו:
‏`npm run build`, ‏`npm run budget`, ‏`npm test`, ‏`npm run e2e:gate` (אחרי `VITE_E2E=1 npm run build`: הבדיקות מגיעות למודולים של האפליקציה דרך `window.__lumenTest`, שקיים רק בבנייה כזו), ‏`npm run i18n:check`,
‏`npm run hygiene`, ‏`npm run docs:sync`, ‏`npm run docs:complete`, ‏`npm run licenses`, ‏`npm run lockfile:drift`, ‏`npm run secrets:dist` (ראו
[סריקת סודות בבנייה](/he/security/secret-scan/)).

### סחיפת lockfile

שער ה-preview הראשון, ‏`npm run lockfile:drift`, משווה את העץ המותקן
(‏`npm ls --all`) ל-`package-lock.json`. הוא נכשל על כל חבילה שמותקנת בגרסה
אחרת, חסרה, או מותקנת בלי להיות נעולה, ומדפיס שורה לכל חבילה. הוא נכשל גם
כש-`package.json` והרשומה הראשית של ה-lockfile לא מסכימים. כך מה שהשערים
בודקים הוא מה שנשלח. בלי `node_modules`, הדגל `--lock-only` בודק רק את
`package.json` מול ה-lockfile, והדגל `--tree <dir>` מציג גם חבילות ש-`node_modules`
אחר (shim לבדיקות לא מקוונות) מחזיק בגרסאות שה-lockfile לא נועל. לתיקון
סחיפה, מתקינים מחדש עם `npm ci`. אם `package.json` השתנה, יוצרים את ה-lockfile
מחדש עם `npm install --package-lock-only` ומבצעים לו commit.

לתיעוד יש בדיקות משלו: לכל עמוד יש סוג Diátaxis (מדריך, איך עושים, עיון
או הסבר), כל עמוד תכונה נוקב במשימה שלו בתוכנית, וכל דוגמה שמסומנת `run` —
כמו שתי אלה — רצה ועוברת:

```sh run
node scripts/docs-meta.mjs --check    # expect: every one typed
node scripts/docs-parity.mjs --strict
```

```js run
const { bannerFor } = await import(process.cwd() + "/scripts/lib/docsMeta.mjs");
const tasks = new Map([["W1.1", { verified: "built" }], ["W1.2", { verified: "browser" }]]);
console.log(bannerFor(["W1.2"], tasks) === null ? "verified: no banner" : "?");
console.log(bannerFor(["W1.1"], tasks).includes("Beta") ? "built: beta banner" : "?");
// expect: built: beta banner
```

## מה לא רץ בבנייה

בדיקות שצריכות דפדפנים, מכשירים או מפתחות חתימה לא יכולות לרוץ בבניית Vercel.
הן רצות ב-Vercel Sandbox ‏(W1.1) או במחשב של מפתח:

| משימה בתוכנית | היה | עכשיו |
|---|---|---|
| 8.3 שער Lighthouse | משימת LHCI בכל PR | שלב Lighthouse ב-Buildkite רץ על כל PR, בלי תנאי תווית או ענף: `npm run lighthouse` מריץ את Lighthouse CI 0.16.1 ‏(Lighthouse 13) במחשב (`lighthouserc.json`: ביצועים ≥ 0.9, ‏LCP ≤ 2.5 שניות, ‏TBT ≤ 200 ms, ‏CLS ≤ 0.1) ובטלפון (`lighthouserc.mobile.json`: ביצועים ≥ 0.8, ‏LCP ≤ 2.5 שניות), 5 ריצות בכל אחד, הריצה החציונית, וכל סף הוא שגיאה. הדוחות נשמרים בדיסק תחת `reports/lh/` וכתוצרי בנייה, אף פעם לא באחסון ציבורי. בניית preview ב-Vercel מריצה גם את `npm run perf:gate` אחרי ה-e2e. ‏`src/__tests__/perfGate.test.ts` נכשל כשסף כלשהו רפוי מהתוכנית. ‏INP נמדד ב-`e2e/inp-budget.spec.ts`. |
| 0.19 שער PR ‏(Danger.js, ‏size-limit) | תגובת Danger ו-size-limit בכל PR | חלק הגודל הוא שער **תקציב החבילה** (לכל chunk ראשי יש תקציב, `scripts/bundle-budget.mjs`); קריאת רשת שלא רשומה מכשילה את **vitest** ‏(`src/__tests__/cloudRoutes.test.ts` בודק כל נתיב ענן); הפרש הרישיונות הוא **שער הרישיונות**. לתגובה עצמה ב-PR עוד אין תחליף |
| 13.3 בניות Android ו-iOS | בניות מובייל ב-CI | `npm run android:sync` / `npm run ios:sync` במחשב עם ה-SDK (‏iOS דורש macOS); חלק הרשת שהן כוללות הוא מה שבניית ה-preview בודקת |
| 13.4 צינור שחרור | workflow של שחרור | סקריפט שחרור מקומי, ארטיפקטים חתומים ו-rollback במחשב של מפתח; השחרור של אפליקציית הרשת הוא בניית ה-production |
| e2e של Playwright | משימות e2e בכל PR | שער **e2e** מריץ את הסט המהיר (`E2E_FAST` ב-`scripts/test-tiers.mjs`) ב-chromium ואת בדיקת ה-smoke ב-firefox בתוך הבנייה (`scripts/e2e-gate.mjs`); כל החבילה רצה כל לילה ברסיסים (`npm run nightly:full`), כי במכונת הבנייה פרויקט chromium לבדו לוקח כ-30 דקות. WebKit לא יכול לרוץ בבנייה: ה-WebKit של Playwright צריך glibc 2.38, ובתמונת הבנייה (Amazon Linux 2023) יש 2.34. הכיסוי של Safari נעשה על Mac ‏(W4.22) |

## כל חבילת ה-e2e לפני ש-main מתקדם

השלב `e2e-shards` ב-Buildkite מריץ את כל פרויקט chromium ב-4 רסיסים במקביל (‏`node scripts/e2e-gate.mjs --full`). כל רסיס רץ על בניית הייצור עם `VITE_E2E=1`, בתוך תיבה של 10 דקות. השלב `e2e-receipt` מאחד את הרסיסים לקובץ `reports/e2e-<sha>.json`, חתום במפתח Ed25519 של המכונה. הוא אדום אם רסיס אחד לא עבר.

‏main מתקדם רק דרך `npm run promote:main -- <commit> --push`. הפקודה מסרבת אם לאותו commit (או ל-commit עם אותו עץ) אין דוח חתום, אם החתימה לא מתאמתת במפתח מ-`security/e2e-receipt-keys/` כפי שהוא ב-`origin/main` (נקרא דרך git, אף פעם לא מה-commit שמקודם; ‏`--key` או `--keys` בתוך העותק נדחים), אם בדיקה אחת נכשלה, או אם רסיס חרג מהתיבה שלו. היא דוחפת רק fast-forward, אף פעם לא בכוח. ‏`npm run promote:check` (קבלות WebKit ו-Safari) היא בדיקה נפרדת, ושתיהן צריכות לעבור.

## כששער אדום

פתחו את הפריסה של Vercel מהסטטוס של ה-commit וקראו את סוף יומן הבנייה: השער
שנכשל מופיע שם בשמו. תקנו אותו בענף ודחפו שוב; ‏Vercel בונה את ה-commit
החדש. שער שנכשל אף פעם לא מדולג ולא מוחלש כדי לקבל סטטוס ירוק.
