# Reuse of code from israelconnect · שימוש חוזר בקוד מ-israelconnect

> **DRAFT for the owner's decision (plan R12.1). Not in force until Tal signs
> the grant below and records the matching line in israelconnect's
> `project/lanes/DECISIONS.md`.** Until then no file is copied or moved from
> israelconnect into lumen-md; the entity-graph work (W12.E*) is a clean
> reimplementation that used israelconnect as a design reference only.
>
> **טיוטה להחלטת הבעלים (משימה R12.1). לא בתוקף עד שטל חותם על ההיתר שלמטה
> ורושם שורה מקבילה ב-`project/lanes/DECISIONS.md` של israelconnect.** עד אז
> אף קובץ לא מועתק ולא מועבר מ-israelconnect ל-lumen-md; עבודת גרף הישויות
> (W12.E*) היא שכתוב נקי שהשתמש ב-israelconnect לעיון בעיצוב בלבד.

## Why · למה

israelconnect is licensed AGPL-3.0-or-later (code) and CC BY 4.0 (data and
schemas). lumen-md is MIT. AGPL code cannot enter an MIT application unless
the copyright holder grants it under MIT as well. israelconnect's
`docs/legal/LICENSING.md` §7 says each contributor keeps the copyright of
what they contributed, and §8 says that after launch a licence can only be
added (dual licensing), never withdrawn. A grant for named files is such an
addition.

israelconnect מורשה ב-AGPL-3.0-or-later (קוד) וב-CC BY 4.0 (נתונים וסכמות).
lumen-md מורשה ב-MIT. קוד AGPL לא נכנס לאפליקציה MIT בלי שבעל זכויות היוצרים
מעניק אותו גם ב-MIT. לפי ‎§7 ב-`docs/legal/LICENSING.md` של israelconnect כל
תורם שומר על זכויות היוצרים במה שתרם, ולפי ‎§8 אחרי ההשקה אפשר רק להוסיף
רישיון (רישוי כפול), לא לבטל. היתר לקבצים מסוימים הוא תוספת כזו.

## Before signing · לפני החתימה

1. Confirm you are the only copyright holder of every file listed below: on
   a full clone of israelconnect, `git log --format='%an <%ae>' -- <path>`
   for each path. Commits by AI assistants working for you are yours; any
   other human author must sign the same grant, or the file stays out.
2. Fill the table: the path, the commit you copy from, and the file's
   sha256 at that commit (`git show <commit>:<path> | sha256sum`).

1. לוודא שאתה בעל זכויות היוצרים היחיד בכל קובץ ברשימה: בעותק מלא של
   israelconnect, ‏`git log --format='%an <%ae>' -- <path>` לכל נתיב. קומיטים של
   עוזרי AI שעובדים בשבילך הם שלך; כל כותב אנושי אחר צריך לחתום על אותו היתר,
   אחרת הקובץ לא נכנס.
2. למלא את הטבלה: הנתיב, הקומיט שממנו מעתיקים, ו-sha256 של הקובץ בקומיט הזה.

## The files · הקבצים

| israelconnect path | commit | sha256 | lumen-md path |
| --- | --- | --- | --- |
| _(none yet: add a row per file before it is copied)_ | | | |

Every copied file carries this in its header:

```
SPDX-License-Identifier: MIT
Copied from israelconnect <path> @ <commit> under the grant in THIRD_PARTY_REUSE.md
```

## The grant · ההיתר

> I, Tal, the sole copyright holder of the israelconnect files listed in the
> table above, at the commits listed, additionally license those files (only
> those files, at those commits) under the MIT License, the text in
> lumen-md's `LICENSE`, for use in lumen-md and anywhere lumen-md's MIT
> licence reaches. Their AGPL-3.0-or-later licence in israelconnect is
> unchanged.
>
> אני, טל, בעל זכויות היוצרים היחיד בקבצים של israelconnect שבטבלה למעלה,
> בקומיטים שצוינו, מעניק בנוסף את הקבצים האלה (רק אותם, ובקומיטים האלה) ברישיון
> MIT, בנוסח שב-`LICENSE` של lumen-md, לשימוש ב-lumen-md ובכל מקום שרישיון ה-MIT
> של lumen-md מגיע אליו. הרישיון שלהם ב-israelconnect ‏(AGPL-3.0-or-later) לא
> משתנה.
>
> Signed · חתום: ____________  Date · תאריך: ____________

The receipt of the signature goes in `scripts/owner` (plan R12.1, acceptance
3). · קבלת החתימה נשמרת ב-`scripts/owner` (R12.1, קבלה 3).

## The matching line in israelconnect · השורה המקבילה ב-israelconnect

In `project/lanes/DECISIONS.md`:

```
D-R12.1 (<date>) — dual licence, MIT in addition to AGPL-3.0-or-later, for the files listed in
lumen-md THIRD_PARTY_REUSE.md only, at the commits listed there (LICENSING.md §8: an addition, not a change).
```

## tasker

talstilkol/tasker has no LICENSE file and no `license` field in its
package.json. R12.1 adds an MIT `LICENSE` there (the same text as lumen-md's
`LICENSE`, with "Copyright (c) 2026 Tal"). The owner does this, in that
repository.

ל-talstilkol/tasker אין קובץ LICENSE ואין שדה `license` ב-package.json. ‏R12.1
מוסיף שם `LICENSE` של MIT (אותו נוסח כמו ב-lumen-md, עם ‎"Copyright (c) 2026 Tal").
הבעלים עושה את זה, באותו ריפו.
