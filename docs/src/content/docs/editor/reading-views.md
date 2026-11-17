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

## Compare two notes or two versions

The compare view shows two texts word by word, the way Word and Google Docs
compare documents, and it is right for Hebrew:

- **Open it** from the **version history** (pick a version → **Compare with
  the current text**), from a **sync conflict** (**Compare word by word**),
  or from the **file tree**: right-click a note → **Select for compare**, then
  right-click another → **Compare with “…”**.
- **Side by side** (the old text on the right in Hebrew, on the left in
  English) or **inline** (deletions struck through, insertions underlined).
  Long unchanged stretches fold into a "Show N unchanged paragraphs" bar.
- **Hebrew-aware.** Words are split the way the browser reads each language
  (`Intl.Segmenter`); צה״ל and ג'ירפה stay one word. When only a prefix
  changed (הבית → ובית) only the prefix is marked. A word whose letters stayed
  and only its niqqud changed is marked with a dotted underline. **Ignore
  niqqud** and **Ignore spaces** hide those differences.
- **Mixed direction.** The marks never move a letter: a line with English,
  numbers and Hebrew reads exactly as it does without them.
- **Keys.** F7 goes to the next change and Shift+F7 to the previous one. A
  screen reader hears each change ("Change 3 of 12: deleted …, inserted …").

## Margin notes

**Command palette** → **Reading: margin notes (footnotes, comments,
suggestions)** moves a note's footnotes, comments (`{>>…<<}`, and a shared
note's comments) and suggestions (`{++…++}`, `{--…--}`, `{~~old~>new~~}`) into
the margin next to their line, as Tufte's books and Google Docs do.

- The margin is on the right of English text and on the **left of Hebrew**.
  Notes that would overlap are pushed down, so one never covers another.
- Pointing at a note or its mark highlights both and draws a line between
  them.
- On a screen narrower than 700px, each note sits under its paragraph.
- **Keys:** a footnote number goes to its note. In a note, ↑ / ↓ go to the
  previous / next note, and Enter or Escape go back to the text. A screen
  reader hears each note's kind ("Footnote 2", "Comment by Dana",
  "Suggested insertion").

## Book pages

**Command palette** → **Reading: book pages (two-page spread)** lays the note
out as the pages of a book, as Apple Books and Kindle do. The EPUB reader has
the same choice in its toolbar (**Scrolling**, **One page**, **Two pages**,
**Two pages (cover alone)**).

- **Right to left.** In a Hebrew book, page 1 is on the right and ← turns to
  the next pages. In an English book, page 1 is on the left and → turns.
  **Book: right to left / left to right** switches the direction.
- **Keys:** ← / → in the book's direction, Page Up / Page Down, Space and
  Shift+Space, Home / End. In the EPUB reader, turning past the last page
  opens the next chapter, and turning back from the first page opens the end
  of the previous one.
- **Your place is kept.** Switching between pages and scrolling keeps the
  same paragraph on screen. A note or book left in pages opens again in
  pages, at the same place.
