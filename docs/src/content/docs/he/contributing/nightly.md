---
title: ריצות לילה וקבלות
description: npm run nightly מריץ את ציד ה-flakes, בדיקות הביצועים, מיון הביקורות ובריאות התלויות השבועית על המחשב שלך, וכותב לכל אחד דוח חתום, בלי GitHub Actions.
type: how-to
---

Lumen לא משתמש ב-GitHub Actions, ולכן הריצות המתוזמנות (משימה 0.11)
והמדידות שתלויות בהן רצות על המחשב של בעל הפרויקט:

- 0.5: שלושה לילות בלי בדיקה לא יציבה
- 0.14: כמה כישלונות ב-build של preview הרצה מקומית של `ci:local` הייתה
  תופסת

פקודה אחת עושה את זה:

```bash
npm run nightly                  # what is due today
npm run nightly -- --dry-run     # print the plan, run nothing
```

| סוג | מתי | מה רץ |
|---|---|---|
| `flake` | כל לילה | `npm run e2e:flake -- --all --times 5` (chromium, firefox, webkit, חמש ריצות לכל אחד, בלי retries) |
| `perf` | כל לילה | build, תקציב החבילה, פרויקט הביצועים `@nightly`, ומגמת Lighthouse: מחשב ונייד, החציון של 3 ריצות לכל אחד, שנוסף ל-`reports/trend/lighthouse-history.json` ול-`lighthouse-trend.md`. רץ רק `lhci collect`, כך ששום דבר לא מועלה |
| `triage` | כל לילה | מיון הביקורות של ה-PR-ים הפתוחים, הספירה של 0.14 על 20 ה-PR-ים הראשונים מאז 12.11.2026, ‏`live:meta --self-test` ובדיקת הסחיפה של ה-rulesets (שניהם למטה) |
| `weekly` | בימי ראשון (UTC) | בריאות התלויות (audit, outdated, רישיונות), וציוני mutation: בענף שיש בו `scripts/mutation/check.mjs`, המודולים הקריטיים ב-vitest אמיתי (`run.mjs --critical --receipt --min 80`, ואחריו `mutation:check`), ואחרת `test:mutation` |
| `fuzz` | כל לילה | ‏`npm run fuzz:redaction`: [ה-fuzz של ההשחרה](/he/contributing/redaction-fuzz/) עם הזרע של הלילה, 20,000 מקרים. דליפה מכשילה את הצעד ונשמרת ב-`tests/fuzz/redaction/regressions.json`. הדוח החתום שומר את הלילה ואת מספרי המקרים, הדליפות והשמורות. לא נספר ב-0.11. |
| `sr` | כל לילה, ב-Mac שבו `@guidepup/*` מותקנים | ‏`npx @guidepup/setup --ci`, ואז המסע העברי עם VoiceOver ([קוראי מסך, אוטומטית](/he/editor/screen-reader-automation/)). לא נספר ב-0.11. |
| `supply` | כל לילה, במחשב שמותקנים בו `scorecard`, ‏`osv-scanner`, ‏`cargo-deny` או `syft` | בדיקות שרשרת האספקה ([בהמשך](#בדיקות-שרשרת-האספקה-משימה-w11s5)). לא נספר ב-0.11. |

`--only flake,perf` בוחר סוגים. המתזמן מעביר `--scheduled`, שמסמן את הדוחות
כמתוזמנים. משימה 0.11 סופרת רק אותם.

## דוחות וקבלות

כל סוג כותב `reports/nightly/<date>-<kind>.json`. הדוח מתעד:

- את הקומיט, והאם העץ היה נקי
- את המחשב: מערכת הפעלה, Node ומספר הליבות, בלי שם המחשב
- כל פקודה עם קוד היציאה והמשך שלה
- את ה-sha256 של הפלט של כל פקודה, עם השורות האחרונות שלו
- את המספרים של הסוג: בדיקות לא יציבות ובדיקות שתמיד נכשלות בכל דפדפן,
  הערות הביצועים, סיכומי הביקורות ומספרי ה-audit

הדוח **חתום**. יש בו ה-sha256 שלו וחתימת Ed25519, שנעשית במפתח שלא יוצא אף
פעם מהמחשב (`~/.config/lumen-md/nightly-ed25519.pem`, הרשאות 0600, נוצר
בריצה הראשונה; `LUMEN_NIGHTLY_KEY` משנה את הנתיב). החצי הציבורי שלו נשמר
בריפו כ-`reports/nightly/PUBLIC_KEY.pem`. כל אחד יכול לבדוק דוח ששמור בריפו:

```bash
npm run nightly -- --verify reports/nightly/2026-11-13-flake.json
```

אם מספר כלשהו בדוח השתנה אחרי הריצה, גם ה-digest וגם החתימה נכשלים.

`reports/nightly/status.json` (גם הוא חתום) מחושב מחדש אחרי כל ריצה
(`npm run nightly -- --status` עושה רק את זה). הוא מתעד:

- **0.5**: כמה לילות רצופים היו, שבכל אחד מהם כל דפדפן רץ חמש פעמים בלי
  בדיקה לא יציבה ובלי בדיקה שתמיד נכשלת (צריך 3)
- **0.11**: אילו מארבעת הסוגים הפיקו דוח מתוזמן (צריך את כל ה-4)
- **0.14**: ב-20 ה-PR-ים הראשונים שנפתחו מאז 12.11.2026, הקומיטים שה-build
  של ה-preview שלהם ב-**Vercel** נכשל. ה-build של ה-preview מריץ חלק
  מ-`ci:local`, אז כל כישלון כזה הוא כישלון ש-`ci:local` היה תופס, חוץ
  מ-`docs:sync`, ש-`ci:local` לא מריץ. ענפי האינטגרציה `verify/*` לא
  נספרים.
- **W6.16**: כמה שבועות רצופים הייתה ריצה שבועית מתוזמנת שבה כל מודול קריטי
  קיבל לפחות 80 ב-vitest אמיתי (לא ב-shim הלא מקוון), ובדיקת הקבלה עברה (צריך
  4). הדוח השבועי כולל לכל מודול את הציון ואת ה-sha256 של המקור ושל הבדיקות,
  כך שהדוח החתום הוא הקבלה. אחרי הריצה הקובץ `scripts/mutation/receipt.json`
  חוזר לגרסה שבקומיט, כדי שאפשר יהיה למשוך לעותק בלי תקלות.

`--commit` שומר את `reports/nightly/` בקומיט עם הודעה שכוללת `[skip ci]`. הוא
אף פעם לא דוחף. קומיט שמשנה רק את `reports/` לא מתחיל build ב-Vercel
(`scripts/vercel-ignore.sh`), כך שהקבלות לא מבזבזות את מכסת הפריסות.

## תזמון ב-Mac (launchd)

משתמשים בעותק של הריפו ששמור רק לריצת הלילה, על ענף משלו, כך שריצה אף פעם
לא מתערבבת בעבודה שלך:

```bash
git clone https://github.com/talstilkol/lumen-md ~/lumen-nightly
cd ~/lumen-nightly && git switch -c nightly/receipts && npm ci && npx playwright install
```

אחר כך מתקינים את המתזמן בפקודה אחת. ב-Mac היא כותבת וטוענת את משימת launchd, ובלינוקס היא מוסיפה שורת cron אחת בין שני סימונים:

```bash
npm run nightly:install                  # כל לילה ב-02:17
npm run nightly:install -- --at 03:41    # שעה אחרת
npm run nightly:install -- --print       # מה היא הייתה מתקינה
npm run nightly:install -- --uninstall
```

התבניות הן `scripts/nightly/launchd.plist` ו-`scripts/nightly/crontab`. ב-Mac היא מתקינה את `~/Library/LaunchAgents/dev.lumen-md.nightly.plist`, כך:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.lumen-md.nightly</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>cd ~/lumen-nightly &amp;&amp; git pull -q --rebase origin main &amp;&amp; npm ci --silent &amp;&amp; npm run nightly -- --scheduled --commit</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>17</integer></dict>
  <key>StandardOutPath</key><string>/tmp/lumen-nightly.log</string>
  <key>StandardErrorPath</key><string>/tmp/lumen-nightly.log</string>
</dict>
</plist>
```

launchd מריץ משימה שהוחמצה בזמן שה-Mac ישן ברגע שהוא מתעורר. כדי לפרסם את
הקבלות, דוחפים את הענף (`git push origin nightly/receipts`) או פותחים ממנו
PR. בלינוקס שורת ה-cron היא:

```text
17 2 * * * cd ~/lumen-nightly && git pull -q --rebase origin main && npm ci --silent && npm run nightly -- --scheduled --commit
```

## למה לא Vercel Cron או משימה מתוזמנת בענן

- **Vercel Cron** רק קורא לפונקציה של פריסה לפי לוח זמנים. הוא לא יכול
  להריץ שלושה דפדפנים חמש פעמים על כל חבילת ה-e2e, והוא היה מבזבז את מכסת
  הפריסות המשותפת.
- **משימה מתוזמנת של Claude Code** פותחת סשן חדש בענן. בסשן הזה אין
  דפדפנים ואי אפשר להתקין חבילות, אז הוא יכול להריץ רק את הסוג `triage`
  (REST API של GitHub) ולקרוא את הקבלות ששמורות בריפו. זה שימושי לסיכום
  בוקר, לא למדידות עצמן.

## בדיקות שרשרת האספקה (משימה W11.S5)

‏Scorecard ו-CodeQL קיימים בריפו רק כקובצי YAML של GitHub Actions, ולכן אף
אחד מהם לא רץ אף פעם. ‏`scripts/supply/nightly.mjs` מריץ את בדיקות שרשרת
האספקה במחשב של ריצת הלילה במקומם:

| בדיקה | פקודה | צריך |
|---|---|---|
| ‏Scorecard | `scorecard --repo=github.com/talstilkol/lumen-md --format json` | רשת ו-`GITHUB_AUTH_TOKEN`, טוקן fine-grained עם הרשאת קריאה בלבד |
| ‏OSV | `osv-scanner scan source` על `package-lock.json`, ‏`mcp-server/package-lock.json` ו-`src-tauri/Cargo.lock` | רשת |
| ‏cargo deny | `cargo-deny check advisories bans` ב-`src-tauri` | רשת (מאגר RustSec) |
| ‏SBOM | `syft dir:. -o cyclonedx-json` | כלום |

```bash
npm run supply:nightly                 # מה שמותקן; קבלה חתומה → reports/nightly/<date>-supply.json
npm run supply:nightly -- --dry-run    # שום דבר לא רץ, בלי רשת; הקבלה אומרת למה כל בדיקה דולגה
npm run supply:nightly -- --open-tasks # וגם issue ב-GitHub לכל משימה חדשה
```

בתוך `npm run nightly`, הסוג `supply` מריץ את הסקריפט וחותם את התוצאות בדוח
של אותו לילה, תחת `supply`.

בקבלה נמצאים השערים של W11.M8. בדיקה שדולגה משאירה את השערים שלה **לא
נמדדים**, ואף פעם לא עוברים:

- הציון הכולל של Scorecard הוא לפחות 7.0;
- ‏Branch-Protection לפחות 8, ‏Code-Review לפחות 8, ו-Dangerous-Workflow
  הוא 10;
- ‏OSV מוצא 0 פגיעויות critical.

**משימה** נרשמת בקבלה, ונפתחת כ-issue עם `--open-tasks`, כאשר:

- הציון הכולל של Scorecard נמוך מזה שבקבלה הקודמת;
- בדיקה עם שער נמצאת מתחת לרף שלה;
- ‏OSV מוצא פגיעות critical או high;
- ‏cargo deny מדווח על שגיאה.

לכל משימה יש מפתח קבוע, כך שממצא שעדיין קיים בלילה הבא לא פותח issue שני.

השחרור כבר כולל SBOM משלו בפורמט CycloneDX ‏(`release/sbom.cdx.json`,
[שרשרת אספקה](/he/security/supply-chain/)). ה-SBOM של `syft` בריצת הלילה הוא
רשימה שנייה ובלתי תלויה של אותו עץ.

## בדיקת המטא-דאטה החיה (משימה W6.2)

`npm run live:meta` מוריד מהייצור את `index.html`, ‏`robots.txt` ו-`sitemap.xml`,
ונכשל אם אחד מאלה לא מצביע על `lumen-md.vercel.app`: הקישור ה-canonical,
‏`og:url`, ‏`og:image`, ‏`twitter:image`, כל כתובת ב-JSON-LD, שורת ה-`Sitemap:`
וכל `<loc>` במפת האתר. הוא נכשל גם אם הדומיין שאינו של הפרויקט מופיע בהם
במקום כלשהו. את התבנית של הדומיין הזה בונים מחלקים ב-`scripts/lib/liveMeta.mjs`,
כמו בשער ה-PR, כך שהיא לא כתובה בריפו.

```bash
npm run live:meta                                   # הייצור, אחרי כל פריסה
npm run live:meta -- --url https://<deployment>.vercel.app
npm run live:meta -- --dir dist                     # בנייה, לפני שפורסים אותה
npm run live:meta -- --self-test --json live-meta.json
```

`--self-test` בודק קודם עותק נקי של הדפים. אחר כך הוא שותל הפניה זרה בכל
מקום (canonical, ‏`og:image`, ‏`og:url` למארח אחר, טקסט בגוף הדף, `Sitemap:`,
‏`<loc>`), ונכשל אם הבדיקה פספסה אחת מהן.

מריצים אותה **אחרי כל פריסה לייצור**: ישיבת המיזוג של הבעלים מריצה אותה מיד
אחרי הקידום. בכל לילה הסוג `triage` מריץ אותה גם כן, כך שסטייה מתגלה תוך
יום. הפקודה יוצאת עם 1 על כל בעיה. היא מורידה עם Node, ואם זה לא עובד עוברת
ל-`curl`, שמכבד את `HTTPS_PROXY`.

## ה-rulesets של GitHub‏ (W11.S4)

אין כאן GitHub Actions, ולכן רק GitHub עצמו יכול לעצור דחיפה ל-`main` או מיזוג
בלי ביקורת. הכללים ל-`main` ול-`verify/*` הם קוד, בקובץ
`security/github-ruleset.json`:

- PR עם אישור אחד, כולל אישור של הדחיפה האחרונה;
- אישורים ישנים מבוטלים, ובעלי הקוד חייבים לבדוק;
- אין force push ואין מחיקה;
- קומיטים חתומים;
- הסטטוסים `Vercel` ו-`lumen/buildkite`.

תפקיד ה-admin יכול לעקוף רק דרך PR, כך שכל עקיפה נרשמת.

```bash
npm run security:ruleset-drift                         # השוואה ל-gh api repos/talstilkol/lumen-md/rulesets
node scripts/security/ruleset-drift.mjs --print-apply  # פקודות ה-gh של הבעלים שיוצרות אותם (W10.O1)
```

הסקריפט בודק את הקובץ מול `security/github-ruleset.schema.json` (גוף ה-REST של
GitHub ל-ruleset) ומול המדיניות שלמעלה, ואז מדווח על כל הבדל ממה שיש ב-GitHub.
הוא יוצא עם 1 כשיש סחיפה, ועם 2 כשאי אפשר לקרוא את ה-API, וזה אף פעם לא נחשב
התאמה. הסוג `triage` מריץ אותו בכל לילה.

## כשריצה אדומה: ci-doctor מקומי (R12.12)

הכול רץ במחשב הזה, מהלוג של ריצה מקומית או של רכבת, בלי GitHub Actions ובלי רשת.

| פקודה | מה היא עושה |
|---|---|
| ‏`npm run ci:filter -- run -- <cmd…>` | מריצה פקודה ומדפיסה סיכום קצר, ולעולם לא חותכת שורת שגיאה. הפלט המלא נשמר 7 ימים ב-`.ci-doctor/`, ואפשר לשלוף אותו עם `npm run ci:filter -- expand <id> --grep RE`. |
| ‏`npm run ci:sig -- red.log` | נותנת חתימה לכל כשל: מפתח של 12 ספרות שנבנה משם הבדיקה, מראש השגיאה ומפריים המחסנית הראשון בקוד של הריפו, כולם מוסווים. נתיבים, זמנים, מזהים וצבעים לא משנים את המפתח; שגיאה אחרת משנה. הכשלים מקובצים לסוגים בעזרת Drain. |
| ‏`npm run ci:kedb -- red.log` | מתאימה כל כשל למאגר השגיאות הידועות `scripts/ci-doctor/kedb.json`: סיבה, סוג (env / code / flaky) ועקיפה. מידת העצמאות של runbook ‏(suggest ← ask ← auto) מחושבת מהתוצאות שנרשמו לו, ברווח Wilson. היא לא נכתבת ביד, וכשל אחד בשלוש הריצות האחרונות מוריד אותו מ-`auto`. |
| ‏`npm run ci:flake -- rerun <קובץ בדיקה> --times 3` | מריצה את הקובץ לבד שוב ושוב, רושמת כל ריצה ומסווגת: אמיתי, flaky, בידוד (עובר לבד ונכשל בריצה המלאה) או לא ידוע. ‏`CI_DOCTOR_RUNNER` קובע את המריץ שיש במחשב; ברירת המחדל היא `npx vitest run {file}`. |
| ‏`npm run ci:flake -- add <קובץ> --test NAME --reason TEXT` | מכניסה בדיקה להסגר. הבקשה נדחית אם ההיסטוריה לא מראה שהבדיקה flaky, וההסגר פג תוך 14 יום לכל היותר. ‏`ci:flake -- check` יוצאת עם 1 כשיש רשומה שפגה או לא תקינה. אף שער עוד לא קורא את ההסגר (W10.M12). |
| ‏`npm run ci:culprit -- --good <sha> --bad <sha> --log red.log -- npx vitest run {files}` | מריצה `git bisect` ב-worktree זמני, רק על הקבצים שנכשלו בלוג האדום. עם `--first-parent` (ברירת המחדל) היא מחזירה את המיזוג ברכבת ואת ה-PR שלו; עם `--all` היא מחזירה את הקומיט עצמו. ה-checkout שלכם לא נוגע. |
