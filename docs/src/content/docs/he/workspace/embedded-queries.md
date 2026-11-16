---
title: שאילתות מוטמעות וחיפושים שמורים
description: בלוק ‎```query‎ מציג את הפתקים שמתאימים לחיפוש, בלוק ‎```dataview‎ מריץ שאילתות Dataview נפוצות של Obsidian, וחיפושים שמורים יושבים בסרגל הצד. כולם מתעדכנים כשהכספת משתנה.
---

## בלוקים מסוג query

כותבים חיפוש בבלוק `query`, והתצוגה המקדימה מציגה את הפתקים שמתאימים לו,
ומתעדכנת כששומרים פתקים:

````markdown
```query
tag:project -tag:done
view: table
sort: modified desc
limit: 20
```
````

החיפוש משתמש באותם [אופרטורים](/he/workspace/search-operators/) כמו חלון
החיפוש: מילים, `tag:`,‏ `path:`,‏ `"ביטוי מדויק"`,‏ `/regex/` ו-`-מילה` כדי
להוציא פתקים. שורות בצורה `option: value` קובעות איך זה מוצג:

| אפשרות | ערכים | ברירת מחדל |
|---|---|---|
| `view` | ‏`list`,‏ `table` (פתק, תיקייה, שינוי, תגיות) | `list` |
| `sort` | ‏`relevance`,‏ `name`,‏ `path`,‏ `modified` — ואחריהם `asc` או `desc` | `relevance` |
| `limit` | ‏1–500 | 50 |

שורה שמתחילה ב-`//` היא הערה. הפתק שמחזיק את הבלוק לא מופיע בתוצאות שלו.
אפשרות שלא הצלחנו לקרוא מוצגת מעל התוצאות, ולא נבלעת בשקט.

## בלוקים מסוג dataview

כספות שמגיעות מ-Obsidian מלאות בבלוקים של
[Dataview](https://blacksmithgu.github.io/obsidian-dataview/). ‏Lumen מריץ את
החלק הנפוץ של שפת השאילתות שלו, כך שהם מוצגים כאן גם בלי התוסף:

````markdown
```dataview
TABLE status, due FROM #project WHERE status != "done" SORT due ASC
```
````

- **`LIST [expr]`**,‏ **`TABLE [WITHOUT ID] expr [AS "name"], …`** ו-**`TASK`**
  (המשימות `- [ ]` של הפתקים, לקריאה בלבד, עם קישור לכל פתק)
- **`FROM`**‏ `#tag`,‏ `"folder"`,‏ `[[note]]` (פתקים שמקשרים אליו), עם
  `AND`,‏ `OR`,‏ `-` וסוגריים
- אחר כך, לפי סדר הכתיבה: **`WHERE`** השוואות (`= != < > <= >=`), ‏`and` /
  `or` / `!`,‏ `+ - * /`; ‏**`SORT`** שדה אחד או יותר, `ASC` / `DESC`;
  ‏**`LIMIT`** n; ‏**`GROUP BY`** ביטוי [`AS` שם] (אחריו `key` ו-`rows`);
  ‏**`FLATTEN`** ביטוי [`AS` שם]
- שדות: front matter, שדות בשורה (`key:: value`,‏ `[key:: value]`), ו-
  `file.name`,‏ `file.path`,‏ `file.folder`,‏ `file.link`,‏ `file.mtime`,
  ‏`file.ctime`,‏ `file.day`,‏ `file.size`,‏ `file.tags`,‏ `file.outlinks`,
  ‏`file.tasks`; ‏`this` הוא הפתק שהבלוק נמצא בו
- משימות: `text`,‏ `status`,‏ `completed`,‏ `fullyCompleted`,‏ `checked`,
  ‏`annotated`,‏ `section`,‏ `line`, שדות `[key:: value]` שלהן והתאריכים של
  תוסף Tasks ‏(📅 `due`,‏ ⏳ `scheduled`,‏ 🛫 `start`,‏ ➕ `created`,‏ ✅
  `completion`); למשימה יש גם את השדות של הפתק שלה
- פונקציות: `contains`,‏ `icontains`,‏ `startswith`,‏ `endswith`,‏ `length`,
  ‏`lower`,‏ `upper`,‏ `date(today)`,‏ `dur(7 days)`,‏ `default`,‏ `choice`,
  ‏`round`,‏ `number`,‏ `string`,‏ `join`,‏ `regexmatch`,‏ `dateformat`,‏ `split`,
  ‏`replace`,‏ `substring`,‏ `truncate`,‏ `padleft`,‏ `sum`,‏ `min`,‏ `max`,
  ‏`average`,‏ `reverse`,‏ `sort`,‏ `flat`,‏ `nonnull`,‏ `link`,‏ `meta`,
  ‏`typeof`, ו-`filter`,‏ `map`,‏ `any`,‏ `all`,‏ `none` עם `(x) => …`
- ‏`.days`,‏ `.year`,‏ `.month` … על משך זמן או תאריך:
  ‏`(date(today) - file.day).days`

‏`CALENDAR` ו-DataviewJS לא נתמכים: הבלוק
אומר זאת במקום לנחש. שום דבר בשאילתה לא רץ כקוד — השפה מפוענחת ומפורשת,
ובדיקה מוודאת שאין `eval` בקוד השאילתות.

## גרפים משאילתה

מוסיפים `chart:` לבלוק ‏query או dataview כדי לצייר את השורות שלו:

```query
tag:book
chart: bar
chart-x: folder
```

- ‏`chart:` הוא bar, ‏line, ‏pie, ‏scatter, ‏heatmap או calendar; ‏`chart-x:`,
  ‏`chart-y:`, ‏`chart-series:` ו-`chart-aggregate:` פועלים כמו `x`, ‏`y`,
  ‏`series` ו-`aggregate` בתצוגת גרף של Bases.
- בלוק query מציע את העמודות `name`, ‏`folder`, ‏`tags`, ‏`modified` (יום)
  ו-`path`; ‏`TABLE` של Dataview מציע את הכותרות שלו (`chart-y: pages` אחרי
  `TABLE pages`).
- לגרף יש אותה טבלת נתונים ואותה מקלדת כמו לגרף של Bases.

## פתקי דשבורד

שמים `layout: dashboard` ב-frontmatter של פתק, והבלוקים שלו — בלוקים של query
ו-dataview, קובצי `.base` מוטמעים והגרפים שלהם, משימות, עצי מבנה — מסודרים
ברשת:

```markdown
---
layout: dashboard
dashboard-columns: 2     # לא חובה, 1–6; בלעדיו כמה עמודות שנכנסות
---
## קריאה
![[Books.base#Pages by status]]
```

- כותרות וטקסט תופסים את כל השורה; כל בלוק תופס תא. בעברית הרשת מתחילה מימין.
- בלוקים שגללתם אל מחוץ לתצוגה לא רצים מחדש בכל שמירה; הם מתעדכנים כשחוזרים
  אליהם.
- שום דבר לא נכתב בפתק, ו-Obsidian (שמתעלם מ-`layout`) מציג אותו כפתק רגיל
  עם ההטמעות שלו.

## עדכון חי

שני סוגי הבלוקים רצים מחדש כשפתק נשמר, נמחק או משנה שם. בכספת של 1,000
פתקים ההרצה מחדש אחרי שמירה לוקחת הרבה פחות מ-100ms.

## חיפושים שמורים

בחלון החיפוש, **☆ שמירת החיפוש** שומר את החיפוש. החיפושים השמורים מופיעים
בראש סרגל הקבצים; לחיצה פותחת את החלון שוב על אותו חיפוש, ו-× מסיר אותו.

החיפושים השמורים נשמרים בכספת, בקובץ `.lumen/searches.json`, ולכן הם
מסתנכרנים למכשירים האחרים שלכם יחד עם שאר הכספת. אם שני מכשירים שינו את
הרשימה לפני שסונכרנו, שני השינויים נשמרים: לכל חיפוש, השמירה או ההסרה
האחרונה קובעת. חיפושים שנשמרו בדפדפן הזה לפני השינוי עוברים לכספת פעם
אחת, בפעם הראשונה שפותחים אותה.

**שמירה כ-Base** הופכת חיפוש שבנוי רק מאופרטורי `tag:` ו-`path:` (עם `-`
לשלילה) לקובץ ‎`.base` של Obsidian בתיקייה `Searches/`. זו טבלה שאפשר
להטמיע בכל פתק, למשל בדשבורד, עם `![[name.base]]`. ‏Bases לא מחפש בטקסט
של הפתקים, ולכן חיפוש עם מילים, "ביטויים" או /regex/ נשאר חיפוש שמור.
