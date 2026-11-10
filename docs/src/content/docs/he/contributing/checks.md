---
title: בדיקות בכל ענף (Vercel)
description: השערים של Lumen רצים בבניית Vercel של כל ענף, בלי GitHub Actions — מה רץ, מה המשמעות של סטטוס אדום, ולאן עברו בדיקות ה-CI הישנות.
---

כל ענף שנדחף ל-GitHub מקבל בנייה ב-Vercel, ו-Vercel מדווח עליה ב-commit
כסטטוס **Vercel**. הבנייה הזו היא השער של Lumen: פקודת הבנייה היא
`node scripts/vercel-build.mjs` (ב-`deploy/vercel.base.json`), ובניית preview
מריצה את כל הבדיקות. בקשת משיכה עם בדיקה שנכשלת או שער שבור מקבלת סטטוס
**Vercel** אדום; בקשה נקייה מקבלת ירוק. לא נצרכות דקות של GitHub Actions.

| בנייה | מה רץ, לפי הסדר |
|---|---|
| ‏Preview (כל ענף חוץ מ-`main`) | build, תקציב החבילה, vitest, ‏`i18n:check`, ‏hygiene, ‏`docs:sync`, שער הרישיונות |
| ‏Production (`main`) | build, תקציב החבילה — כמו קודם |

השערים נעצרים בכישלון הראשון. יומן הבנייה מסתיים בשער שנכשל ובאלה שעברו
לפניו, עם הזמנים שלהם:

```text
✗ vercel-build: the vitest gate failed (212.4 s, exit 1). Passed before it: build 95.1 s, budget 1.2 s.
```

## להריץ את אותן בדיקות מקומית

```bash
node scripts/vercel-build.mjs              # the preview set
node scripts/vercel-build.mjs --production # build and budget only
node scripts/vercel-build.mjs --dry-run    # print the gates, run nothing
```

מחוץ ל-Vercel (בלי `VERCEL_ENV`) הסקריפט מריץ את סט ה-preview, כך שהרצה
מקומית היא מה שהבנייה של הענף תעשה. כל שער הוא גם סקריפט npm בפני עצמו:
‏`npm run build`, ‏`npm run budget`, ‏`npm test`, ‏`npm run i18n:check`,
‏`npm run hygiene`, ‏`npm run docs:sync`, ‏`npm run licenses`.

## מה לא רץ בבנייה

בדיקות שצריכות דפדפנים, מכשירים או מפתחות חתימה לא יכולות לרוץ בבניית Vercel.
הן רצות ב-Vercel Sandbox ‏(W1.1) או במחשב של מפתח:

| משימה בתוכנית | היה | עכשיו |
|---|---|---|
| 8.3 שער Lighthouse | משימת LHCI בכל PR | `npm run lighthouse` (חציון של 5 ריצות, הספים ב-`lighthouserc.json`) ב-Sandbox, מול הבנייה של ה-preview; לא שלב בבנייה, כי הוא צריך Chromium |
| 0.19 שער PR ‏(Danger.js, ‏size-limit) | תגובת Danger ו-size-limit בכל PR | חלק הגודל הוא שער **תקציב החבילה** (לכל chunk ראשי יש תקציב, `scripts/bundle-budget.mjs`); קריאת רשת שלא רשומה מכשילה את **vitest** ‏(`src/__tests__/cloudRoutes.test.ts` בודק כל נתיב ענן); הפרש הרישיונות הוא **שער הרישיונות**. לתגובה עצמה ב-PR עוד אין תחליף |
| 13.3 בניות Android ו-iOS | בניות מובייל ב-CI | `npm run android:sync` / `npm run ios:sync` במחשב עם ה-SDK (‏iOS דורש macOS); חלק הרשת שהן כוללות הוא מה שבניית ה-preview בודקת |
| 13.4 צינור שחרור | workflow של שחרור | סקריפט שחרור מקומי, ארטיפקטים חתומים ו-rollback במחשב של מפתח; השחרור של אפליקציית הרשת הוא בניית ה-production |
| e2e של Playwright | משימות e2e בכל PR | `npx playwright test` ב-Vercel Sandbox ‏(W1.1) |

## כששער אדום

פתחו את הפריסה של Vercel מהסטטוס של ה-commit וקראו את סוף יומן הבנייה: השער
שנכשל מופיע שם בשמו. תקנו אותו בענף ודחפו שוב; ‏Vercel בונה את ה-commit
החדש. שער שנכשל אף פעם לא מדולג ולא מוחלש כדי לקבל סטטוס ירוק.
