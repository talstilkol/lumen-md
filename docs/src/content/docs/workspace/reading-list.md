---
title: Reading list
description: Sources (books, articles, sites) with a reading status, progress that the PDF and EPUB readers keep up to date, and a kanban by status.
type: how-to
tasks: ["W12.E7", "W12.X3", "W12.X2"]
---

A **source** is a note about something you read: a book, an article or a
website. It is a built-in [type](/workspace/database-views/) with these
frontmatter fields, and nothing outside the frontmatter:

| Field | Values |
|---|---|
| `status` | `to-read`, `reading`, `done` |
| `kind` | `book`, `article`, `website` |
| `progress` | percent read, 0–100 |
| `page`, `pages` | where you are and the length (PDF pages, EPUB chapters) |
| `rating` | your own rating, 1–5 |
| `file` | the PDF or EPUB you read it in, as a link: `"[[papers/cohen.pdf]]"` |
| `author`, `year`, `url`, `citekey`, `finished` | from the library item, or by hand |

A note is a source when its frontmatter says `type: source` or it has the
`#source` tag. A file `.lumen/types/source.yaml` in the vault replaces the
built-in type, like any other type.

## Progress updates by itself

When you read a PDF or an EPUB that a source names in `file:`, the reader
writes where you are into that source:

- **PDF:** the page you stopped on, out of the PDF's pages. Page 50 of 200
  is `progress: 25`.
- **EPUB:** the chapter, out of the book's chapters.
- The first page you turn moves the source from `to-read` to `reading`. The
  last page moves it to `done` and sets `finished:` to the day. A source you
  marked `done` stays done when you open it again.

Only those frontmatter keys change. The rest of the note, its body included,
is left as it is.

## The reading list

Command palette (⌘K) → **All Sources** (in Hebrew, **כל המקורות**) opens the type's Base. Its
**By status** view is a kanban with the columns to read, reading and done.
**Save as .base** keeps it as a file that Obsidian opens too.

## New sources

From the command palette (⌘K):

- **Reading list: new source from the citation library…** searches the
  library the cite dialog uses (the vault's `.bib` and CSL-JSON files and
  the Zotero copy the desktop app syncs) by cite key, author, title or
  year. The item you pick becomes a source in `Sources/` with its
  `citekey`, `author`, `year` and link (its DOI when it has one).
- **Reading list: new source from a captured page…** makes a `website`
  source from the clip open now (a page saved with the web clipper: its
  `source:` link, title, author and year), with a link back to the clip.
  On any other note it asks for the page's link.

If the vault already has a source with that cite key or link, it opens
that one instead of making a second. Nothing is fetched: both read what is
already in the vault. Without an open vault the new source opens as an
unsaved note.

You can also make one by hand: a note with `type: source` (or the
`#source` tag), `status: to-read` and a `file:` link.
