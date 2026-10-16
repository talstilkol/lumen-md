# מסמך אפיון תיקונים — אבטחה, יציבות וחשיפה מבוקרת

## 0) סטטוס ביצוע נוכחי
- אחוז השלמה כוללני: **100%**.
- סטטוס משימות:
  - מושלם: שלבים 1, 2, 3, 4, 5, 6, 7, 8 (כולל E2E, ביצועים, commit/rollback).

## 1) רקע
האפליקציה כוללת מספר נקודות ריצה דינמית של תוכן משתמש (HTML/JS/SVG/diagram):
- `LiveJsBlock`
- `HtmlPreviewBlock`
- `MermaidBlock`
- `GraphvizBlock`
- `PlantUMLBlock`
- `LiveSvgBlock`
- `PrintExport`

ביצענו תיקוני Harden קיימים (סניטור SVG/HTML ראשוני, הקטנת הרשאות iframe, והחלפת `eval` ב־`LiveJsBlock`), אבל יש צורך בהמשך החמרה מדויקת כדי להגיע לרמת אמון גבוהה יותר.

## 2) המטרות של מסמך זה
1. להפוך את נקודות הריצה לדטרמיניסטיות ובטוחות יותר.
2. לצמצם משמעותית שטחי תקיפה של XSS/DOM clobbering.
3. להקטין השפעה על ביצועים ויציבות בזמן טעינה ועריכה.
4. להגדיר רשימת משימות רציפה לביצוע, עם סדר, תנאי קבלה ותלות בין המשימות.

## 3) תכנון על (Master Plan)

### שלב A — שיא אבטחה תפעולי (Critical hardening)
מטרת השלב: להקטין סיכון מידי לכללי ביצוע קוד ודאטה.

- להחליף מנגנון סניטור מותאם-ידני במנגנון מוכר ועמיד יותר.
- להוציא `HTML`/`SVG` דרך layer אחיד עם policy ברורה.
- להקטין עוד יותר את זכות הפעולה של sandbox ב־`iframe`.

תלות: אין.  
סיכון אם לא מבוצע: המשך חשיפה ל־XSS דרך markup/attributes פחות צפויים.

### שלב B — בידוד הרצה בקוד JavaScript חי
מטרת השלב: להפוך את `LiveJsBlock` לבטוח ומוגבל באמת.

- להחליף הרצה בתוך `iframe` ל־`Worker` או `Blob` isolate עם message API מינימלי.
- לבטל או לנטרל כל אפשרות side effect עם פונקציות DOM/Timer/Storage לפי צורך.
- לוגים דרך פורמט מובנה בלבד (`{level, parts, ts, runId}`).

תלות: שלב A מומלץ קודם כדי לשמור עקרון defense in depth.

### שלב C — קשיחות ב־Print/Export
מטרת השלב: למנוע injest של תגים/טקסט לא בטוח בעת יצירת חלון הדפסה.

- להפריד בנייה: `<head>` יציב, `<body>` עם text nodes במקום string interpolation.
- לאפשר fallback אם `window.open` נחסם.
- לבנות חלון הדפסה ב־DOM-safe דרך `createElement` במקום מחרוזות כוללות תוכן דינמי.

תלות: מיידי לאחר שלב A.

### שלב D — בדיקות ואימות איכות
מטרת השלב: להקפיד שהשיפורים לא שוברים flow קיים.

- להוסיף בדיקות יחידה למנגנוני sanitize.
- להוסיף test cases קצה לקצה לתרחישי abuse:
  - `<script>` בתוך SVG/HTML
  - `on*` attributes
  - `javascript:` ב־href/src
  - מקורות HTML ארוכים ו-UTF edge cases
- לבנות לפחות שני smoke tests להרצת JS/HTML מול קלט תקין.

תלות: לאחר A–C.

### שלב E — ביצועים ונראות מקצועית
מטרת השלב: לשמור יציבות זמן אמת.

- cache לפי hash של source עבור Mermaid/Graphviz/PlantUML.
- lazy-render עקבי לכל blocks.
- ריסון rerenders דרך memoization סביב props שקשורים ל־source/meta.

תלות: אחרי השלמת תרחישי אבטחה כדי לא לערבב שינויים.

## 4) רשימת משימות ברצף (Task list)

1. **איחוד כלל sanitizer**  
   - [x] ליצור `HtmlSanitizer` מוגדר עם allowlist strict דרך ספרייה ייעודית (מועדף DOMPurify).  
   - [x] להחליף שימושים בשכבת `markupSanitizer.ts` במקום קוד סינון פר פרויקט.  
   - [x] לוודא שכל קלט שמוזן ל־`dangerouslySetInnerHTML` עובר דרך אותה שכבה.

2. **Hardening של `HtmlPreviewBlock`**  
   - [x] להפוך את `sandbox` מינימלי עוד יותר (רק capabilities נחוצים).  
   - [x] להוסיף בדיקת מקור/מסנן `srcDoc` לפני ריצה (למשל `sanitizeHtmlMarkup` + מחסור בפעולות form/action).  
   - [x] להוסיף `csp` מותאם בתוך ה־iframe עם default-src מוגבל.

3. **עדכון `LiveJsBlock` ל־Worker Isolation**  
   - [x] לבנות Worker מרנדרינג מינימלי שמקבל קוד בלבד.  
   - [x] להעביר לוגים דרך message בלבד ולצמצם APIs חשופים.  
   - [x] להגדיר timeout/abort לכל run.

4. **חיזוק PrintExport**  
   - [x] לשמר נראות באמצעות template סטטי ומלא.  
   - [x] להציב title/content רק דרך `textContent`/`innerHTML` על אלמנטים מוגנים.  
   - [x] להוסיף fallback למצב חסימת popups.

5. **ניתוח רישיות והצלחה**  
   - [x] להגדיר סטטוס הצלחה לכל block: pass/fail + fallback message.  
   - [x] logging מבוקר בעת sanitize-fail/abort.

6. **בדיקות אבטחה פונקציונליות**  
   - [x] Unit tests: 20–30 cases לפחות לסניטיזציה.  
   - [x] Integration tests ל־5 סוגי blocks לפחות כולל path של טעויות (שכבות בסיסיות נוספו, כולל LiveSvg/HtmlPreview/PlantUML/Graphviz/Mermaid).  
   - [x] E2E קצר לאותו user workflow שמופיע עכשיו באפליקציה.

7. **ביצועים ואופטימיזציה**  
   - [x] cache ל־SVG outputs לפי hash תיעודי של source.  
   - [x] להוסיף מדדי זמן ריצה מינימליים לתחנות קריטיות.

8. **ניתוק והפצה**  
   - [x] commit מסודר לכל שלב עם סכמת rollback פשוטה.  
   - [x] עדכון דוח שינוי קצר בפורמט release notes.

## 5) סדר ביצוע מומלץ (סופי)
1. שלב A (כללי sanitizer)  
2. שלב B (LiveJs isolation)  
3. שלב C (Print/Export)  
4. שלב D (בדיקות)  
5. שלב E (ביצועים)  

## 6) קריטריוני קבלה מינימליים
- אין שימוש בפונקציות אקראיות בלתי שמיות (כולל `Math.random()` — כבר אסור לפי ההנחיות).  
- אין מצב שבו קלט משתמש נכנס ל־DOM ללא sanitization/escaping מתועד.  
- תרחישי ניצול מוכרים מבוססים בהצלחה (no script execution via markup fields).  
- פונקציונליות קיימת (preview/print/blocks) נשמרת עם שינוי מינימלי לחוויית משתמש.  

## 7) נקודות פתוחות שחשוב להחליט
- יושם: `HtmlPreviewBlock` פועל כברירת־מחדל בלי `allow-scripts` עם אפשרות הפעלה מפורשת למשתמש במצב מסוכן בלבד.
- יושם: הודעות אזהרה בעת sanitize/חסימת תוכן חשוד מוצגות בתוך בלוק ה־preview.
- יושם: `PrintExport` כולל fallback עובד כאשר `window.open` נחסם (fallback in-place עם ניקוי אוטומטי).
