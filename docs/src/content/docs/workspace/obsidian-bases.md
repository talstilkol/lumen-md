---
title: Obsidian Bases (.base files)
description: Open, embed and edit Obsidian Bases files — what is supported, what is not, and how the golden set is checked.
---

A vault that comes from Obsidian keeps its **Bases**: `.base` files (YAML)
that turn notes into tables, cards, lists, kanban boards and maps. Lumen
reads and writes the same files, so the views survive the move both ways.

## Three ways to show a base

- **Open the `.base` file** from the workspace: the preview shows its views
  (one tab per view). The editor still shows the YAML.
- **Embed it in a note**: `![[Books.base]]` alone on a line, or
  `![[Books.base#Favourites]]` for one view.
- **Write it inline** in a fenced block:

````markdown
```base
filters:
  and:
    - file.hasTag("book")
    - 'status != "read"'
formulas:
  hours: (pages / 50).round(1)
views:
  - type: table
    name: To read
    order: [file.name, note.author, formula.hours]
    sort:
      - property: formula.hours
        direction: ASC
```
````

## What is supported

| Part of the file | Supported |
|---|---|
| `filters:` — a statement, or nested `and:` / `or:` / `not:` lists | yes (`not:` matches when none of its items match) |
| `formulas:` — computed properties, `formula.<name>`, a formula may use another | yes (a formula that refers to itself is reported) |
| `properties:` — `displayName` for column headers | yes |
| `summaries:` — your own summary formulas over `values` | yes |
| `views:` — `type`, `name`, `filters`, `order`, `sort`, `groupBy`, `limit`, `summaries` | yes |
| View types `table`, `cards` (`image:`), `list`, `kanban` (by `groupBy`), `map` (`coordinates:`) | yes |
| Plugin view types | shown as a table |
| Built-in summaries Average, Min, Max, Sum, Range, Median, Stddev, Earliest, Latest, Checked, Unchecked, Empty, Filled, Unique | yes |
| `this` — the `.base` file when opened, the embedding note when embedded | yes |

Expressions use the Bases language: `note.x` (or just `x`), `file.x`,
`formula.x`, `this.file.x`; operators `+ - * / %`, `== != < <= > >=`,
`! && ||`; text, numbers, lists `[a, b]`, regular expressions `/a.c/i`;
date arithmetic with durations (`today() - "1w"`, `date(note.due) + "1M"`).

**Functions:** 66 of the 68 functions in the Bases reference run (97 %):
all global functions except `icon()`, and every method on any value, text,
numbers, dates, lists (including `map`, `filter`, `reduce` with `value`,
`index`, `acc`), links, files, objects and regular expressions.

Not supported, with a clear message instead of a wrong value:

- `icon()` — the error reads "Bases function icon() is not supported here yet".
  Obsidian's icon set is too large to load in a note.
- `html()` — shown as plain text, never as markup (counted as not supported).

## Differences to know

- **Dates are UTC.** `today()` is the UTC date, as in database formulas, so a
  base gives the same answer on every machine.
- **`file.name` includes the extension** (`Dune.md`), as in Obsidian;
  `file.basename` is `Dune`.
- **`file.ctime`** is the modification time: the browser's file storage does
  not keep a creation time.
- **Text order** is natural (`2` before `10`), Latin before Hebrew.

## Sorting and saving

Click a column header to sort (again to reverse). For an embedded base,
**Save this sort to …** writes the new `sort:` into that view of the `.base`
file — comments, key order and everything else in the file stay as they
were. Opening and saving a base without edits keeps the same YAML data.

## Golden set

`src/__tests__/fixtures/bases/` holds 20 `.base` files and the vault they
run over (`vault.ts`). `expected.json` lists, for each file, the rows and
their order, and some values, worked out by hand from the Bases rules. The
test `basesGolden.test.ts` checks all 20, and that each file read and
written back unedited holds the same YAML.

To confirm against Obsidian 1.14: create the notes of `vault.ts` in an empty
vault, copy the 20 `.base` files into it, open each one and compare its
first view with `expected.json`. Any difference is a bug to file.
