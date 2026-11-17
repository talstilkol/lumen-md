---
title: Embedded queries and saved searches
description: A ```query block lists the notes that match a search, a ```dataview block runs common Obsidian Dataview queries, and saved searches sit in the sidebar. All of them update as the vault changes.
type: how-to
tasks: ["W2.12", "W12.V6", "W12.V1", "W12.A4"]
---

## ```query blocks

Write a search in a `query` block and the preview lists the notes that
match it, kept up to date as you save notes:

````markdown
```query
tag:project -tag:done
view: table
sort: modified desc
limit: 20
```
````

The search uses the same [operators](/workspace/search-operators/) as the
search dialog: words, `tag:`, `path:`, `"exact phrase"`, `/regex/` and
`-term` to leave notes out. Lines of the form `option: value` set how it
shows:

| Option | Values | Default |
|---|---|---|
| `view` | `list`, `table` (note, folder, modified, tags) | `list` |
| `sort` | `relevance`, `name`, `path`, `modified` — then `asc` or `desc` | `relevance` |
| `limit` | 1–500 | 50 |

A line starting with `//` is a comment. The note that holds the block is
never in its own results. An option it can't read is shown above the
results, not silently dropped.

## ```dataview blocks

Vaults that come from Obsidian are full of
[Dataview](https://blacksmithgu.github.io/obsidian-dataview/) blocks.
Lumen runs the common part of its query language, so they render here
without the plugin:

````markdown
```dataview
TABLE status, due FROM #project WHERE status != "done" SORT due ASC
```
````

- **`LIST [expr]`**, **`TABLE [WITHOUT ID] expr [AS "name"], …`** and
  **`TASK`** (the `- [ ]` tasks of the notes, read-only, with a link to each
  note)
- **`FROM`** `#tag`, `"folder"`, `[[note]]` (notes that link to it), with
  `AND`, `OR`, `-` and parentheses
- Then, in the order written: **`WHERE`** comparisons (`= != < > <= >=`),
  `and` / `or` / `!`, `+ - * /`; **`SORT`** one or more fields, `ASC` /
  `DESC`; **`LIMIT`** n; **`GROUP BY`** expr [`AS` name] (`key` and `rows`
  after it); **`FLATTEN`** expr [`AS` name]
- Fields: front matter, inline fields (`key:: value`, `[key:: value]`) and
  `file.name`, `file.path`, `file.folder`, `file.link`, `file.mtime`,
  `file.ctime`, `file.day`, `file.size`, `file.tags`, `file.outlinks`,
  `file.tasks`; `this` is the note the block is in
- Tasks: `text`, `status`, `completed`, `fullyCompleted`, `checked`,
  `annotated`, `section`, `line`, their `[key:: value]` fields and the Tasks
  plugin's dates (📅 `due`, ⏳ `scheduled`, 🛫 `start`, ➕ `created`,
  ✅ `completion`); a task also has its note's fields
- Functions: `contains`, `icontains`, `startswith`, `endswith`, `length`,
  `lower`, `upper`, `date(today)`, `dur(7 days)`, `default`, `choice`,
  `round`, `number`, `string`, `join`, `regexmatch`, `dateformat`, `split`,
  `replace`, `substring`, `truncate`, `padleft`, `sum`, `min`, `max`,
  `average`, `reverse`, `sort`, `flat`, `nonnull`, `link`, `meta`,
  `typeof`, and `filter`, `map`, `any`, `all`, `none` with `(x) => …`
- `.days`, `.year`, `.month` … on a duration or a date:
  `(date(today) - file.day).days`

`CALENDAR` and DataviewJS are not supported:
the block says so instead of guessing. Nothing in a query is run as code —
the language is parsed and interpreted, and a test checks that the query
code has no `eval`.

## Charts from a query

Add `chart:` to a ```query or ```dataview block to draw its rows:

```query
tag:book
chart: bar
chart-x: folder
```

- `chart:` is bar, line, pie, scatter, heatmap or calendar; `chart-x:`,
  `chart-y:`, `chart-series:` and `chart-aggregate:` work as `x`, `y`,
  `series` and `aggregate` in a Bases chart view.
- A ```query block offers the columns `name`, `folder`, `tags`,
  `modified` (a day) and `path`; a Dataview `TABLE` offers its own
  headers (`chart-y: pages` after `TABLE pages`).
- The chart has the same data table and keyboard as a Bases chart.

## Dashboard notes

Put `layout: dashboard` in a note's frontmatter and its blocks — query
and dataview blocks, embedded `.base` files and their charts, tasks,
structure trees — are laid out as a grid:

```markdown
---
layout: dashboard
dashboard-columns: 2     # optional, 1–6; without it as many columns as fit
---
## Reading
![[Books.base#Pages by status]]
```

- Headings and text run across the whole row; each block takes one cell.
  In Hebrew the grid starts on the right.
- Blocks that are scrolled out of view don't re-run on every save; they
  catch up when you scroll back to them.
- Nothing is written to the note, and Obsidian (which ignores `layout`)
  shows it as a plain note with its embeds.

## Live updates

Both kinds of block re-run when a note is saved, deleted or renamed. In a
vault of 1,000 notes, re-running after a save takes well under 100 ms.

## Saved searches

In the search dialog, **☆ Save search** keeps the search. Saved searches are
listed at the top of the file sidebar; a click opens the dialog on that
search again, and × removes it.

Saved searches are kept in the vault, in `.lumen/searches.json`, so they
sync to your other devices with the rest of the vault. If two devices change
the list before they sync, both changes are kept: per search, the newest
save or removal wins. Searches saved in this browser before this change move
into the vault once, the first time you open it.

**Save as Base** turns a search made only of `tag:` and `path:` operators
(with `-` for "not") into an Obsidian `.base` file in `Searches/`. It is a
table you can embed in any note, such as a dashboard, with `![[name.base]]`.
Bases don't search the text of notes, so a search with words, "phrases" or
/regexes/ stays a saved search.
