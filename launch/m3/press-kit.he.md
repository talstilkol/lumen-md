# ערכת עיתונות (M3, עברית)

> טיוטה לבעלים, שמחליט למי לשלוח. לכל טענה יש קבלה, `[^id]`, מתוך `claims.json`.
> צילומי מסך: הרשימה ב-`launch/press-kit.md`, רק עם פתקים מומצאים.

## משפט אחד

‏Lumen הוא עורך Markdown חינמי בקוד פתוח, שנבנה לעברית ולכתיבה מימין לשמאל, מקומי, עם תוספים בארגז חול.[^mit][^plugin-no-access]

## פסקה אחת

רוב אפליקציות הפתקים מתייחסות לעברית כאל תוספת. ‏Lumen מתחיל ממנה: הכיוון נקבע לכל שורה,[^rtl-per-line] החיפוש מוצא מילה גם עם ניקוד ותחיליות,[^hebrew-search] והממשק מתהפך בעברית ובערבית.[^ui-languages] הפתקים נשארים במכשיר כקובצי Markdown רגילים,[^md-files] לא צריך חשבון, ובהגדרות ברירת המחדל שום דבר לא יוצא מהמכשיר.[^no-account] תוספים רצים בלי שום הרשאה אלא אם המשתמש נותן אותה,[^plugin-no-access] ו-AI יכול לרוץ על המכשיר עצמו.[^local-ai]

## עובדות

- קוד פתוח, רישיון MIT.[^mit]
- עובד בלי אינטרנט כאפליקציית רשת מותקנת;[^offline] יש גם אפליקציה לשולחן העבודה.[^desktop]
- הממשק ב-8 שפות.[^ui-languages]
- הלוגיקה של תוסף רצה ב-QuickJS בתוך Web Worker משלה, בלי fetch, ‏DOM או אחסון.[^plugin-quickjs]
- לכל תוסף ברשימה יש כרטיס סקירה ציבורי עם תווית פרטיות.[^plugin-scorecards]
- הצפנת כספת אופציונלית במנוחה עם AES-256-GCM,[^vault-encryption] ומפתח מסיסמה בעזרת Argon2id.[^argon2id]
- ייבוא מ-Obsidian, ‏Notion, ‏Evernote, ‏Bear, ‏Apple Notes, ‏Google Keep, ‏Logseq ו-OneNote.[^importers]

## מה לומר על אבטחה

- ל-Lumen **לא** נעשתה ביקורת אבטחה חיצונית.[^no-external-audit] נא לא לתאר את ההצפנה שלו כמאושרת או כמוסמכת.[^no-external-audit]
- כל ממצא אבטחה פתוח מופיע בפומבי.[^findings-public]

## שם ולוגו

- השם הוא **Lumen**, באותיות לטיניות, גם בטקסט עברי.
- משתמשים בסמל מ-`public/icons/` כמו שהוא.

## איש קשר

OWNER: כתובת לפניות עיתונאים.

<!-- launch-kit:sources -->

## Sources

[^mit]: Open source under the MIT licence. Receipt: `LICENSE`.
[^plugin-no-access]: Every plugin runs with no access by default. Receipt: `docs/src/content/docs/plugins/sandbox.md`.
[^rtl-per-line]: Direction is set per line, from its first strong letter. Receipt: `docs/src/content/docs/editor/hebrew.md`.
[^hebrew-search]: Search folds niqqud, final letters and the prefix letters. Receipt: `docs/src/content/docs/editor/hebrew.md`.
[^ui-languages]: The interface is in 8 languages, six of them in beta (machine-translated); Hebrew and Arabic mirror the layout. Receipt: `docs/src/content/docs/editor/hebrew.md`.
[^md-files]: Notes are plain Markdown; the whole vault exports as a .zip or a folder. Receipt: `docs/src/content/docs/workspace/export-import.md`.
[^no-account]: No account; with the default settings nothing leaves the device. Receipt: `docs/src/content/docs/security/privacy-report.md`.
[^local-ai]: AI can run entirely on the device (WebGPU), with no per-token cost. Receipt: `docs/src/content/docs/ai/local-llm.md`.
[^offline]: Works offline as an installed web app. Receipt: `docs/src/content/docs/getting-started/install.md`.
[^desktop]: There is a desktop app for macOS, Windows and Linux. Receipt: `docs/src/content/docs/getting-started/desktop-app.md`.
[^plugin-quickjs]: Plugin logic runs in QuickJS, a separate engine in its own Web Worker, with no fetch, DOM or storage. Receipt: `docs/src/content/docs/plugins/sandbox.md`.
[^plugin-scorecards]: Each listed plugin has a public review scorecard with a privacy label. Receipt: `docs/src/content/docs/security/index.md`.
[^vault-encryption]: Optional vault encryption at rest, with AES-256-GCM. Receipt: `docs/src/content/docs/security/vault-encryption.md`.
[^argon2id]: The passphrase key is derived with Argon2id. Receipt: `docs/src/content/docs/security/vault-encryption.md`.
[^importers]: Imports from Obsidian, Notion, Evernote, Bear, Apple Notes, Google Keep, Logseq and OneNote. Receipt: `docs/src/content/docs/workspace/import.md`.
[^no-external-audit]: Lumen has not had an external security audit, so its cryptography must not be called audited. Receipt: `docs/src/content/docs/security/index.md`.
[^findings-public]: Every open security finding is listed in public. Receipt: `docs/src/content/docs/security/index.md`.

<!-- /launch-kit:sources -->
