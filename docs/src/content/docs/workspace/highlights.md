---
title: All highlights
description: Every highlight from PDFs, books and clipped pages in one place: search them, tag them, export them to a note with links back, or drag one into a note.
type: reference
tasks: ["W12.R1", "W12.R3", "W7.2", "W10.C25"]
---

**Command palette → All highlights** lists every highlight in your vault:

- from **PDFs**, kept in `file.pdf.md` ([PDF reader](/workspace/pdf-reader/)),
- from **EPUB books**, kept in `book.epub.md` ([EPUB reader](/workspace/epub-reader/)),
- from **clipped pages**: passages marked `==like this==` in a note that was
  clipped from the web, or marked in [reading mode](/workspace/epub-reader/#reading-mode-for-clipped-pages).

## Find

Type in the search box to search the highlighted text, its note and its tags.
Case, spacing and Hebrew niqqud don't matter. Narrow the list by **kind**
(PDF, EPUB, clips), by **document** and by **tag**. Click a highlight to
open it: the reader opens at its page or chapter and flashes it.

## Tags

Type a tag under a PDF or EPUB highlight and press Enter. The tag is saved
with the highlight in its note (`file.pdf.md` or `book.epub.md`), as a W3C
Web Annotation tag, so it syncs with the note. **×** removes it. A clip's
highlights show the clip's own `tags:` from its front matter.

## Scan highlights from a printed book

In **All highlights**, choose **Scan a page**. Take a photo of the page with the phone's camera,
or drop or paste an image on the desktop.

- Lumen finds highlighter in **yellow, green, pink, orange or blue**, and **pen underlines**.
  The photo is checked by colour and by the shape of a drawn line, on this device.
- Only the marked lines go through the on-device OCR (Hebrew and English, mixed lines
  included). A word broken with a hyphen at the end of a line is joined again; a highlight
  that runs over several lines becomes one highlight.
- The page number is read from the page's header or footer when it is printed there; you can
  type or change it.
- Type the book's title and author (and its ISBN if you like; the check digit is verified).
  The highlights join that book's note in the `Highlights/` folder, with `p. N`, next to
  highlights imported from Kindle, Kobo, Readwise or Zotero for the same book.

The photo is **not kept** unless you tick **Keep the photo in the vault**; then it goes to
`Highlights/scans/`. Nothing is sent over the network: the detection and the OCR models are
part of the app.

## Export and drag

**Export to a note** writes the current list to a new note,
`Highlights <date>.md`: a section per document, each highlight as a quote with
its note, its tags and a link that opens it again.

Drag a highlight into a note: it drops as a quote with that link. Drag a PDF
highlight onto a canvas and it becomes a **highlight card**: the quote and
its page, linked to the exact place in the PDF. Opening the card's link
opens the reader at that page and flashes the highlight, found again by its
text even after the PDF's text layer changed or it was run through OCR. In
a `.canvas` (JSON Canvas) file the card is a file node with the highlight as
its subpath, as Obsidian Canvas keeps one. If you delete the highlight
later, the card stays on the canvas, dashed, and says the source was
deleted.

**Export with APA citations** (PDF highlights) writes the same note with a
Hebrew APA 7 citation after each quote, for example
"(כהן ואחרים, 2020, עמ׳ 14)", and a reference list at the end, Hebrew
sources before English ones. The citations follow the Bar-Ilan and Haifa
library guides (no comma before the last author's ו, "ואחרים" for three or
more) and are bidi isolates, so their brackets do not flip in a Hebrew
document. Each PDF's details come from your citation library (Zotero, or a
`.bib` / `.csl.json` file in the vault); a PDF it cannot match is asked
about once, and the answer is remembered on this device. The page is the
PDF page number; a book whose printed page numbers differ needs its page
labels, which this export does not read yet.

## Speed

The panel's list comes from the vault's index worker: no note is read or
parsed on the page's main thread, so typing doesn't stall while the panel
fills in a large vault.
