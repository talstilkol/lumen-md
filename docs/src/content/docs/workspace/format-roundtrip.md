---
title: "Text formats: what survives a round trip"
description: Measured results for Markdown → Org, AsciiDoc, LaTeX, OPML, RST and Jupyter → Markdown on the 652 CommonMark spec examples and 50 Hebrew notes.
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
| reStructuredText | 91.6% | 92% | emphasis, links, images, code spans | fenced code (24%), setext headings |
| Jupyter `.ipynb` | 90.7% | 92% | prose, inline markup | indented and fenced code with info strings (28–33%), tabs |
| AsciiDoc | 81.8% | 38% | code blocks, links, autolinks | emphasis (42%): `_x_` and `*x*` change meaning on the way back |
| Org-mode | 78.2% | 30% | indented code, reference links | fenced code (55%); `/` and `=` in plain text are read back as italic and code |
| LaTeX | 58.8% | 0% | raw HTML, code spans | **heading levels**: `#` is exported as `\section`, which the importer reads as `##`; backslash escapes |
| OPML | 1.6% | 0% | nested lists only | everything that is not a list item: OPML is an outline format |

The full table by element type is written to
`test-results/format-roundtrip/report.md` on every test run.

## What to do with this

- For a lossless copy, keep the Markdown file. The other formats are for
  handing a note to another tool.
- For LaTeX, use [Academic LaTeX export](/workspace/latex-export/), which
  writes a full project.
- For outlines, OPML is fine; for anything else, it keeps only the lists.
