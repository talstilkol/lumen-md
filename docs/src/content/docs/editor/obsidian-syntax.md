---
title: Obsidian syntax
description: Callouts, comments, coloured highlights, footnotes with hover, math and image sizes, written the way Obsidian writes them, so a vault moves to Lumen without changing a line.
type: reference
tasks: ["W12.U1", "W1.3"]
---

A vault that comes from Obsidian uses this syntax every day. Lumen reads it,
shows it in the preview and both editors, and saves it back without
changing it.

## Callouts

```md
> [!warning] Mind the gap
> The platform is curved.

> [!faq]- A question that starts folded
> Click the title to open it.
```

- Every Obsidian type works: `note`, `abstract`, `info`, `todo`, `tip`,
  `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`
  and `quote`, plus their aliases (`summary`, `hint`, `check`, `faq`,
  `caution`, `error`, `cite`, …). An unknown type looks like a note.
- `+` after the type makes the callout foldable and open, and `-` makes it
  foldable and closed.
- Without a title, the callout shows its type in your language.
- A Hebrew callout reads right to left, with its colour bar on the right.
- Callouts can be nested.

## Comments

`%%like this%%` is hidden in the preview, inline or across several
paragraphs. An unclosed `%%` hides the rest of the note, as in Obsidian.
The editors show comments faded, so you can still edit them.

## Highlights

`==text==` is highlighted. A colour emoji at the start picks the colour
(Obsidian 1.14): `==🔴urgent==`, and also 🟠 🟡 🟢 🔵 🟣. Highlights can
contain bold, italics and links, and they also work in table cells and
in Hebrew.

## Footnotes

`Text[^1]` with `[^1]: The note.` anywhere in the file. Hovering over or
tabbing to the number shows the footnote next to it, without scrolling to
the end of the note. Escape closes it.

## Math

`$inline$` and `$$block$$` math. The math renderer loads only when a note
contains math, so it never slows down opening the app.

## Images and their size

| Written | Shows |
|---|---|
| `![[photo.png]]` | the image |
| `![[photo.png\|300]]` | 300 pixels wide |
| `![[photo.png\|640x360]]` | 640 × 360 |
| `![[photo.png\|A cat\|200]]` | with alt text, 200 wide |
| `![A cat\|200](photo.png)` | the Markdown form, 200 wide |

In the preview, drag an image's edge (the right edge in English, the left
in Hebrew) to resize it. The new width is written into the note, as in
Obsidian 1.12.

## Editing an embedded block in place

An embed of a block or a section of another note, `![[Note#^id]]` or
`![[Note#Heading]]`, has a ✎ button in its title. It opens a small editor
on that block's Markdown, framed and labelled **Editing the source: Note**.

- **Save** (or Ctrl+Enter / ⌘Enter) changes the block in the source note,
  and only that block. The `^id` marker stays, so links to it keep working.
  The embed shows the new text right away.
- **Undo** (or Ctrl+Z / ⌘Z on the control) puts the source back, as long as
  nothing changed it since.
- If the source changed after the embed was shown, the edit is refused. The
  embed then refreshes, so you never overwrite text you didn't see.
- **What can't be edited here:**
  - an embed inside another embed;
  - a section of the note you are in;
  - a whole-note embed;
  - a circular embed, which shows its notice instead.

## Tested

Forty golden notes covering all of the above, in English and Hebrew, are
rendered on every test run and checked element by element. They are also
part of the [round-trip corpus](/editor/markdown-fidelity/), so both editors
must save them byte for byte.
