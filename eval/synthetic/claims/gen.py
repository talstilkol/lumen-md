#!/usr/bin/env python3
"""Generate the SYNTHETIC claim-extraction eval set (R12.11).

20 paragraphs (10 English, 10 Hebrew), written for this eval: invented
names, no real people, labels by construction. Each paragraph has a fact,
a fact behind a pronoun, and an opinion. The scripted model drafts five
claims per paragraph: two faithful ones (the second with the pronoun
resolved) and three it must lose (an invented word, a flipped polarity, a
claim from the opinion sentence). Tag: dev. It measures the deterministic
rules around the model, not a model.

    python3 eval/synthetic/claims/gen.py > eval/synthetic/claims/cases.json
"""
import json

EN = [("Dana Levi","She","engineer","Haifa","2019"),("Omer Katz","He","teacher","Eilat","2015"),("Noa Bar","She","nurse","Ashdod","2021"),
      ("Yoni Peretz","He","baker","Safed","2012"),("Maya Golan","She","pilot","Netanya","2018"),("Avi Tal","He","architect","Rehovot","2010"),
      ("Lior Ben","He","chemist","Modiin","2020"),("Shira Oz","She","librarian","Arad","2016"),("Tamar Ron","She","dentist","Ramla","2014"),("Eitan Gil","He","farmer","Dimona","2011")]
HE = [("דנה לוי","היא","מהנדסת","בחיפה","לחיפה","2019"),("נועה בר","היא","אחות","באשדוד","לאשדוד","2021"),("מאיה גולן","היא","טייסת","בנתניה","לנתניה","2018"),
      ("שירה עוז","היא","ספרנית","בערד","לערד","2016"),("תמר רון","היא","רופאת שיניים","ברמלה","לרמלה","2014"),("רותם שגיא","היא","מורה","באילת","לאילת","2015"),
      ("ליה כהן","היא","אופה","בצפת","לצפת","2012"),("עדי מור","היא","אדריכלית","ברחובות","לרחובות","2010"),("גלי נוי","היא","כימאית","במודיעין","למודיעין","2020"),("הדס צור","היא","חקלאית","בדימונה","לדימונה","2011")]

cases = []
for i, (name, pron, job, city, year) in enumerate(EN, 1):
    para = f"{name} works as a {job} in {city}. {pron} moved to {city} in {year}. I think {pron.lower()} should get a prize."
    drafts = [
        (1, f"{name} works as a {job} in {city}.", "keep"),
        (2, f"{name} moved to {city} in {year}.", "keep"),
        (1, f"{name} works as a senior {job} in {city}.", "invented-words"),
        (1, f"{name} is not a {job} in {city}.", "no-quote"),
        (3, f"{name} should get a prize.", "not-selected"),
    ]
    cases.append({"id": f"cl-{i:02d}", "lang": "en", "paragraph": para, "drafts": drafts})
for i, (name, pron, job, at, to, year) in enumerate(HE, 11):
    para = f"{name} עובדת כ{job} {at}. {pron} עברה {to} בשנת {year}. לדעתי מגיע לה פרס."
    drafts = [
        (1, f"{name} עובדת כ{job} {at}.", "keep"),
        (2, f"{name} עברה {to} בשנת {year}.", "keep"),
        (1, f"{name} עובדת כ{job} בכירה {at}.", "invented-words"),
        (1, f"{name} אינה עובדת כ{job} {at}.", "no-quote"),
        (3, f"ל{name} מגיע פרס.", "not-selected"),
    ]
    cases.append({"id": f"cl-{i:02d}", "lang": "he", "paragraph": para, "drafts": drafts})

out = []
for c in cases:
    out.append({"id": c["id"], "lang": c["lang"], "paragraph": c["paragraph"],
                "drafts": [{"sentence": s, "text": t, "subject": "", "predicate": "", "object": "", "label": l} for s, t, l in c["drafts"]]})
print(json.dumps({"name": "claim-extractor-synthetic", "version": "1",
                  "license": "MIT (written for lumen-md; synthetic, no real data)",
                  "note": "SYNTHETIC: invented names, scripted model drafts, labels by construction. Tag: dev.",
                  "cases": out}, ensure_ascii=False, indent=1))
