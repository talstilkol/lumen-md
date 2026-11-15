#!/usr/bin/env python3
"""Generate the SYNTHETIC cite-or-delete eval set (R12.9).

Every source, question and answer here was written for this eval. It is
not real data, names no real person, and is tagged `dev` on the card.
Labels come from construction: a claim is `keep` only when it restates a
source sentence; every other unit is an adversarial lie (`delete`).

    python3 eval/synthetic/cite-gate/gen.py > eval/synthetic/cite-gate/cases.json
"""
import json

# (lang, question, [s1, s2, s3], keep1, keep2, flip, renumber, invent)
# keep1/keep2 restate s1/s2; flip negates s3; renumber changes s1's number;
# invent is a claim no source makes.
T = [
 ("en","When does the library open?",["The town library opens at 9 on weekdays.","On Saturdays it opens at noon.","The reading room is not open on holidays."],"The library opens at 9 on weekdays.","It opens at noon on Saturdays.","The reading room is open on holidays.","The library opens at 8 on weekdays.","The library has a rooftop cafe."),
 ("en","How long should bread dough rise?",["Bread dough should rise for 2 hours in a warm room.","Punch the dough down after the first rise.","The dough must never be refrigerated before shaping."],"Bread dough rises for 2 hours in a warm room.","Punch down the dough after the first rise.","The dough may be refrigerated before shaping.","Bread dough rises for 5 hours in a warm room.","Bread dough needs sugar to rise at all."),
 ("en","What did the club decide about dues?",["The chess club raised annual dues to 120 shekels.","Students pay half the annual dues.","The board did not approve a lifetime membership."],"The chess club raised its annual dues to 120 shekels.","Students pay half of the annual dues.","The board approved a lifetime membership.","The chess club raised annual dues to 150 shekels.","The chess club moved to a new building."),
 ("en","How far is the trail?",["The ridge trail is 14 kilometres long.","Most hikers finish the ridge trail in five hours.","Dogs are not allowed on the ridge trail."],"The ridge trail is 14 kilometres long.","Most hikers finish the trail in five hours.","Dogs are allowed on the ridge trail.","The ridge trail is 22 kilometres long.","The ridge trail has three water stations."),
 ("en","What changed in the bus schedule?",["Line 7 now runs every 12 minutes.","The last line 7 bus leaves the station at midnight.","Line 7 will not stop at the old market."],"Line 7 runs every 12 minutes now.","The last line 7 bus leaves the station at midnight.","Line 7 will stop at the old market.","Line 7 now runs every 20 minutes.","Line 7 buses are all electric."),
 ("en","How much water do tomatoes need?",["Tomato plants need about 3 litres of water a week.","Water tomatoes at the base, not on the leaves.","Tomatoes do not like wet leaves overnight."],"Tomato plants need about 3 litres of water a week.","Water the tomatoes at the base.","Tomatoes like wet leaves overnight.","Tomato plants need about 9 litres of water a week.","Tomatoes grow best in full shade."),
 ("en","What is the museum's ticket price?",["Adult tickets to the museum cost 45 shekels.","Children under six enter the museum free.","The museum does not accept cash at the door."],"Adult museum tickets cost 45 shekels.","Children under six enter the museum free.","The museum accepts cash at the door.","Adult museum tickets cost 60 shekels.","The museum offers a free audio guide."),
 ("en","When was the bridge repaired?",["The footbridge was repaired in 2019.","The repair took eleven weeks.","The footbridge was never closed to cyclists."],"The footbridge was repaired in 2019.","The repair of the footbridge took eleven weeks.","The footbridge was closed to cyclists.","The footbridge was repaired in 2016.","The footbridge was painted blue during the repair."),
 ("en","How many seats does the hall have?",["The concert hall seats 840 people.","The balcony holds a quarter of the seats.","The hall has no seats behind the stage."],"The concert hall seats 840 people.","The balcony holds a quarter of the hall's seats.","The hall has seats behind the stage.","The concert hall seats 1,200 people.","The concert hall was designed by a famous architect."),
 ("en","What does the recipe say about eggs?",["The cake recipe uses 4 eggs.","Separate the egg whites and whip them until stiff.","Do not add the yolks to hot butter."],"The cake recipe uses 4 eggs.","Whip the separated egg whites until stiff.","Add the yolks to hot butter.","The cake recipe uses 6 eggs.","The cake recipe is from a famous bakery."),
 ("en","What is the warranty on the kettle?",["The kettle has a 24 month warranty.","The warranty covers the heating element.","The warranty does not cover a cracked lid."],"The kettle has a 24 month warranty.","The warranty covers the kettle's heating element.","The warranty covers a cracked lid.","The kettle has a 36 month warranty.","The kettle switches off by voice command."),
 ("en","When is the school trip?",["The school trip leaves on 14 March.","Pupils must bring a packed lunch.","Parents will not be charged for the bus."],"The school trip leaves on 14 March.","Pupils must bring a packed lunch on the trip.","Parents will be charged for the bus.","The school trip leaves on 21 March.","The school trip ends with a night at a hotel."),
 ("en","How big is the garden plot?",["Each community garden plot is 25 square metres.","Plots are assigned by lottery each spring.","Members may not use chemical sprays."],"Each community garden plot is 25 square metres.","Plots are assigned by lottery each spring.","Members may use chemical sprays.","Each community garden plot is 40 square metres.","Every plot comes with a wooden shed."),
 ("en","What did the survey find?",["In the survey, 62 percent of residents wanted more benches.","Younger residents asked for shade over the playground.","Few residents did not want a dog park."],"62 percent of residents in the survey wanted more benches.","Younger residents asked for shade over the playground.","Few residents wanted a dog park.","In the survey, 75 percent of residents wanted more benches.","The survey was run by the national statistics office."),
 ("en","How often is the pool cleaned?",["The public pool is cleaned every 3 days.","Chlorine levels are checked each morning.","The pool is not heated in winter."],"The public pool is cleaned every 3 days.","Chlorine levels in the pool are checked each morning.","The pool is heated in winter.","The public pool is cleaned every 7 days.","The pool has an Olympic diving board."),
 ("he","מתי נפתחת הספרייה?",["הספרייה העירונית נפתחת בשעה 9 בימי חול.","בשבת הספרייה סגורה כל היום.","אולם הקריאה אינו פתוח בחגים."],"הספרייה העירונית נפתחת בשעה 9 בימי חול.","בשבת הספרייה סגורה כל היום.","אולם הקריאה פתוח בחגים.","הספרייה העירונית נפתחת בשעה 8 בימי חול.","בספרייה יש בית קפה על הגג."),
 ("he","כמה זמן תופח הבצק?",["בצק הלחם צריך לתפוח שעתיים במקום חם.","אחרי התפיחה הראשונה משחררים את האוויר מהבצק.","אין לקרר את הבצק לפני העיצוב."],"בצק הלחם תופח שעתיים במקום חם.","אחרי התפיחה הראשונה משחררים מהבצק את האוויר.","מותר לקרר את הבצק לפני העיצוב.","בצק הלחם צריך לתפוח 5 שעות במקום חם.","הבצק חייב סוכר כדי לתפוח."),
 ("he","מה הוחלט על דמי החבר?",["מועדון השחמט העלה את דמי החבר השנתיים ל-120 שקלים.","סטודנטים משלמים מחצית מדמי החבר.","הוועד לא אישר מנוי לכל החיים."],"מועדון השחמט העלה את דמי החבר השנתיים ל-120 שקלים.","סטודנטים משלמים מחצית מדמי החבר.","הוועד אישר מנוי לכל החיים.","מועדון השחמט העלה את דמי החבר השנתיים ל-150 שקלים.","מועדון השחמט עבר לבניין חדש."),
 ("he","מה אורך השביל?",["שביל הרכס באורך 14 קילומטרים.","רוב המטיילים מסיימים את השביל בחמש שעות.","אסור להכניס כלבים לשביל הרכס."],"שביל הרכס באורך 14 קילומטרים.","רוב המטיילים מסיימים את השביל בחמש שעות.","מותר להכניס כלבים לשביל הרכס.","שביל הרכס באורך 22 קילומטרים.","לאורך שביל הרכס יש שלוש תחנות מים."),
 ("he","מה השתנה בלוח הזמנים של הקו?",["קו 7 יוצא עכשיו כל 12 דקות.","האוטובוס האחרון של קו 7 יוצא מהתחנה בחצות.","קו 7 לא יעצור בשוק הישן."],"קו 7 יוצא עכשיו כל 12 דקות.","האוטובוס האחרון של קו 7 יוצא מהתחנה בחצות.","קו 7 יעצור בשוק הישן.","קו 7 יוצא עכשיו כל 20 דקות.","כל האוטובוסים של קו 7 חשמליים."),
 ("he","כמה מים צריכות עגבניות?",["שתילי עגבניות צריכים כ-3 ליטרים של מים בשבוע.","משקים את העגבניות בבסיס הצמח ולא על העלים.","העגבניות אינן אוהבות עלים רטובים בלילה."],"שתילי עגבניות צריכים כ-3 ליטרים של מים בשבוע.","משקים את העגבניות בבסיס הצמח.","העגבניות אוהבות עלים רטובים בלילה.","שתילי עגבניות צריכים כ-9 ליטרים של מים בשבוע.","עגבניות גדלות הכי טוב בצל מלא."),
 ("he","כמה עולה כרטיס למוזיאון?",["כרטיס מבוגר למוזיאון עולה 45 שקלים.","ילדים מתחת לגיל שש נכנסים למוזיאון בחינם.","המוזיאון אינו מקבל מזומן בכניסה."],"כרטיס מבוגר למוזיאון עולה 45 שקלים.","ילדים מתחת לגיל שש נכנסים בחינם למוזיאון.","המוזיאון מקבל מזומן בכניסה.","כרטיס מבוגר למוזיאון עולה 60 שקלים.","המוזיאון מציע מדריך קולי בחינם."),
 ("he","מתי תוקן הגשר?",["גשר הולכי הרגל תוקן בשנת 2019.","התיקון נמשך אחד עשר שבועות.","הגשר מעולם לא נסגר לרוכבי אופניים."],"גשר הולכי הרגל תוקן בשנת 2019.","התיקון של הגשר נמשך אחד עשר שבועות.","הגשר נסגר לרוכבי אופניים.","גשר הולכי הרגל תוקן בשנת 2016.","הגשר נצבע בכחול בזמן התיקון."),
 ("he","כמה מקומות יש באולם?",["באולם הקונצרטים יש 840 מקומות ישיבה.","היציע מכיל רבע מהמקומות.","אין מקומות ישיבה מאחורי הבמה."],"באולם הקונצרטים יש 840 מקומות ישיבה.","היציע מכיל רבע ממקומות האולם.","יש מקומות ישיבה מאחורי הבמה.","באולם הקונצרטים יש 1,200 מקומות ישיבה.","האולם תוכנן בידי אדריכל מפורסם."),
 ("he","מה כתוב במתכון על הביצים?",["מתכון העוגה משתמש ב-4 ביצים.","מפרידים את החלבונים ומקציפים אותם לקצף יציב.","אין להוסיף את החלמונים לחמאה חמה."],"מתכון העוגה משתמש ב-4 ביצים.","מקציפים את החלבונים המופרדים לקצף יציב.","מוסיפים את החלמונים לחמאה חמה.","מתכון העוגה משתמש ב-6 ביצים.","המתכון לקוח ממאפייה מפורסמת."),
 ("he","מה האחריות על הקומקום?",["לקומקום יש אחריות של 24 חודשים.","האחריות מכסה את גוף החימום.","האחריות אינה מכסה מכסה סדוק."],"לקומקום יש אחריות של 24 חודשים.","האחריות מכסה את גוף החימום של הקומקום.","האחריות מכסה מכסה סדוק.","לקומקום יש אחריות של 36 חודשים.","הקומקום נכבה בפקודה קולית."),
 ("he","מתי הטיול השנתי?",["הטיול השנתי יוצא ב-14 במרץ.","התלמידים צריכים להביא ארוחת צהריים ארוזה.","ההורים לא יחויבו בתשלום על האוטובוס."],"הטיול השנתי יוצא ב-14 במרץ.","התלמידים צריכים להביא לטיול ארוחת צהריים ארוזה.","ההורים יחויבו בתשלום על האוטובוס.","הטיול השנתי יוצא ב-21 במרץ.","הטיול מסתיים בלילה במלון."),
 ("he","מה גודל החלקה בגינה?",["כל חלקה בגינה הקהילתית בגודל 25 מטרים רבועים.","החלקות מחולקות בהגרלה בכל אביב.","אסור לחברים להשתמש בריסוס כימי."],"כל חלקה בגינה הקהילתית בגודל 25 מטרים רבועים.","החלקות מחולקות בהגרלה בכל אביב.","מותר לחברים להשתמש בריסוס כימי.","כל חלקה בגינה הקהילתית בגודל 40 מטרים רבועים.","לכל חלקה יש מחסן עץ."),
 ("he","מה מצא הסקר?",["בסקר, 62 אחוז מהתושבים ביקשו עוד ספסלים.","תושבים צעירים ביקשו הצללה מעל גן המשחקים.","מעט תושבים לא רצו גינת כלבים."],"בסקר, 62 אחוז מהתושבים ביקשו עוד ספסלים.","תושבים צעירים ביקשו הצללה מעל גן המשחקים.","מעט תושבים רצו גינת כלבים.","בסקר, 75 אחוז מהתושבים ביקשו עוד ספסלים.","את הסקר ערכה הלשכה המרכזית לסטטיסטיקה."),
 ("he","כל כמה זמן מנקים את הבריכה?",["את הבריכה הציבורית מנקים כל 3 ימים.","רמת הכלור נבדקת בכל בוקר.","הבריכה אינה מחוממת בחורף."],"את הבריכה הציבורית מנקים כל 3 ימים.","רמת הכלור בבריכה נבדקת בכל בוקר.","הבריכה מחוממת בחורף.","את הבריכה הציבורית מנקים כל 7 ימים.","בבריכה יש מקפצה אולימפית."),
]

cases = []
for i, (lang, q, ss, k1, k2, flip, renum, invent) in enumerate(T, 1):
    source = " ".join(ss)
    units = [
        # (text in the answer, model quote offered, label, kind)
        (f"{k1}[^1]", "This sentence is not in the source at all, it was invented", "keep", "keep-invented-model-quote"),
        (f"{k2}[^1]", ss[1], "keep", "keep-true-model-quote"),
        (f"{flip}[^1]", flip, "delete", "flipped-polarity"),
        (f"{renum}[^1]", renum, "delete", "changed-number"),
        (f"{invent}[^1]", invent, "delete", "invented"),
        (invent.replace(".", " and nobody checked it.") if lang == "en" else invent.replace(".", " ואף אחד לא בדק."), None, "delete", "no-marker"),
        (f"{k1}[^9]", None, "delete", "unread-source"),
    ]
    quotes = [u[1] for u in units if u[1] is not None and "[^1]" in u[0]]
    cases.append({
        "id": f"cg-{i:02d}", "lang": lang, "question": q,
        "sources": [{"n": 1, "id": f"[[synthetic-{i:02d}]]", "text": source}],
        "answer": " ".join(u[0] for u in units),
        "modelQuotes": {"1": quotes},
        "units": [{"text": u[0], "label": u[2], "kind": u[3]} for u in units],
    })

print(json.dumps({
    "name": "cite-gate-synthetic", "version": "1",
    "license": "MIT (written for lumen-md; synthetic, no real data)",
    "note": "SYNTHETIC. Written for R12.9 by gen.py; labels by construction. Tag: dev.",
    "cases": cases,
}, ensure_ascii=False, indent=1))
