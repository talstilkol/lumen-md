---
title: גוזר הרשת (Web Clipper)
description: לשמור דף אינטרנט כפתק Markdown נקי — מתוך Lumen (עובד היום), או מתוסף הדפדפן (עדיין גרסת מפתחים).
---

## גזירה מתוך Lumen

שתי פקודות שומרות דף בכספת כפתק נקי, עם המקור והתאריך ב-front matter:

- `⌘K → Clip a web page…` — מדביקים כתובת; Lumen מביאה את הדף ושומרת את
  המאמר (`<article>` / `<main>`), בלי ניווט, פרסומות, טפסים וסקריפטים.
  הבאת אתר כלשהו דורשת את שירות המחקר ([מחקר](/he/ai/research/)); בלעדיו
  אפשר לגזור רק אתרים שמדיניות האבטחה של האפליקציה כבר מתירה, ו-Lumen אומרת
  זאת.
- `⌘K → Clip from clipboard` — קודם מעתיקים משהו מהדף; ה-HTML (או הטקסט)
  שהועתק הופך לפתק.

הגזירים נכנסים לתיקייה **ספרייה** (**Library** כשהממשק באנגלית), מקבלים
מספר כשהשם תפוס, ונפתחים בלשונית חדשה.

```yaml
---
title: "How CRDTs Work"
source: "https://martin.kleppmann.com/2020/07/06/crdt-hard-parts.html"
clipped: 2026-04-26
---
```

## תוסף הדפדפן (גרסת מפתחים)

בתיקייה `extension/` יש תוסף Chrome קטן (Manifest V3): כפתור **Save to
Lumen** בסרגל הכלים ופריט **Save selection to Lumen** בתפריט הלחצן הימני.
הוא ממיר ל-Markdown את הבחירה, או את המאמר של הדף.

:::caution[הוא עדיין לא שומר לכספת]
התוסף שולח כל גזיר ל-`<כתובת ה-Lumen שלכם>/api/clip`, וכשזה נכשל הוא פותח
את `<כתובת ה-Lumen שלכם>/#clip=…`. **אף בנייה של Lumen עדיין לא עונה לאף
אחד מהם**, ולכן גזיר מהתוסף לא מגיע לכספת. השתמשו בפקודות שלמעלה עד שזה
יעבוד.
:::

כדי לנסות במצב מפתחים:

```bash
git clone https://github.com/talstilkol/lumen-md
cd lumen-md/extension
```

1. ‏`chrome://extensions/` ← מפעילים **Developer mode**
2. **Load unpacked** ← בוחרים את `lumen-md/extension/`
3. בעמוד **Options** של התוסף מגדירים את כתובת ה-Lumen שלכם (ברירת המחדל
   היא `http://localhost:5173`).

## פרטיות

הפקודות שבתוך האפליקציה מביאות רק את הדף שביקשתם (דרך שירות המחקר כשהוא
מוגדר). התוסף לא שולח שום בקשה מלבד לכתובת ה-Lumen שהגדרתם: בלי מעקב ובלי
טלמטריה. המניפסט שלו הוא
[`extension/manifest.json`](https://github.com/talstilkol/lumen-md/blob/main/extension/manifest.json).
