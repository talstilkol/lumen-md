---
title: מערכת העיצוב
description: האסימונים של Lumen לצבע, ריווח, רדיוס, טיפוגרפיה, הגבהה ותנועה, הכללים שהקוד עומד בהם, והרכיבים המשותפים.
---

כל משטח ב-Lumen נבנה מאותה קבוצת אסימונים (tokens). הם משתני CSS
ב-‎`src/index.css`‎, כך שמצב כהה, ערכות הנושא (הגדרות ← ערכת נושא) ו*הפחתת
תנועה* משנים אותם במקום אחד. סגנונות בתוך הקוד משתמשים בהם דרך
‎`src/ui/tokens.ts`‎.

## אסימונים

| קבוצה | אסימונים | שימוש |
|---|---|---|
| משטחים וטקסט | ‏`--bg`, ‏`--bg-subtle`, ‏`--bg-muted`, ‏`--bg-inset`, ‏`--fg`, ‏`--fg-subtle`, ‏`--fg-muted`, ‏`--border`, ‏`--border-strong`, ‏`--accent`, ‏`--accent-fg` | שלשות HSL: ‏`hsl(var(--bg))`, ‏`hsl(var(--accent) / 0.15)` |
| מצב | ‏`--danger`, ‏`--success`, ‏`--warning`, ‏`--info` | שגיאות ופעולות הרסניות, אישורים, אזהרות, מידע; מותאמים לבהיר ולכהה |
| מעברי צבע | ‏`--gradient-brand`, ‏`--gradient-ai`, ‏`--gradient-success` | הלוגו, כפתור ה-AI, התקדמות — לקישוט בלבד |
| מאחורי חלון | ‏`--overlay` | הרקע של כל דו-שיח |
| הגבהה | ‏`--shadow-sm`, ‏`--shadow-md`, ‏`--shadow-lg`, ‏`--shadow-xl`, ‏`--shadow-accent` | תגים, חלונות קופצים, תפריטים, דו-שיחים; זוהר בצבע ההדגשה |
| ריווח | ‏`--space-1` … ‏`--space-8` (צעדים של 4px) | ריפוד ומרווחים |
| רדיוס | ‏`--radius-sm` ‏4, ‏`--radius-md` ‏6, ‏`--radius-lg` ‏10, ‏`--radius-full` | |
| טקסט | ‏`--text-xs` ‏11 … ‏`--text-xl` ‏18px | |
| תנועה | ‏`--duration-fast` ‏100ms, ‏`--duration-base` ‏250ms, ‏`--duration-slow` ‏350ms; ‏`--ease-out`, ‏`--ease-in-out` | תפריטים וריחוף; דו-שיחים והודעות; חלוניות |

ב-TypeScript: ‏`color.danger`, ‏`color.tint("danger", 0.1)`, ‏`shadow.lg`,
‏`transition(["opacity"], "base")`, ‏`enter("cmdSlideIn")`. ‏`<canvas>` לא
קורא `var()`: מציירים עם `resolvedColor("fg", 0.15)`.

## כללים

1. **אין צבע קשיח בממשק** — לא hex, לא `rgb()` ולא `hsl()` עם מספרים, לא
   ב-‎`src/ui`‎ ולא בתיקיות האחרות שמציירות חלונות, חלוניות ובלוקים
   (‏`COLOR_SCOPE` ב-‎`scripts/check-design.mjs`‎: כניסה, סנכרון, גיבוי,
   משימות, תצוגות, תוספים ועוד). צבעים שאדם בוחר לתוכן שלו (צבעי הפתקים
   בלוח הציור) הם תוכן, וכך גם קוד QR, שנשאר שחור על לבן בשביל המצלמה;
   שניהם מסומנים ‎`design-allow`‎.
2. **רק `transform` ו-`opacity` זזים**, בשלושת המשכים. שום דבר לא מנפיש
   רוחב, גובה, ‏top/left או שוליים: פס התקדמות משתנה בקנה מידה
   (‎`transform: scaleX()`‎), תפריט מחליק (`translateY`), ריחוף משנה צבע מיד.
3. **הפחתת תנועה מכובדת בכל מקום**: כשההגדרה של המערכת פעילה, אסימוני
   המשך הופכים ל-0, וכלל כללי עוצר כל הנפשה שנשארה.
4. **צדדים לוגיים**: ‏`marginInlineStart`, ‏`insetInlineEnd`, ‏`textAlign:
   "start"` — משטח מתהפך בעברית מעצמו. קואורדינטות מסך מ-
   ‎`getBoundingClientRect()`‎ נשארות פיזיות.
5. **רקע של חלון הוא `var(--overlay)`; צל הוא דרגה בסולם.**

‏`npm run design:check` מריץ את שני השערים: ‏‎`scripts/check-design.mjs`‎
(כלל 1 על תיקיות הממשק, כלל 2 על כל `src/ui`, ואף הנפשת פריסה בכל `src`)
ו-‎`scripts/design-audit.mjs`‎, שמריץ את רשימת הביקורת (כללים 1, 2, 4, 5) על
43 המשטחים שב-‎`scripts/design-surfaces.json`‎. שם בלי תיקייה הוא
‎`src/ui/<name>.tsx`‎; שם עם תיקייה, כמו ‎`sync/cloud/ConflictDialog`‎, הוא
משטח מחוץ ל-‎`src/ui`‎. חריג אמיתי מסומן בקוד
‎`design-allow: <סיבה>`‎.

## ספריית הרכיבים

<!-- machine translation of the English section; needs a native review -->

לפני שכותבים משטח חדש, בונים אותו מהחלקים האלה. כל שורה נותנת את הייצוא ואת
הקובץ שלו; ‏‎`src/__tests__/designLibrary.test.ts`‎ נכשל כששורה נותנת משהו
שלא מיוצא שם, וכשרכיב שמשטחים רבים מייבאים חסר בטבלה.

| רכיב | ייבוא | בשביל מה | מה מקבלים |
|---|---|---|---|
| ‏`Modal` | ‏‎`src/ui/Modal.tsx`‎ | כל חלון מודאלי | ‏`<dialog>` מקורי בשכבה העליונה; שאר הדף לא פעיל; Tab נשאר בפנים; Escape (ותנועת החזרה באנדרואיד) קורא ל-`onClose`; המיקוד חוזר למי שפתח; ‏`closedBy="none"` בזמן עבודה; ‏`embedded` ללשונית בתוך משטח אחר. צריך `aria-label` או `aria-labelledby`. רק הוא רשאי לקבוע `aria-modal` (כלל ה-lint ‏`lumen/modal-only`) |
| ‏`uiAlert`, ‏`uiConfirm`, ‏`uiPrompt`, ‏`uiSelect` | ‏‎`src/ui/PromptDialog.tsx`‎ | כל שאלה, אישור וקלט קצר | מבוססי promise ‏(`await uiConfirm({ message })`), בנויים על `Modal`; ‏`password: true` לסוד, ‏`choices` לרשימה. אף פעם לא `window.confirm` / `prompt` |
| ‏`EmptyState` | ‏‎`src/ui/EmptyState.tsx`‎ | חלונית שאין בה כלום | משפט אחד למה היא ריקה ופעולה אחת חובה שיוצאת מזה (`runCommand(id)`, ‏`learnHow(topic)`); ‏`role="status"`. ‏‎`scripts/check-empty-states.mjs`‎ מכשיל מחרוזת ריקה שמוצגת בלעדיו |
| ‏`HelpButton`, ‏`openHelp` | ‏‎`src/ui/HelpButton.tsx`‎ | ה-״?״ ליד הגדרה או כותרת חלונית | פותח את העזרה שבאפליקציה על נושא; ‏`openHelp(topic)` מהקוד |
| ‏`showAiToast` | ‏‎`src/ui/AiToast.tsx`‎ | הודעה קצרה שלא צריכה תשובה | ‏`info` / `success` / `error`; פעולה אחת אופציונלית (ביטול) ו-`learnMoreUrl`; שגיאות מוקראות מיד (`role="alert"`), השאר בנימוס (`role="status"`) |
| ‏`ErrorBoundary` | ‏‎`src/ui/ErrorBoundary.tsx`‎ | סביב משטח שיכול להיכשל לבד | מציג את ה-`fallback` שלו, או כברירת מחדל את פעולות ההתאוששות (`ErrorActions`), במקום מסך לבן |
| ‏`CommandPalette`, ‏`Command` | ‏‎`src/ui/CommandPalette.tsx`‎ | כל פעולה שיש באפליקציה | פעולה היא קודם פקודה (מזהה, כותרת, קיצור); תפריטים וכפתורים קוראים לאותה פקודה |
| ‏`cmdIcons` | ‏‎`src/ui/cmdIcons.ts`‎ | הסמל של פקודה | סמל אחד לכל פקודה, זהה בפלטה, בתפריטים ובסרגל |
| ‏`useFocusTrap` | ‏‎`src/ui/useFocusTrap.ts`‎ | משטח לא מודאלי שעדיין מחזיק מיקוד (חלון קופץ) | Tab מסתובב בפנים, Escape, החזרת מיקוד; ‏`Modal` כבר משתמש בו |
| ‏`color`, ‏`shadow`, ‏`space`, ‏`radius`, ‏`text`, ‏`transition`, ‏`enter`, ‏`resolvedColor` | ‏‎`src/ui/tokens.ts`‎ | סגנונות בתוך הקוד | הטוקנים שלמעלה ב-TypeScript; ‏`transition()` מקבל רק `transform` ו-`opacity` |
| ‏`.icon-btn` | ‏‎`src/index.css`‎ | כפתור סרגל או חלונית עם סמל בלבד | הריחוף, טבעת המיקוד והגודל של כל כפתור סמל; תנו לו `aria-label` |
| ‏`.cmd-palette-backdrop`, ‏`.cmd-palette` | ‏‎`src/ui/CommandPalette.css`‎ | המסגרת של חלונית גדולה (סל המחזור, רופא ה-AI) | צבע הרקע, ההגבהה ותנועת הכניסה של הפלטה |
| ‏`toast` | ‏‎`src/store/useToastStore.ts`‎ | הודעה מ-store או ממודול שאינו React | אותן הודעות כמו `showAiToast`, דרך ה-store |

### שימוש יחד

```tsx
import { Modal } from "../ui/Modal";
import { EmptyState, runCommand } from "../ui/EmptyState";
import { HelpButton } from "../ui/HelpButton";
import { uiConfirm } from "../ui/PromptDialog";
import { color, space } from "../ui/tokens";

<Modal aria-labelledby="trash-title" onClose={close}>
  <h2 id="trash-title">{t("trash.title")} <HelpButton topic="trash" /></h2>
  {items.length === 0 ? (
    <EmptyState message={t("trash.empty")} action={{ label: t("trash.openFiles"), onClick: () => runCommand("files.open") }} />
  ) : (
    <ul style={{ padding: space[3], color: color.fg }}>…</ul>
  )}
  <button className="icon-btn" aria-label={t("trash.emptyAll")} onClick={async () => (await uiConfirm({ message: t("trash.confirmEmpty") })) && emptyAll()} />
</Modal>
```


רכיב משותף חדש מקבל כאן שורה, באנגלית ובעברית, באותו שינוי.
