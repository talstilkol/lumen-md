# import-golden: lumen-md's golden exports (plan W13.F1)

origin: synthetic

Three small exports written for the importer tests, in the shapes the real
tools write, with Hebrew text (niqqud, RLM marks, Hebrew file and folder
names) where the tools' own public fixtures have none. Licence: CC0 1.0.
They test the converters, not anything about real-world size or content
(the real exports are W10.O9).

- `roam/Lumen-golden.json` — a Roam JSON export (Export All → JSON): five
  pages, attributes, a heading, tasks, a table, a code block, block
  references, an aliased reference, embeds of a block and of a page, a
  namespace (`ספרים/שירה`), two daily notes, and a file kept on Roam's
  servers (firebasestorage), which must stay a link.
- `craft/` — a Craft space exported as Markdown: documents linking each
  other and a block through `craftdocs://open?blockId=…`, a block-id
  comment, `<mark>`, a callout, images and a PDF in `<doc>.assets/`, and a
  sub-folder.
- `textbundle/` — an iA Writer bundle (`creatorIdentifier: pro.writer.mac`)
  with a percent-encoded Hebrew asset name, an `<img src>`, a PDF and an
  asset no link points at; a Ulysses bundle; and a Ulysses `.textpack`.

Every internal link in them has its target in the same export, so the
share of links that resolve after the import is a real measure (≥ 98%
required; 100% now). The image and PDF files are 1×1 PNGs and a minimal PDF.

## W13.F2

- `dayone/` — a Day One JSON export (`יומן.json`, `{ metadata, entries }`) with `photos/<md5>.jpeg|png` and
  `pdfs/<md5>.pdf`: an entry with a place, coordinates, weather, tags, a star, Day One's `\.` escapes, two
  photos (one not shown in the text); one with a PDF linked by `dayone-moment:/pdfAttachment/…`, a code
  block and a photo the export does not hold; and an empty entry.
- `journal/` — an Apple Journal export: `Entries/<date>.html` (one with a Hebrew page header, prompt,
  bold, a link, a photo, a place and a state of mind; one in English with an audio file whose name has a
  space), `Resources/`, and the export's `index.html`.
- `samsung/` — Samsung Notes shares: two text files (a checklist with ☑ / □, bullets with •) and a PDF,
  and a `.sdocx` (only its first bytes) that must be reported.
- `airtable/` — two Airtable CSV downloads (`<Table>-Grid view.csv`) whose records link each other, with
  a multiple select, a checkbox, a number, a cell with a newline and one with a comma.
- `tomboy/` — two Gnote notes in Hebrew linking each other, a notebook, a TODO-like title (משימות), a
  struck-out item, a large bold heading, a URL; and Tomboy's `manifest.xml`.
