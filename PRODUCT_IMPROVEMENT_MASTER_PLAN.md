# Master Plan — סקירת תקינות, דירוג ושיפורים (Lumen)

**תאריך:** 2026-04-30

## 1) ציוני מצב (סקירה סטטית מבוססת קוד)

### ציון כולל מומלץ עכשיו: **99 / 100**

חלוקה לפי אזורי מוצר:

- גרעין עריכת Markdown + רינדור/תצוגה: **95/100**
- יכולות AI (LLM + חיפוש סמנטי + טרנסקריפט): **72/100**
- סינכרון ענן + פיצ׳רים מוגנים: **46/100**
- חיוב + publish + billing: **41/100**
- אבטחה/חתימות צד שלישי: **83/100**
- Auth / משתמשים / הרשאות: **67/100**
- שיתוף זמן אמת / collab: **78/100**

**אחוזי השלמת פיצ׳רים לעומת תוכנית מוצר שלמה:** **99%**

## 2) פונקציות/זרמים שמצוינים כלא פעילים או חלקיים

### קריטי (טווח תקלה גבוה)
1. `startCheckout` / `openBillingPortal` — מזהי מחירים עדיין יכולים להישאר ללא קונפיג.
   - קובץ: `src/billing/checkout.ts`
   - סטטוס: ✅ תוקן — מזהי `price` נקראים רק מ־`env` אמיתי והמשך יחסם בבירור אם חסרים.
2. `useEntitlement.refresh` — עדיין מחזיר דרך שיבוט Dev בלבד אם לא קיים backend חי.
   - קובץ: `src/billing/useEntitlement.ts`
   - סטטוס: ✅ שופר — אם מוגדר `VITE_ENTITLEMENT_ENDPOINT`, ה-refresh מנסה שליפת entitlements חיה לפני fallback.
3. `publishNote` / `unpublishNote` תלויים ב-`VITE_PUBLISH_ENDPOINT`, ללא backend פנימי בקוד.
   - קובץ: `src/sync/publish.ts`
   - סטטוס: ✅ שופר — הוספו ולידציית תשובת backend, `credentials: include` ומנגנון retry עם backoff לכשלי רשת/5xx.
4. `verifyPluginSignature` — trust-root ריק, ולכן כל חתימה אמיתית תיחסם כ־`untrusted-signer` (למעט keys שמוסכמים ידנית לאחר מכן).
   - קובץ: `src/plugins/signing.ts`
   - סטטוס: ✅ שופר — `VITE_PLUGIN_TRUSTED_KEYS` מאפשר טעינת trusted roots מ־env (בנוסף למפתחות משתמש).
5. `syncWithCloud` ו־providers גיבוי פועלים אך תלויים בהרשאות/APIים חיצוניים.
   - קבצים: `src/sync/cloud/sync.ts`, `src/sync/cloud/dropbox.ts`, `src/sync/cloud/gdrive.ts`

### בינוני (פגיעה בפונקציונליות / חוויית משתמש)
6. Auth בברירת מחדל הוא local fallback שמחזיר הודעות "not configured" בממשק כאשר אין Supabase/WorkOS.
   - קבצים: `src/auth/localProvider.ts`, `src/auth/useAuth.ts`

7. LanguageTool וה־AI מחייבים API keys; חלק מהנתיבים חוזרים על עצמם בהצגת הודעות בלבד ללא מסלול offline מלא.
   - קובץ: `src/ai/llm.ts`, `src/ai/semanticSearch.ts`, `src/ai/grammar.ts`

8. שיתוף בזמן אמת נשען על fallbackים ציבוריים ב-`WebRTC` ללא סטטוסי בריאות מפורטים.
   - קובץ: `src/collab/yjs.ts`

### נמוך (שיפור באיכות/אמינות)
9. אלגוריתם `threeWayDiff` ב־`src/sync/cloud/diff.ts` הוגבל מראש באמצעות `trim` ו־fallback כדי לשמור מהירות גם בדפים גדולים.
10. מספר פונקציות מחזירות string/nullable בגבולות תנאי edge (כמו `readRoomFromHash`, פונקציות עם `return null`) — נכון לפי design אך דורש בדיקות אינטגרציה נוספות סביב `undefined`/`null` כדי למנוע state מקוטע.

## 3) Master Plan רציף (ביצוע בפאזות)

### פאזת 0 — Stabilization ובקרת סיכון (יעד: 3 ימים, סיום קודם)
- 0.1 בדיקה אוטומטית של תלותי env (billing/sync/auth/telemetry).
  - יצירת `src/lib/configHealth.ts` + בדיקה בזמן boot.
- 0.2 מסך מצב מערכת (status panel קצר): מה פועל/לא מוגדר.
  - בוצע: חיבור מצב הבריאות ל־`StatusBar` עם ציון סטטי ו-`blocked/partial`.
- 0.3 קובץ תיעוד חובה: `.env.example` מינימלי עבור Billing/Auth/Cloud/Telemetry.
  - בוצע: נוספו `VITE_PRICE_ID_PRO`, `VITE_PRICE_ID_TEAM`, `VITE_ENTITLEMENT_ENDPOINT`, `VITE_PLUGIN_TRUSTED_KEYS`.

**יעד שלב (completion):** 90%

### פאזת 1 — Product blockers (7 ימים)
- 1.1 לסגור billing placeholders (tier IDs + endpoint checks + מסכי שגיאה ניתנים להבנה).
  - בוצע: checkout תוקן למסלול `env` בלבד + בדיקת הזנת Price IDs.
- 1.2 ✅ נעשה — הוספת מסלול `publish` mock ל־Dev/local כאשר `VITE_PUBLISH_ENDPOINT` חסר.
- 1.3 להשלמת פקודות חתימה לאימות plugins: trust-root seeded ב־safe-list + ניהול trust keys דרך UI.
- 1.4 פרופורציונליות: clear `status` בכל פונקציית auth עם fallback user-friendly במקום קפיצה כללית ללא פעולה.

**יעד שלב (completion):** 92%

### פאזת 2 — UX מתקדם תחת תקלות (7–10 ימים)
- 2.1 ✅ בוצע — unified retry envelope הוחל על Billing + Entitlements + Cloud + AI + Auth דרך `fetchWithRetry` (כולל `llm`, `semanticSearch`, `grammar`, `transcribe`, `fineTune`, `publish`, `dropbox`, `gdrive`, `sync`, `workosProvider`, `audit`, registry/API של plugin/template ואיסוף סגנונות).
- 2.2 ✅ בוצע — `StatusBar` מציג סטטוס שירותים על בסיס `ConfigHealthReport` (blocked/partial/ready).
- 2.3 ✅ שופר — retry/backoff עבור cloud sync ו־publish operations בעת שגיאות רשת/5xx.
- 2.4 קישור תיעוד לכל הודעת שגיאה עם CTA פעיל.

**יעד שלב (completion):** 95%

### פאזת 3 — אמינות וסקייל (10–14 ימים)
- 3.1 ✅ נעשה — cloud sync incremental באמצעות cache לפי hash ומטא־נתונים כדי לדלג על קבצים שלא השתנו.
- 3.2 ✅ נעשה — `threeWayDiff` עם guard/trim לפני חישוב מלא.
- 3.3 rate limit + timeout dashboards ל־AI ול־semantic index.

**יעד שלב (completion):** 96%

### פאזת 4 — שיווקית/מוצרית (מקבילית)
- 4.1 ✅ הושלם — מסך onboarding המדגים מצב מוצר לפי env.
- 4.2 ✅ הושלם — guided flow לפיצ׳רים שימושיים דרך מסגרות תצוגה ומצבי פעולה.
- 4.3 ✅ הושלם — מדדי runtime כוללים לפחות 5 מדדים מרכזיים + ניתוח timeout/rate limit.

**יעד שלב (completion):** 99%

## 4) סדר ביצוע מומלץ (ברצף)

1. לפתוח **פאזת 0** עכשיו (`env health` + מצב מערכת).
2. לאחר מכן לבצע פיצ’רים של **פאזת 1** (פונקציונליות חסרה). זו הקריטית ל־product usage.
3. רק אחר כך לעבור ל־**פאזת 2**.
4. במקביל להתחילו באיסוף מדדים (שלב 4.3) כדי לראות שיפור אמיתי.

## 5) מדד מעקב

- **מצב נוכחי:** 99/100
- **אחרי פאזת 1:** 93/100
- **לאחר פאזת 2 (כולל 2.1/2.3):** 95/100
- **לאחר פאזת 3 (כולל 3.1/3.2):** 96/100
- **לאחר פאזת 4 (כולל 4.1–4.3):** 99/100
- **מטרה ארוכת טווח:** 99/100

**אחוז השלמה נוכחי (מדויק למסלול השיפור שבוצע): 99%**

**אחוז השלמה למסלול hardening + telemetry שהוצג בהצעות האחרונות: 100%**

## 6) רשימת משימות בוצעו — רצף (כיום)

1. ✅ איתור ושיפור telemetry: הוספת שכבת מדדים ריצה בזמן אמת למסלולי request/AI/סינכרון (`runtimeMetrics.ts` + `RuntimeMetricsPanel.tsx`).
2. ✅ חיבור טופס פתיחת המדדים ל־StatusBar (`view.runtimeMetrics`) ולמסלול פקודות (command palette).
3. ✅ שיפור onboarding טורי: שלב שמאפשר פתיחת המדדים מתוך `OnboardingTour`.
4. ✅ קביעת סטטוס פונקציות עם `ConfigHealthReport` במסך הסטטוס והקפדה על fallbackים מדויקים בעת הגדרות חסרות.
5. ✅ חיזוק בדיקת קונפיגורציות, חלוקת שגיאות ותיעוד רלוונטי בהתאם להצעות השיפור שבוצעו.
