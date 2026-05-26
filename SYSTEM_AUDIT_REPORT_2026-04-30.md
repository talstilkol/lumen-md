# דוח ביקורת מערכת מקיף — Lumen MD Editor
**תאריך:** 2026-04-30 | **ציון כללי: 72/100**

## 1. סיכום
- Build נשבר: 7 שגיאות TS ב-5 קבצים.
- 1,095 בדיקות עוברות, 10 נכשלות. חלקן זיהום בין סוויטים.
- חורים אבטחה ב-markupSanitizer ו-urlSanitizer.
- 6 locales מלאים, 4 extra keys בכל אחד.
- 146 משימות חסומות על credentials חיצוניים.

## 2. ציונים
| תחום | ציון |
|---|---|
| Build / TypeScript | **30/100** |
| בדיקות יחידה | **82/100** |
| אבטחת תוכן | **65/100** |
| Editor / Plugins | **78/100** |
| i18n | **75/100** |
| AI / Transcribe | **78/100** |
| סנכרון / Publish | **70/100** |
| Collab / Yjs | **72/100** |
| Native / Mobile | **40/100** |
| QA / CI | **75/100** |
| פרודקשן | **60/100** |

## 3. באגים קריטיים (C)

### C1 — 7 שגיאות TypeScript
| קובץ | שורה | שגיאה |
|---|---|---|
| `src/__tests__/a11y.test.tsx` | 61 | TS2352: globalThis cast לא חוקי |
| `src/__tests__/collabYjs.test.ts` | 206 | TS2307: y-websocket חסר כ-devDependency |
| `src/lib/fetchRetry.ts` | 58 | TS6133: parseText לא בשימוש |
| `src/lib/fetchRetry.ts` | 96,128 | TS2339: cleanup לא קיים על never |
| `src/lib/markupSanitizer.ts` | 120 | TS2503: Cannot find namespace DOMPurify |
| `src/plugins/LiveJsBlock.tsx` | 175 | TS2345: level undefined לא מתאים |

### C2 — configHealth.ts:457 — runtime crash פוטנציאלי
```typescript
const explicit = readEnvVar("VITE_PUBLISH_MOCK_ENABLED");
if (["1","true","yes"].includes(explicit.toLowerCase())) return true;
```
- אם readEnvVar יחזיר undefined בעתיד — קריסה.

## 4. באגים גבוהים (H)

### H1 — markupSanitizer.ts — 3 חורים אבטחה
1. javascript: ב-style — regex `/url\(\s*['"]?\s*javascript:/` דורש url( לפני javascript:. הקלט `<div style="background:url(javascript:alert(1))">` עובר.
2. xlink:href ב-SVG — DOMPurify מסיר attribute אך משאיר תגית `<a>` חשופה.
3. button onclick — תגית `<button>` נמחקת לחלוטין במקום להסיר רק event handler.

### H2 — urlSanitizer.ts — דוחה SVG data URLs חוקיים
- regex `^data:image\/(?:svg\+xml|...)` לא תופס `data:image/svg+xml;base64,...`.

### H3 — Collab seed timer — לא דטרמיניסטי
```typescript
// src/collab/yjs.ts:293
setTimeout(() => { ... }, 400);
```
- Seed מוכנס אחרי timeout במקום לאירוע sync. ברשת איטית עלול להכניס תוכן על תוכן קיים.

## 5. באגים בינוניים (M)

### M1 — Test Pollution
- fineTune.test.ts, transcribe.test.ts, i18nDrift.test.ts — עוברות בנפרד, נכשלות בריצה מלאה.
- סיבה: vi.stubGlobal/fetch או useAppStore.setState אינם מנוקים בין suites.

### M2 — dynamicBlocks.integration.test.tsx — 4 כשלים
- PlantUML failure path — text matcher לא מוצא מחרוזת מדויקת.
- Mermaid — "Rendered in" לא נמצא (ייתכן שהשתנה ל-"Rendered").
- LiveSvg — getByText(/SVG/i) מוצא מרובה אלמנטים.
- Graphviz — צפי 0 התקבל 1 (mock מופעל פעמיים).

### M3 — warnings act() רבים
- TemplateGallery, GraphView, TagsPanel, BacklinksPanel, CommandPalette — state updates חסרי act() wrapping.

## 6. באגים נמוכים (L)
- L1: 4 extra keys בכל locale (findReplace.find, findReplace.matchCase, mdTable.cancel, writingGoal.label) — בתוך threshold של 10.
- L2: as any אחד ב-production: src/storage/vault.ts:116.
- L3: warning jsdom --localstorage-file — סביבתי בלבד.

## 7. המלצות שיפור

### אבטחה
1. הרחב regex style ב-markupSanitizer לתפוס url(javascript:) ללא גרשיים.
2. הוסף hook שמסיר תגית <a> ב-SVG אם href/xlink:href מכיל javascript:.
3. תקן urlSanitizer regex ל-svg+xml base64.

### Build
4. תקן 7 שגיאות TS לפי סדר: markupSanitizer → fetchRetry → LiveJsBlock → a11y.test → collabYjs.test.

### בדיקות
5. פתור זיהום בין סוויטים: הוסף afterEach עם vi.unstubAllGlobals() ו-reset store.
6. הוסף y-websocket כ-devDependency או mock פנימי.
7. תקן text matchers ב-dynamicBlocks (getAllByText / queryByText).

### Collab
8. החלף seed timer ב-event driven (provider.on('sync', ...)).

### CI
9. הוסף audit שבועי אוטומטי: grep Math.random, console.*, TODO, as any ב-production code.

## 8. תכנית תיקונים מדורגת

| שלב | משך | משימות | שער מעבר |
|---|---|---|---|
| 1 — Unblock Build | 0.5 יום | תיקון 7 שגיאות TS | typecheck = 0 errors |
| 2 — אבטחה | 1 יום | markupSanitizer + urlSanitizer + בדיקות | tests pass |
| 3 — QA ניקוי | 1 יום | test pollution + act() warnings + dynamicBlocks | כל 1,105 tests pass |
| 4 — Hardening | 1 יום | collab seed + configHealth guard + extra keys | 0 warnings |
| 5 — חסימות חיצוניות | N/A | credentials (Stripe, Apple, Google, OpenAI) | משימות תפעוליות |

## 9. נספח — מדדים טכניים
- קבצי מקור: ~318 ב-src/
- קבצי בדיקה: 134 suites, 1,105 tests
- Coverage: 97.24%
- npm audit: 0 vulnerabilities
- Math.random ב-production: 0 (cryptoRandom.ts לגיטימי)
- console.* ב-production: 0 (רק ב-logger.ts)
- as any ב-production: 1 (vault.ts:116)
