# לתרום ל־Lumen

תודה שבאת לעזור. הקובץ הזה הוא הגרסה הראשית של הנחיות התרומה. הגרסה
האנגלית, [CONTRIBUTING.md](CONTRIBUTING.md), באה אחריו, וכשיש ביניהן הבדל,
העברית קובעת.

משימות קטנות להתחלה, כל אחת עם הקובץ ומה נחשב "גמור":
[docs/dev/good-first-issues.md](docs/dev/good-first-issues.md).

## התקנה

```bash
git clone https://github.com/talstilkol/lumen-md.git
cd lumen-md
npm ci             # בדיוק מה שב־package-lock.json
npm run dev        # http://localhost:5173
```

צריך Node ‏22.13 ומעלה (או 24). לשולחן העבודה: `npm run tauri:dev`.
למובייל: `npm run build`, ואז `npx cap sync` ו־`npx cap run ios` (או `android`).

## עקרונות

- **מקומי קודם.** הנתונים נשארים במכשיר (OPFS) כברירת מחדל. כל שירות ענן
  הוא בחירה מפורשת של המשתמש, וכל בקשת רשת רשומה ב־`src/ai/privacyLedger.ts`.
- **עברית ו־RTL הם לא תוספת.** כל מסך נבדק גם בעברית (RTL) וגם באנגלית (LTR).
- **אין `any`.** ‏TypeScript במצב strict. משתמשים ב־`unknown` ומצמצמים.
- **אין מחרוזות קשיחות.** כל טקסט שהמשתמש רואה עובר דרך `t("key")`
  (`src/i18n/index.ts`).
- **טעינה עצלה.** ספריות כבדות (Mermaid, ‏ECharts, ‏Excalidraw, ‏Graphviz) נטענות
  ב־`lazy()`.
- **תוספים בארגז חול.** תוסף של צד שלישי רץ ב־`<iframe>` עם CSP מוגבל.

## ענפים ורכבות

- רק טל ממזג ל־`main`. לא דוחפים ל־`main`, ולא משתמשים ב־`--force`.
- כל PR מבוסס על **הרכבת הנוכחית** (ה־`verify/train-N` עם המספר הגבוה ביותר)
  או על `main`, ולא על ענף של PR אחר. ‏`npm run pr:check` נכשל על בסיס אחר ועל
  ערימה עמוקה מ־1. ראו [כל PR על ראש הרכבת](docs/src/content/docs/he/contributing/train-base.md)
  ו־[הרכבת השבועית](docs/src/content/docs/he/contributing/train.md).
- שמות ענפים: `feat/<תחום>-<תיאור>`, ‏`fix/<תיאור>`, ‏`chore/<תיאור>`, ‏`docs/<תיאור>`.

## קומיטים

Conventional Commits, ו־**`[skip ci]` בכל כותרת**. כל דחיפה עולה build
ב־Vercel, ולכן דוחפים ענף פעם אחת, כשהוא גמור.

```text
feat(editor): שינוי כיוון פסקה ב־Mod+Shift+X [skip ci]
fix(sync): ...
```

תחומים: `editor`, ‏`renderer`, ‏`collab`, ‏`storage`, ‏`sync`, ‏`ui`, ‏`ai`, ‏`i18n`,
‏`plugins`, ‏`security`, ‏`docs` וכן הלאה.

## לפני ה־PR

GitHub Actions לא רצים על PR. הבדיקות רצות אצלך, ואחר כך ב־Buildkite:

```bash
npm run ci:local -- --changed      # מה שה־diff יכול לשבור: typecheck, ‏lint, ‏i18n, בדיקות, build
npm run ci:local -- --install-hook # ה־pre-push הזה לא מותקן מעצמו (הוא מריץ את הבדיקות בכל push); כך מצטרפים אליו, או git config lumen.ciLocalHook true לפני npm install
```

ואז את בדיקת ה־PR, עם גוף ה־PR כקובץ:

```bash
npm run build
npm run pr:check -- --base origin/verify/train-N --body pr-body.md --build-base --out pr-check.md
```

גוף ה־PR צריך את חמשת הסעיפים האלה, באנגלית ובדיוק בשמות האלה (‏`pr:check`
בודק):

```markdown
## What and why
## Definition of done (plan 0.7)
## Local verification
## Not verified here
## Owner commands
```

מה ש־`pr:check` מכשיל, ומה רק מזהיר: [בדיקת ה־PR](docs/src/content/docs/he/contributing/pr-check.md).
בקצרה, הוא מכשיל:
- קומיט בלי `[skip ci]`;
- בסיס שאינו הרכבת או `main`;
- בקשת רשת חדשה שלא רשומה ביומן הפרטיות;
- חבילה עם רישיון copyleft או בלי רישיון;
- תקציב שהורם;
- קובץ רגיש (קריפטו, כתיבה לכספת, CSP, הרשאות) בלי סקירה אנושית.

**התווית `human-reviewed` היא מילה של אדם שקרא את ה־diff.** סוכן AI לא מוסיף
אותה ולא מבקש שיוסיפו אותה בלי סקירה. PR שנכתב בידי סוכן מקבל את התווית
`ai-written`.

## בדיקות

- בדיקות יחידה: `src/__tests__/<module>.test.ts`, ב־Vitest. ‏`npm run test`
  (פעם אחת) או `npm run test:watch`.
- e2e: ‏`e2e/*.spec.ts`, ב־Playwright.
- **כל תיקון מגיע עם בדיקה שנכשלת לפני השינוי.**
- בדיקה לא מוכיחה דבר אם היא בודקת mock במקום הנתיב האמיתי.
- סט נתונים שכתבת בעצמך מסומן "סינתטי". לא מציגים אותו כנתונים אמיתיים.
- לא מרפים שער, תקציב, baseline או תקרה. מותר רק להחמיר.
- בדיקה ויזואלית: `npm run preview:visual` (כל המסכים, עברית ואנגלית, כהה
  ובהיר), ו־`npm run test:visual` מול ה־baselines.

## תרגום (i18n)

1. מוסיפים את המפתח ל־`src/i18n/locales/en/<domain>.json` ול־`src/i18n/locales/he/<domain>.json`.
2. ‏`npm run i18n:fix`, ואז `node scripts/generate-all-locales.mjs` לשאר השפות.
3. ‏`npm run i18n:check` ו־`npm run test`. השער `i18nDrift.test.ts` נכשל על מפתח חסר.

‏`npm run i18n:hardcoded` מכשיל אנגלית שנשארה ב־JSX או ב־`aria-label`. משפט
עם תגיות בתוכו משתמש ב־`tRich()`. חריג אמיתי מקבל `// i18n-allow: <סיבה>`.
על Weblate ועל טיוטות תרגום: [תרגומים](docs/src/content/docs/he/contributing/translations.md).

## סגנון קוד

- ‏`log.info()` / `log.warn()` / `log.error()` מ־`src/lib/logger.ts`, אף פעם לא
  `console.*` ישיר.
- ‏`randomId()` מ־`src/lib/cryptoRandom.ts`, אף פעם לא `Math.random()` למזהים.
- ‏`catch` ריק צריך הערת `// why: …`.
- ‏`npm run lint` משתמש ב־`eslint-suppressions.json` כ־baseline. כשמתקנים
  הפרה רשומה, מריצים `npm run lint:prune` ומגישים baseline קטן יותר. לא
  מוסיפים לו.
- קובץ ייצור חדש שאף אחד לא מייבא נכשל (`npm run unused`).

## תוספים

תוסף מממש את `LumenPlugin` (`src/plugins/pluginSystem.ts`) ומייצא
`activate(api)`. תוסף שמופץ לציבור נחתם ב־Ed25519 (`src/plugins/signing.ts`).
עוד: [פיתוח תוסף](docs/src/content/docs/he/plugins/develop.md).

## אבטחה

חולשה מדווחים בפרטיות, לא ב־issue פתוח: [SECURITY.md](SECURITY.md).

## שאלות

פותחים דיון (Discussions) או מגיבים על ה־issue הרלוונטי.

תרומה ל־Lumen מתפרסמת תחת [רישיון MIT](LICENSE) של הפרויקט.
