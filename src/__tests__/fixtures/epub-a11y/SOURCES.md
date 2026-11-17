# epub-a11y: golden EPUBs of the accessible EPUB export (plan W13.F4)

origin: synthetic

Three books written by Lumen's own exporters from text written for this
check (CC0), in headless Chromium (the app's DOM): `he-book.epub` (the book
exporter, src/book/epub.ts: three chapters, Hebrew RTL with niqqud, an
English chapter, a described image, a table, a list, a quote),
`he-note.epub` and `en-note.epub` (the note exporter,
src/storage/exportFormats.ts).

Checked when made (2026-11-17): epubcheck 5.3.0 — 0 fatals, 0 errors,
0 warnings on all three; axe-core 4.10.2 over every content document (the
engine Ace by DAISY runs) — 0 serious or critical; the discovery metadata Ace
looks for is present. Ace itself is the owner's run on the Mac:
`npx @daisy/ace src/__tests__/fixtures/epub-a11y/he-book.epub -o reports/ace`.
