---
title: Print and PDF
description: Print a note or save it as a PDF the way a word processor would, with page numbers (Hebrew numerals too), a header and footer, a table of contents, clean page breaks and embedded fonts.
type: reference
tasks: ["W10.E18", "W2.23"]
---

**Print / Save as PDF…** (in the File menu and the command palette) opens the system print dialog. Choose "Save
as PDF" to get a file. The layout is built for paper, and for Hebrew first.

## What you get

- **Direction and language from the note.** A Hebrew note prints right to
  left, even from the English interface. Because the language is set
  correctly, the PDF's text can be searched and copied.
- **Header:** the note's title on every page except the first.
- **Footer:** "page / pages", as `1 / 5` or in Hebrew numerals `א / ה`.
- **Clean page breaks.** A heading never sits alone at the bottom of a page.
  Tables, rows, images, code blocks, callouts and display math are never
  split. A long table repeats its header row on every page.
- **Forced breaks:** a paragraph that is just `\newpage` or `\pagebreak`.
- **Footnotes at the bottom of the page.** Each footnote prints at the foot
  of the page where it is first referenced. A paragraph whose footnote does
  not fit moves to the next page together with the footnote. With Hebrew page
  numbers, the footnotes are numbered in Hebrew numerals too (א׳, ב׳, ג׳).
- **Embedded fonts.** The app's own OFL fonts (Heebo and Frank Ruhl Libre
  for Hebrew, Inter and Source Serif 4 for Latin) are embedded in the PDF,
  so it looks the same on any computer.
- **Light theme on paper,** whatever theme the screen uses.

## Settings, per note

Put these in the note's frontmatter:

```yaml
---
toc: true              # a table of contents (h1–h3) on the first page, with working links
page-numbers: hebrew   # decimal (default), hebrew or none
header: Quarterly memo # header text; "" for none
footer: Confidential   # text before the page number
page-size: Letter      # A4 (default) or Letter
footnotes: end         # page (default): at the bottom of each page; end: as endnotes
---
```

## On a phone or tablet

The same command works in mobile browsers and in the installed app. When the
browser blocks the print window, as installed apps and iOS do, Lumen prints
from the current page instead.

## Limits

- **Per-page footnotes are laid out by Lumen,** because Chromium's print
  engine has no per-page footnotes. A single block taller than a page, such
  as a very long table, gets a page of its own, and its footnotes follow it.
- **The table of contents has no page numbers.** Its entries are links,
  which still work in the PDF.
- **Copying from the PDF:** Hebrew and English words copy in reading order.
  A number with a punctuation mark right next to it inside Hebrew text
  (`1:`) can come out of some PDF readers swapped (`:1`). This happens in the
  PDF's text layer, not in what is printed.

## Accessible PDF (PDF/UA)

**Export accessible PDF (PDF/UA)…** in the command palette prints the note
ready for a *tagged* PDF: headings never skip a level, every image has a
description (its alt text, title or caption; one without gets its file name
and the export lists it so you can describe it), table header cells say
whether they head a column or a row, and English inside a Hebrew note is
marked as English so a screen reader switches voice. In Chrome or Edge,
choose **Save as PDF**: the browser writes the headings, figures, tables,
links, language and bookmarks into the PDF's structure.

Then **Finish the saved PDF…** (or **Make a saved PDF accessible
(PDF/UA)…** for any tagged PDF) reads the saved file on your device and adds
what PDF/UA-1 asks for on top: the PDF/UA identification, the title shown
in the window, the language (`he-IL` for Hebrew) and a text for every link.
It then checks the file and tells you what, if anything, is still missing.
Nothing is sent anywhere. Safari and Firefox do not write tagged PDFs: the
finishing step says so.

`node scripts/verapdf-check.mjs` checks ten Hebrew golden notes printed this
way: a first gate here, and veraPDF's PDF/UA-1 profile where veraPDF is
installed.

## Tested

Ten golden notes are printed on every test run: a Hebrew report, a long
table, a table of contents, footnotes, callouts, code and math, images,
page breaks, an English Letter memo and nested lists. Each is compared with
an approved image (under 1% of pixels may differ). Each PDF's text is also
read back with `pdftotext` to check the reading order, the page numbers and
the embedded fonts.
