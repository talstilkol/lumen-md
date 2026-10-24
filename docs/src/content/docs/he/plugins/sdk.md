---
title: ערכת פיתוח לתוספים
description: בניית תוסף ללומן עם create-lumen-plugin — מניפסט, קובץ JavaScript אחד וחבילה שאפשר להתקין או לחתום.
---

לתוסף של לומן יש שלושה חלקים:

- מניפסט, `lumen-plugin.json`
- קובץ JavaScript אחד שרץ בארגז החול של לומן
- קובץ חבילה, `.lumenplugin.json`, שמשתמשים מתקינים

אין שלב בנייה ואין framework.

```bash
npx create-lumen-plugin my-plugin
cd my-plugin
npm run pack        # → dist/<id>-<version>.lumenplugin.json
```

כדי לנסות, פתחו בלומן **תוספים** ← **התקנה מקובץ…**, בחרו את החבילה וסמנו את ההרשאות שהיא צריכה.

במניפסט בקשו רק את מה שהתוסף צריך. המשתמש רואה כל יכולת עם הנימוק שלכם, וכל אחת מתחילה לא מסומנת. הקוד הוא מודול ES שרץ ב-QuickJS: אין בו `fetch`, DOM או `import`, ופאנלים הם עצים של רכיבים שלומן מצייר.

`npm run pack:signed` חותם את החבילה במפתח Ed25519 שלכם.

פרטים נוספים: [ממשק התוספים](/he/plugins/api/) ו[ארגז החול והרשאות](/he/plugins/sandbox/).
