---
title: Import from other apps
description: Bring notes from Obsidian, Notion, Evernote, Bear, Apple Notes, Google Keep, Logseq, OneNote, Roam, Craft, Day One, Apple Journal, Samsung Notes, Airtable, Tomboy or any TextBundle app — into a new folder, with a report, undone in one click.
type: how-to
tasks: ["W4.19", "W10.E49", "W10.E48", "W1.26"]
---

**File → Import notes from another app…** (or the command palette) opens
the import wizard. It never touches what you already have: everything goes
into a new folder, `Imported/<name of the export>`, numbered when the name
is taken. One click — **Undo the import** in the wizard, or the command
**Undo the last import** later — takes it back.

## Three steps

1. **Pick the app** the notes come from. The wizard tells you how to export
   from it.
2. **Pick the export** — a file, several files, or a folder (or drop them on
   the wizard). Archives are opened, also archives inside archives (Notion
   zips its parts). If the files look like another app's export, the wizard
   says so and switches in one click.
3. **Check, then import.** Before anything is written you see how many
   notes, attachments and databases will come in, what will not and why,
   and how many internal links reach their note.

## What each app becomes

| App | Export to pick | What it becomes |
|---|---|---|
| Obsidian | the vault folder, or a .zip of it | the vault as it is; `.obsidian/` and `.trash/` are left out |
| Notion | Settings → Export → *Markdown & CSV* or *HTML*, the .zip as it came | names without Notion's ids; links follow the pages; **each database becomes a `.base` file** with the same columns, and each row a note whose properties are the row's cells (Yes/No, numbers and dates typed) |
| Evernote | `.enex` files (one per notebook) | a folder per notebook; tasks, images and files in place (`_resources/<note>/`); tags, author, source URL, created and updated as properties; links between notes as `[[wikilinks]]`; encrypted parts are left out and reported |
| Bear | a backup (`.bearbk`) or TextBundles | a note per bundle with its `assets/`; `::highlight::` → `==highlight==`, `#multi word tag#` → `#multi-word-tag`; trashed notes left out |
| Apple Notes | its own database: the folder `~/Library/Group Containers/group.com.apple.notes` (or `NoteStore.sqlite` alone); or HTML or Markdown from an exporter app | from the database: a note per note in its folder, with created/modified dates; titles, headings, bold, italic, strikethrough, links, lists, checklists, code and quotes; images and files from `Media/`; locked notes and Recently Deleted left out, with the reason. From HTML: a note per page; images inside the HTML (`data:` URIs) become files; links between pages follow |
| Google Keep | Google Takeout (Keep only), the .zip | checklists as tasks; labels as tags; colour and pin as properties; archived notes in `Archive/`; trashed notes left out |
| Logseq | the graph folder, or a .zip | page properties as frontmatter; `TODO`/`DONE` as tasks; block references `((id))` and `{{embed}}` as `[[Page#^id]]` / `![[…]]`; journals named by date (`2024-01-31`); `a___b` pages as folders |
| OneNote | pages or sections saved as *Single File Web Page* (`.mht`) | a note per page, its images and attached files next to it |
| Roam Research | ⋯ → *Export All* → *JSON*: the `.json`, or the .zip as it came | a note per page; the blocks stay an outline (a heading block becomes a heading, `{{table}}` a table); `Name:: value` at the top of a page becomes a property; a block something refers to gets a `^id` and `((uid))`, `{{embed: ((uid))}}`, `[text](((uid)))` become `![[Page#^id]]` / `[[Page#^id\|text]]`; daily notes go to `journal/2021-01-02.md` and every link follows; `a/b` pages become folders; files Roam keeps on its servers stay links (nothing is downloaded) and the report says so |
| Craft | *Export* → *Markdown* (or *TextBundle*), the .zip or the folder | a note per document, images next to it; `craftdocs://` links to a document of the export become `[[wikilinks]]`, and to a block `[[Document#^id]]` when the export carries the block's id; a link to something not in the export keeps its text and is reported; `<mark>` → `==…==` |
| TextBundle | `.textbundle` folders or `.textpack` files (Ulysses, iA Writer and other editors), or a .zip of them | a note per bundle, named after it, its `assets/` in `assets/<note>/` with every link (Markdown or `<img>`) following; an asset no link points at is listed at the end of the note, so none is lost; the app that wrote it as the property `source` |
| Day One | *File → Export → JSON*, the .zip as it came | a note per entry in `<journal>/<year>/`; photos, videos, audio and PDFs (by their MD5) where the entry shows them, the rest listed below it; place, `coordinates` (shown on the map), weather, tags, star and dates as properties; a file the export lacks is reported |
| Apple Journal | the exported folder (`Entries/`, `Resources/`), or a .zip | a note per entry, dated from its header (English or Hebrew); the prompt as a quote; photos and audio embedded; place, state of mind, activity, contact and media as properties |
| Samsung Notes | notes shared as *Text file* or *PDF file* | a text note per file (☑ / □ become tasks); a PDF gets a note that shows it; Samsung's own `.sdocx` is reported (share as text or PDF instead) |
| Airtable | each table's *Download CSV*, picked together; or a base saved from Airtable's API as JSON | a folder per table with a note per record and a `.base` that shows them; numbers and checkboxes typed, multiple selects as lists, a linked record as a `[[link]]`; attachments stay links to Airtable (nothing is fetched) |
| Tomboy / Gnote | the notes folder, or its `.note` files | a note per note; notebooks as folders; bold, italic, strikethrough, highlight, monospace, links; lists, and tasks in a TODO note; a template to `Templates/` |

Dates are kept as the properties `created` and `updated` (a browser cannot
set a file's own dates). Hebrew names — files, folders, tags, properties —
stay as they are; only characters a file system refuses are replaced.

## Other formats, through your Pandoc (desktop)

If [Pandoc](https://pandoc.org) 2.15 or later is installed on the computer,
the wizard offers **Pandoc** for the formats Lumen has no importer of its own
for: DocBook, MediaWiki, Jira, OPML, txt2tags, DokuWiki, Textile, Creole,
TWiki, TikiWiki, Vimwiki, Muse, FictionBook, man pages, Haddock and POD.
Lumen does not include Pandoc (it is GPL software): it runs the copy you
installed, with `--sandbox` (it reads the one file and writes the result,
nothing else, no network) and a fixed set of options, and each run is listed
in the privacy ledger. Without Pandoc, and in the browser, the choice is not
shown.

## The report

The last step shows what came in, what did not and why (the app's own
settings, its trash, a second copy of a file, a format the app cannot
convert, a damaged file), notes that came with something missing (an
attachment the export does not have, an encrypted part, no dates), and links
that point at nothing. **Save the report as a note** puts it in the import's
folder (undo takes it back too).

## Undo

Undo deletes exactly what the import wrote: its folder, and `Imported/` when
the import made it. The vault is then the same, byte for byte, as before the
import. If you changed something in the folder after the import, undo moves
the folder to the trash instead, so nothing of yours is lost.

## Limits

- Apple Notes: quit Notes before picking its folder. Changes Notes has not
  yet written into `NoteStore.sqlite` (its `-wal` file) are not read, and the
  report says so. Tables, drawings and scans in a note are not converted yet;
  the report lists each one. Locked notes need unlocking in Notes first.
- OneNote's own `.one` files cannot be read; export pages or sections as
  `.mht`. A direct import through Microsoft Graph (sign in, read only:
  `Notes.Read`) needs an app registered with Microsoft: the deployment can
  name one in `/lumen-runtime.json` (`{"onenote": {"clientId": "…"}}`), or
  you can register your own free app in Microsoft Entra and paste its client
  ID into the wizard (it stays in this browser). The sign-in token stays in
  memory and is sent only to graph.microsoft.com. With a client ID, picking OneNote shows
  **Sign in to Microsoft and import from OneNote**: after the sign-in the
  wizard reads every notebook, section group and page, and shows the usual
  review before anything is written.
- Notion's links to a block (`#…` after a page) go to the page: the block
  ids do not survive the export.

## How it is checked

`src/__tests__/importWizard.test.ts` imports one golden export per app
(`src/__tests__/fixtures/import/exports.ts`): 0 attachments lost, at least
98 % of internal links resolved, the Notion database as a `.base` with the
same columns and rows, and an undo that gives back the same vault hash.
`e2e/import-wizard.spec.ts` runs the wizard in the browser. Roam, Craft and
TextBundle have their own tests (`importRoam`, `importCraft`,
`importTextbundle`), as do Day One, Apple Journal, Samsung Notes, Tomboy and
Airtable (`importDayOne`, `importJournal`, `importAirtable`), and `npm run
import:diff` with no folders converts Obsidian Importer's own test exports
(Keep, Roam, TextBundle, Tomboy, Apple Journal, Airtable, CSV) and compares
lumen-md's output with the importer's recorded output, metric by metric. The golden
exports are written from each app's documented format; real exports from
the apps are the owner's check.
