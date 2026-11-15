---
title: Reading list
description: Sources (books, articles, sites) with a reading status, progress that the PDF and EPUB readers keep up to date, and a kanban by status.
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

Command palette (⌘K) → **All Source** (in Hebrew, **כל המקור**) opens the type's Base. Its
**By status** view is a kanban with the columns to read, reading and done.
**Save as .base** keeps it as a file that Obsidian opens too.

## New sources

Make a note with `type: source` (or the `#source` tag), `status: to-read`
and a `file:` link, and fill in what you know. Making a source
straight from a Zotero item or from a page captured in the browser is coming:
the conversion is written and tested, the command for it is not there yet.
