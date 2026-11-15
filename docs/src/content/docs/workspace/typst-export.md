---
title: Typst export (Hebrew)
description: Export a note as Typst source that typesets Hebrew right to left, and compile it to PDF with typst.
---

[Typst](https://typst.app) is a modern typesetting language, an alternative
to LaTeX with good right-to-left support. **File → Export to Typst (.typ)**
writes the open note as a `.typ` file. From the command line:
`lumen convert note.md note.typ`.

## What you get

- A Hebrew note starts with `#set text(lang: "he")`, so Typst lays it out
  right to left. The document's language is the script most of its letters
  are in. `dir: ltr` or `dir: rtl` in the frontmatter overrides that.
- Each paragraph keeps its own direction. An English paragraph in a Hebrew
  note is wrapped in `#[#set text(dir: ltr) …]`, and the reverse in an
  English note.
- Headings, bold, italic, code, links, nested and numbered lists, task boxes,
  tables (column 1 on the right in Hebrew), code blocks with their language,
  block quotes, footnotes and the frontmatter `title`.
- **Math:** Typst math is not LaTeX. Fractions, roots, powers and indices,
  Greek letters, relations, sums and integrals are translated. Any other
  formula is kept as raw text, so nothing comes out wrong without notice.

## Compile to PDF

```bash
typst compile note.typ
```

The file asks for the fonts *David CLM*, *Noto Serif Hebrew* and *Libertinus
Serif*, in that order. Typst uses the first one it finds.

PDF straight from the app, with the Typst compiler running in the browser,
is not here yet. It needs the typst.ts package, which this repository does
not include yet.
