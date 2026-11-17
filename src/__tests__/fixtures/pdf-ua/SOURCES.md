# pdf-ua: the accessible PDF export's golden notes (plan W13.F3)

origin: synthetic

Ten Hebrew notes written for this check (CC0): a letter, lecture notes with
niqqud, a table, images (one described, one not), English inside Hebrew with
code, a quote with a footnote, nested and task lists, headings that skip
levels, links, and a long note of several pages.

- `<n>.md` — the note.
- `<n>.html` — Lumen's own print document for it (`preparePrint` +
  `hydratePrintDocument`, src/ui/PrintExport.tsx, with the W13.F3
  accessibility pass), without the app's screen stylesheets.
- `<n>.pdf` — that HTML printed by headless Chromium (Page.printToPDF with
  generateTaggedPDF and generateDocumentOutline) and finished as PDF/UA-1 by
  src/print/pdfUa.ts: `node scripts/verapdf-check.mjs --print` rebuilds them.

`node scripts/verapdf-check.mjs` checks them: the first gate here, veraPDF's
PDF/UA-1 profile where veraPDF is installed (the owner's Mac).
