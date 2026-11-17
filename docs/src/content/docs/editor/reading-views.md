---
title: Reading views
description: Source, preview and outline side by side with linked scrolling, and the keyboard between the columns.
---

## Source + preview + outline

**Command palette** (⌘K / Ctrl+K) → **View: source + preview + outline,
scroll linked** opens three columns: the Markdown source, the rendered
preview and the outline of the note's headings.

- **Linked scrolling.** The preview's blocks know the source lines they came
  from, so scrolling either side keeps the same line at the top of both —
  within a line, also in a long note (a 2 MB note included) and whatever the
  preview renders taller (images, tables, math). **View → Scroll: Linked /
  Single** turns it off.
- **The caret follows.** The preview marks the paragraph, list item or code
  block that holds the cursor in the source.
- **The outline follows** the preview: the heading in view is marked.
- **Right to left.** In Hebrew and Arabic the columns are mirrored: the
  source is on the right.

## Move between the columns

| Keys | Moves to |
|---|---|
| Ctrl+Alt+Shift+→ | the column on the right |
| Ctrl+Alt+Shift+← | the column on the left |

The keys follow what is on screen, so in a right-to-left layout Ctrl+Alt+Shift+←
goes from the source to the preview. A screen reader announces the column
that got the focus. In the preview, the arrow keys and Page Up / Page Down
scroll it. (Ctrl+Alt+← / → without Shift stay outline mode's indent and
outdent.)
