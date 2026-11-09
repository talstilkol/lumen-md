---
title: Hebrew and right-to-left
description: How Lumen decides the direction of every block — paragraphs, tables, lists, quotes and code — in the editor, the preview, WYSIWYG and the export.
---

Lumen doesn't make a whole note right-to-left or left-to-right. Each block
reads in the direction of **its own** text, so a Hebrew paragraph sits on
the right and the English one after it on the left, in the same note.

| Block | Direction |
| --- | --- |
| Paragraph, heading | Its first strong letter (Hebrew → right-to-left) |
| List, list item, quote | Its own text: a Hebrew list has its markers and indent on the right, its quote bar on the right |
| Table (preview, export) | The table left-to-right; **each cell** by its own text |
| Table (WYSIWYG) | Each cell's paragraph by its own text |
| Code, math | Always left-to-right, even with a Hebrew comment |

The same rules apply in the source editor (line by line), the preview,
WYSIWYG and the HTML export — an exported Hebrew note opens as
`<html lang="he" dir="rtl">` with the same `dir` on every block.

With the interface in Hebrew, the app itself is mirrored: the toolbar,
panels and menus run from the right.

## Tested

`e2e/rtl-matrix.spec.ts` checks tables, bulleted, numbered, nested and task
lists, quotes and code in the preview, WYSIWYG and the export, with the
interface in Hebrew and in English, in Chromium, Firefox and WebKit, and on
an iPhone 14 and a Pixel 7. `visual/rtl.visual.ts` keeps pixel baselines of
the same note (see [Visual regression](/contributing/visual-regression/)).
