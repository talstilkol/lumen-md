---
title: "Text formats: what survives a round trip"
description: Measured results for Markdown → Org, AsciiDoc, LaTeX, OPML, RST and Jupyter → Markdown on the 652 CommonMark spec examples and 50 Hebrew notes.
type: how-to
tasks: ["W1.2"]
---

Lumen exports a note to Org-mode, AsciiDoc, LaTeX, OPML, reStructuredText and
Jupyter, and imports each of them back. This page says how much of a note
comes back unchanged when you go out and back in. The numbers are measured by
a test (`src/__tests__/formatRoundTrip.test.ts`), not estimated.

## How it is measured

- **Corpus:** the 652 examples of the [CommonMark 0.31.2 spec](https://spec.commonmark.org/0.31.2/)
  (public, CC-BY-SA 4.0), grouped by the spec section that names the element,
  and 50 Hebrew sections of this project's own documentation.
- **Same means:** the Markdown before and after parse to the same CommonMark
  tree (remark-parse), ignoring positions and runs of spaces inside text.
- **Gate:** a drop of more than one point for any format or element fails the
  test, and so `npm run ci:local`.
- **What it does not measure:** whether the exported file is valid in the other
  tool. A converter that passes Markdown through nearly unchanged scores high
  here even where the file it writes is not idiomatic in the other format.

## Results

| Format | All 702 | Hebrew notes (50) | Keeps well | Loses |
|---|---|---|---|---|
| OPML | 99.7% | 100% | headings as outline levels, bullet lists as child outlines | little: a section that is not a plain list is kept as Markdown in the outline's `_note` (the attribute pandoc and OmniOutliner use), so other outliners show it as a note, not as outlines |
| Org-mode | 95.0% | 98% | headings, code blocks with their language, bold inside a Hebrew word (a zero-width space separates it) | odd nestings of emphasis (84%), lists (85%) |
| AsciiDoc | 94.2% | 96% | headings, code blocks, intraword bold and italic (unconstrained marks) | odd nestings of emphasis (75%) |
| LaTeX | 91.6% | 100% | heading levels (`#` is `\section`, read back as `#`), numbered and nested lists, code | indented code (33%), tabs, fenced code inside other blocks |
| reStructuredText | 91.6% | 92% | emphasis, links, images, code spans | fenced code (24%), setext headings |
| Jupyter `.ipynb` | 90.7% | 92% | prose, inline markup | indented and fenced code with info strings (28–33%), tabs |

Emphasis and code are converted line by line: emphasis that spans two lines
stays as Markdown asterisks.

The full table by element type is written to
`test-results/format-roundtrip/report.md` on every test run.

## What to do with this

- For a lossless copy, keep the Markdown file. The other formats are for
  handing a note to another tool.
- For LaTeX, use [Academic LaTeX export](/workspace/latex-export/) when you
  need a full project; the plain export reads back with its heading levels.
- OPML keeps the whole note: headings become the outline, and the text under a
  heading travels in the outline's note.
