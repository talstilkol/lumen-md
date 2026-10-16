<div dir="rtl">

# Lumen — סטטוס תוכניות מאוחד

> **מקור אמת יחיד לסטטוס הביצוע** · עודכן 2026-10-16 · ענף `feat/plans-completion`
>
> מסמך זה מחליף ~15 מסמכי סטטוס/תוכנית ישנים (הועברו ל-[`docs/archive/plans-2026-04/`](docs/archive/plans-2026-04/README.md)).
> התוכניות החיות: [`MASTER_PLAN_NUMBER_ONE.md`](MASTER_PLAN_NUMBER_ONE.md) (מפת פיצ'רים), [`TASKS.md`](TASKS.md) (צ'קליסט שלבים), [`docs/audit/LAUNCH-READINESS-2026-05-26.md`](docs/audit/LAUNCH-READINESS-2026-05-26.md) (חסמי השקה).

## 1. תמונת מצב

| מדד | לפני (2026-10-15) | אחרי (2026-10-16) |
|---|---|---|
| בדיקות יחידה (vitest) | 1360 / 1360 | **2072 / 2072** |
| בדיקות e2e (Chromium, build ייצור + CSP/Trusted Types אכוף) | לא הורץ | **74 / 74** + בדיקת הפרות CSP חדשה (0 הפרות) |
| e2e ב-CI (chromium / webkit / firefox + build ייצור) | — | **כולם ✅** — Firefox: ‏103 עברו, 0 flaky (בדיקת pixel אחת מוגבלת ל-Chromium בכוונה) |
| `tsc --noEmit` | נקי | נקי |
| `as any` / `console.log` בקוד ייצור | 6 / — | **0 / 0** (שער `npm run hygiene` ב-CI) |
| main bundle (gzip) | 151 KB | 168 KB / תקציב 195 KB — כל החלקים בתקציב |
| פגיעויות npm (קריטי / גבוה) | 5 / 32 | **0 / 5** (5 הנותרות: שרשרת כלי build בפיתוח בלבד — [פירוט](docs/audit/DEPENDENCY-AUDIT-2026-10.md)) |
| TASKS.md | 241 בוצעו · 145 חסומים | **245 בוצעו · 141 חסומים חיצונית · 0 פתוחים** |

~126 commits · ~275 קבצים · ‎+30K / ‎−5.9K שורות.

## 2. באגים שתוקנו

| # | באג | תיקון |
|---|---|---|
| 1 | שרת ה-signaling לא דיבר בפרוטוקול y-webrtc — עמיתים לעולם לא היו מתחברים דרך `signal.lumen.md` | `sync-server/server.js` נכתב מחדש: subscribe / unsubscribe / publish / ping, תואם לשרת הייחוס; פרוטוקול `join` הישן נשמר |
| 2 | ה-heartbeat ניתק **כל** חיבור אחרי 30–60 שניות (`isAlive` לא התאפס ב-pong) | תוקן + בדיקה שמוכיחה שלקוח פעיל שורד |
| 3 | הצפנת חדר בסיסמה: לולאת הצפנה אינסופית (256 קריאות מהקשה אחת) **וגם** הטקסט הגלוי סונכרן לכל העמיתים | עיצוב E2E אמיתי: המסמך הגלוי מקומי בלבד, ברשת עובר רק מסמך תעבורה עם מעטפות AES-GCM; סיסמה שגויה → שום דבר לא מוחל + הודעה |
| 4 | CSP חסם את ספקי ה-AI (Anthropic/Gemini/Mistral/Ollama), Google Drive, GitHub gist והורדת מודל ה-AI המקומי (ברירת המחדל!) | CSP אחיד ב-4 קבצים + בדיקה שמוודאת התאמה לכל כתובת ספק בקוד |
| 5 | Trusted Types נאכף בכותרות אבל קוד הציב מחרוזות גולמיות — היה זורק שגיאות ב-Cloudflare/Netlify | מדיניות `lumen` + `default` שמסננות ב-DOMPurify; אומת בדפדפן אמיתי: 0 הפרות |
| 6 | Leaflet CSS ו-model-viewer נטענו מ-unpkg (חסום ב-CSP) | נארזים מקומית, נטענים בעצלות |
| 7 | שרת collab קבוע שמר נתונים **מחוץ** ל-volume (אובדן נתונים ב-recreate); נתיבי health לא תאמו | `YJS_STORAGE_DIR` / `LEVELDB_PATH`, `/health` + `/healthz`; טענות "ארכיון Postgres" שקריות הוסרו |
| 8 | seeding של חדר לפי טיימר 400ms (מרוץ) | מבוסס אירוע `synced` + טיימר גיבוי |
| 9 | מרוץ create/destroy ב-Milkdown במעבר מצבים | תור סדרתי עם מוני דור |
| 10 | "תבניות מותקנות מופיעות ב-⌘K" — טענה שקרית | מומש |
| 11 | worker החיוב בלי `GET /entitlements` שהלקוח מצפה לו | נוסף + בדיקות |
| 12 | מנתח ה-CSV סיווג "50%" ו-"Team 1" כתאריכים | זיהוי תאריך מחמיר |
| 13 | מחרוזות אנגלית קשיחות ב-`llm.ts` | i18n ב-8 שפות |
| 14 | `SECURITY.md` ותיעוד collab טענו "E2E כברירת מחדל" | נוסח מדויק + מודל איומים |

## 2ב. תיקונים בעקבות סקירות קוד (Codex) ו-CI ב-PR #106

| תחום | בעיה | תיקון |
|---|---|---|
| חיוב | אירועי Stripe מגיעים לא לפי הסדר — `updated` ישן יכול "להחיות" מנוי שבוטל | ה-webhook קורא את מצב המנוי העדכני מ-Stripe לפני שמירה |
| חיוב | כתיבה כושלת ל-Supabase אושרה ל-Stripe (200) — אין ניסיון חוזר | 500 על כשל כתיבה/בדיקה → Stripe מנסה שוב |
| חיוב | Checkout חוזר יצר Customer חדש ומנוי כפול | שימוש חוזר ב-Customer הקיים; חסימת מנוי שני כל עוד הקיים מחייב |
| חיוב | גישה ניתנה לפני תשלום; מחיר/tier מהדפדפן | allowlist מחירים בשרת; גישה רק אחרי `paid` |
| AI | השלמות אוטומטיות "שרפו" מכסה חודשית גם בלי מפתח API | לא נספר פרומפט כשאין ספק זמין |
| ביקורת | יומן הביקורת לארגון תמיד הציג "personal"; אירועים נשמרו בלי ארגון | היקף אחיד (ארגון SSO, אחרת מזהה המשתמש) בקריאה ובכתיבה |
| עורך | הצעות (CriticMarkup) עם טקסט שנראה כמו markup יצרו הצעה כפולה ב-Accept | נדחות כ-untrackable |
| עורך | עיצוב בלוק קוד נכשל בקבצי CRLF | זיהוי גדרות עם `\r` |
| live-js | scope משותף נכתב למסמך הלא נכון אחרי החלפת מסמך | מפתח המסמך עובר עם עץ התצוגה |
| VS Code | קישורי `#כותרת` בתצוגה לא עבדו | קפיצה לכותרת היעד |
| פיתוח | הרצת Lua ראשונה גרמה ל-Vite לטעון מחדש את כל הדף (אובדן עריכות) — נמצא דרך אבחון ב-e2e ושוחזר מקומית | `optimizeDeps.include: ["wasmoon"]` |
| CI | WebKit: הקלדה השאירה טקסט welcome בבלוקים | `fill()` אטומי |
| אבטחה | יומן ביקורת: טוקן משותף בתוך ה-bundle אפשר לזייף/לקרוא אירועים של כל ארגון; הרשאת Team רק ב-UI | ה-worker מאמת את טוקן המשתמש עצמו, גוזר משתמש+ארגון, קריאה רק לאדמין ארגון (תפקיד WorkOS) + תוכנית Team |
| חיוב | רכישת Team ע"י חבר ארגון זיכתה רק אותו | הזכאות נרשמת לארגון; פורטל התשלום רק לרוכש |
| AI | פקודות AI חויבו גם כשבוטלו; בקשת רקע חייבה פקודה אחרת | חיוב רק ברגע השליחה למודל, פעם אחת, לבקשה הנכונה |
| Docker | ה-SPA ב-on-prem לא השתמש בשרתי ה-collab של ה-stack | כתובות signaling/collab עוברות כ-build args |
| i18n | כשל טעינת עברית → טקסט אנגלי בפריסת RTL | נפילה לאנגלית LTR |
| publish | נכס בתיקייה בשם `guide.html/` הפיל את הפרסום; `INDEX.md` יצא `INDEX.html` | דילוג מדווח; תמיד `index.html` |
| VS Code | קישורי `#כותרת` לא מצאו כותרות Setext / עם קישור; בדיקות התוסף לא רצו כלל | עוגנים מאותו pipeline של התצוגה; הבדיקות נכללו ב-vitest |
| CI | Firefox: אין דרייבר GL במכונת CI (`FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS`) | Firefox רץ headed תחת Xvfb עם Mesa — **אומת: ירוק** |

## 3. השלמת תוכניות ופיצ'רים חדשים

| תחום | מה נבנה | מקור בתוכנית |
|---|---|---|
| ייצוא | **PPTX** (OOXML תקני, RTL לעברית, CLI ‏`lumen convert x.md x.pptx`) | MPN1 §2.2 |
| CLI | **`lumen publish <dir> --out <dir>`** — אתר סטטי עם אינדקס וקישורים מתוקנים | MPN1 §6, §10 שלב 3 |
| ייבוא | **Apple iWork** (‏.pages / .numbers / .key — XML ישן + IWA/snappy חדש, בנאמנות חלקית) | MPN1 §2.1 |
| עורך | **מצב הצעות / Track changes** (CriticMarkup, קבל/דחה, רינדור `<ins>/<del>` בתצוגה) | MPN1 §9.1 |
| עורך | **עיצוב קוד עם Prettier** (Shift+Alt+F, מסמך או בלוק; נטען בעצלות) | MPN1 §3.2 |
| שפות חיות | **`live-lua`** (wasmoon ב-Worker, מקומי) · **REPL בין בלוקים** (`live-js shared` + איפוס scope) | MPN1 §3.2 |
| פלטפורמות | **תוסף VS Code** — ‏`packages/vscode-lumen` ("Lumen: Open Preview") | MPN1 §6 |
| ארגונים | **SSO** — ‏`edge-workers/auth` (WorkOS) · **הגדרות ארגון** · ניהול מפתחות חתימת תוספים · הודעות סטטוס אימות + קישורי "למד עוד" | MASTER ε.1, F4.3/F4.4, PI 1.3/1.4/2.4 |
| מנוי | אכיפת יכולות (AI חודשי, collab קבוע, יומן ביקורת) — **פתוח לגמרי ב-self-host** | MASTER β.3.6/β.3.7 |
| עיצוב | **התאמת ערכת נושא** (צבע, גופן, ריווח, 4 presets כולל ניגודיות גבוהה WCAG, ייבוא/ייצוא JSON) | READINESS polish 9 |
| נתונים | **הצעות גרף חכמות** — פרופיל עמודות ודירוג 9 סוגי גרפים עם הסבר | READINESS polish 3 |
| UX | מונה תוצאות חיפוש · היסטוריית פרומפטים ל-AI (↑↓) · "פתח סביבת דוגמה" | READINESS B6, polish 4/5 |
| ביצועים | טקסט נצבע קודם, בלוקים כבדים ו-KaTeX בעצלות, רק אנגלית נטענת מראש | READINESS A7 |
| איכות | השוואת פיקסלים ל-Mermaid · שער hygiene ב-CI · בדיקת הפרות CSP ב-e2e | M6, UPGRADE A.3 |

## 4. מה נותר — חסום חיצונית (לא ניתן לבצע מתוך הקוד)

| נושא | מה צריך ממך | הערכת זמן |
|---|---|---|
| פריסה (web / signaling / collab) | חשבון Fly.io + דומיין (`lumen.md` vs `lumen.app` — להחליט) + DNS | 2–3 שעות |
| ניטור | Sentry DSN | 15 דק' |
| חיוב | Stripe (מוצרים, מפתחות) + Cloudflare (`wrangler deploy`, D1/KV) | 3–4 שעות |
| SSO | חשבון WorkOS + בדיקה חיה | 1–2 שעות |
| AI | מפתח OpenAI לבדיקות תמלול/fine-tune | 30 דק' |
| מובייל | Apple Developer ($99) · Google Play ($25) · `cap add android` · חיבור ShareExtension ב-Xcode | 1–2 ימים |
| הפצה | npm scope ‏`@lumen-md` · Chrome Web Store ($5) · חתימת Tauri · VS Code Marketplace | חצי יום |
| קהילה | repos לרישום תבניות/תוספים · GitHub Discussions · סקירת דוברי שפה (ar/de/fr/ja/ru/zh-CN) · סקירה משפטית PRIVACY/TERMS | מתמשך |
| Dependabot | מיזוג ה-PR הזה ל-`main` (ההתראות נספרות על ענף ברירת המחדל) | 10 דק' |
| יומן ביקורת | ב-worker: ‏`SUPABASE_URL`+`SUPABASE_ANON_KEY` ו/או `SSO_TOKEN_SECRET`; ‏`ENTITLEMENT_URL`; תפקידי admin ב-WorkOS (או `AUDIT_ALLOW_ALL_MEMBERS=1`). `VITE_AUDIT_TOKEN` הוסר | 30 דק' |

## 5. מה נותר — קוד (לא נעשה בסבב הזה, בכוונה או מחוסר זמן)

| פריט | למה לא | הערכה |
|---|---|---|
| ייבוא npm ב-`live-js` דרך esm.sh | **נדחה במכוון** — מחייב פתיחת `script-src` ל-CDN חיצוני (החלשת אבטחה). אפשרי רק כאופציית self-host | 1 יום |
| השלמת קוד / אבחון TS בבלוקים (LSP-lite) | גדול; דורש טעינת TypeScript בעצלות | 3–5 ימים |
| Web Playground ‏(multi-file, JSX) · תצוגה חיה React/Vue/Svelte | גדול | 1–2 שבועות |
| שפות חיות נוספות (webR, ruby.wasm) | משקל ~20–40MB לכל אחת | 1–2 ימים כל אחת |
| Team workspaces · Theme marketplace · פרסום לרשת (`lumen.md/user/doc`) | תלוי בשרת/חשבונות | שבועות |
| מדידת ביצועים מול יעד TTI < 1.5s | Lighthouse לא זמין בסביבה; דורש הרצה על פריסה חיה | 1 שעה אחרי פריסה |
| ייחוס מחבר להצעות (track changes) · הצעות במצב WYSIWYG | CriticMarkup ללא שדה מחבר; Milkdown מחוץ להיקף | 2–3 ימים |
| הצפנת awareness (שמות/סמנים) בחדרי E2E | מתועד כמגבלה | 1 יום |

## 6. מה אומת ואיך

- **אומת בפועל:** typecheck, 2072 בדיקות יחידה, e2e ב-CI בשלושת הדפדפנים + build ייצור, hygiene, build ייצור, תקציב bundle, ו-74 בדיקות e2e ב-Chromium 141 מול build ייצור עם כותרות `public/_headers` (CSP + Trusted Types אכוף) — 0 הפרות.
- **אומת חלקית:** קובצי PPTX נפתחו ב-python-pptx וב-LibreOffice (לא ב-PowerPoint עצמו).
- **לא אומת:** קונטיינרי Docker לא נבנו; שרת collab הקבוע לא הורץ (תלויות אופציונליות); SSO/Stripe לא נבדקו חי; tldraw / תלת-ממד / מפות לא כוסו ב-e2e תחת Trusted Types.

</div>
