---
title: Database views
description: Notion-style Table / Kanban / Gallery / Calendar over your YAML frontmatter.
---

The `database` block turns any folder of markdown notes (with consistent
YAML frontmatter) into a queryable collection — and renders the result
as one of four interactive views.

## Tag your notes

Drop YAML frontmatter on every note you want to include:

```yaml
---
type: book
title: Invisible Cities
author: Italo Calvino
rating: 5
status: reading
cover: https://example.com/cover.jpg
---

(body…)
```

The fields you use are entirely up to you — `type` is the only one Lumen
treats specially (it's the row filter).

## Drop a database block

```database
source: books/         # folder under workspace root
type: book             # filter by frontmatter.type
view: kanban           # table | kanban | gallery | calendar
groupBy: status        # for kanban
sortBy: -rating        # prefix '-' for descending
fields: [title, author, rating, status]
cover: cover           # for gallery cards
```

Lumen scans the workspace, matches every note where `frontmatter.type`
equals `book`, and renders the requested view.

## Views

- **Table** — sortable, classic. Click a row to open the note.
- **Kanban** — columns by `groupBy`, draggable cards (coming soon),
  per-card preview of the top 3 fields.
- **Gallery** — cover image + key fields. Set `cover: <fieldName>` to
  pick which frontmatter URL becomes the card image.
- **Calendar** — agenda of every note with a parseable `dateField`.

## Live updates

Edit a note in another tab and the database view re-runs the query
automatically (a `lumen-workspace-changed` event triggers the refresh).

## Tips

- Mix views — keep one big database block at the top of a hub note and
  switch between Kanban and Gallery with the tab strip.
- Combine with **Smart Insert** — drop a YAML spec on an empty line and
  Lumen wraps it as a `database` fence for you.
- The database is read-only inside the block. To edit a row, click its
  title to open the underlying note.
