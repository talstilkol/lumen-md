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
