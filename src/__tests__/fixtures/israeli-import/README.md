# Israeli import fixtures: SYNTHETIC, ours

Every file here was written by hand for lane T8 (no third-party or copyrighted text; the
Bible verses are public-domain one-liners). Each input is in the shape the app writes it —
Word's and Google Docs' clipboard HTML, Notion's "Markdown & CSV" and HTML exports, Apple
Notes as HTML pages and as its own library (NoteStore.sqlite), WhatsApp's "Export chat" .txt — and sits next to what a person expects in the
vault (the oracle). `src/__tests__/helpers/israeliImport.ts` scores one against the other
with the import:diff gate's metrics plus structure, nikud and word order.

| folder | source | fixtures |
|---|---|---|
| paste/ | Word (3), Google Docs (3) | `<name>.html` → `<name>.md` |
| notion/ | Notion: Markdown & CSV (2), HTML (1) | `<name>/export/` → `<name>/expected/` |
| apple-notes/ | Apple Notes: HTML pages (2), NoteStore.sqlite built by `scripts/fixtures/apple-notes-he-fixture.mjs` (1) | `<name>/export/` → `<name>/expected/` |
| whatsapp/ | WhatsApp .txt, Android and iPhone, Hebrew and English, both date orders (6) | `<name>.txt` → `<name>.md` |

These are imitations: they measure the converters against our reading of each format.
Real exports from contributors remain plan W10.O9; the 18/18 gate of W11.M12 runs on those.
