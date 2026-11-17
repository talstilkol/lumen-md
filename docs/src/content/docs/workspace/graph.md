---
title: Graph and local graph
description: The knowledge graph of the whole vault — 10,000 notes and 50,000 links — and the local graph of the open note, with filters, colour groups and full keyboard use.
type: how-to
tasks: ["W12.V8", "W12.V3", "W1.10", "W13.G1", "W13.G11", "W10.E60"]
---

## The graph

**Knowledge Graph** (command palette) shows every note of the vault, and a line
for every `[[link]]` between two notes.

- **Big vaults.** The graph is built from the vault index, so the notes
  are not read again. The layout is computed in a background worker; the
  picture appears at once and settles over a second or two. Nodes and
  links are drawn with WebGL, so 10,000 notes and 50,000 links pan and
  zoom smoothly. While you move the view, a sample of the links is drawn;
  all of them come back as soon as you stop.
- **Filters.** Narrow the graph by **tag** (nested tags included:
  `project` keeps `project/active`), by **folder** (and its subfolders),
  or by a frontmatter **property**: `status=open`, or just `status` for any
  note that has one.
- **Colour groups.** Colour the notes by their top folder or their first
  tag. The legend shows the twelve biggest groups.
- **Labels** show for the bigger notes, and for more of them as you zoom
  in. Hebrew names are shaped and written right to left.

## Very large vaults, and the graph as a list

- **Above 20,000 notes** the graph switches to a GPU engine (WebGL2) for
  the layout and the drawing; below that the usual engine draws it, with
  the same filters and colours. Without WebGL2 the list and the table
  below show the same notes.
- **The graph as a list** is for the keyboard and screen readers: the
  current note, its neighbours grouped by relation ("Linked from",
  "Incoming: …"), and a summary of the view ("12 neighbours in 3
  groups"). ↑/↓ move between neighbours, Enter goes there, Backspace goes
  back. The summary follows the filters.

The **table** lists the notes and their links, most linked first, and is
what a screen reader reads instead of the canvas. The graph view, the list
and the table are checked with axe.

## Structure: tree and sunburst

A ```structure block draws the vault's folders, its nested tags
(`#project/lumen/ui`) or this note's headings as a tree or a sunburst:

```structure
source: tags        # folders | tags | headings
view: sunburst      # tree | sunburst
root: project       # optional: only under this folder or tag
```

- Each item shows how many notes are under it (headings: how many headings).
- In Hebrew the tree grows from the right, and the sunburst runs
  counter-clockwise from the top.
- "Show as a tree" swaps the picture for an outline tree. **Tab** to it,
  then ↓ / ↑ move, the arrow toward the text's end opens an item or goes
  to its first child (← in Hebrew, → in English), the other arrow closes
  it or goes to its parent, Home / End go to the ends, and **Enter**
  opens the note or jumps to the heading.

## The local graph

**Show / hide the local graph** opens a panel beside the note: the open
note in the middle, and the notes within **1, 2 or 3** links of it. It has
the same tag and folder filters, and is coloured by folder. It follows you
as you open other notes, and opens in well under a fifth of a second.

## The time slider

"Up to" narrows the graph to the notes dated up to a day — by **Last saved**
or by **Created** (the note's `created` property, else its `date`). Notes
with no such date always stay. It works together with the tag, folder and
property filters, and the table view lists exactly the notes the graph
draws. In Hebrew the slider runs right to left; ←/→, Home and End move it,
and Play steps through the days. It is the same slider as the entity
graph's.

## With the keyboard

The graph is one focusable area. Tab to it, and:

| Key | Does |
|---|---|
| ← ↑ → ↓ | go to the linked note in that direction (or, if there is none, the nearest note that way) |
| Enter | open the focused note |
| + / − | zoom in / out |
| 0 | fit the whole graph |
| Shift + arrows | pan |
| Home | back to the biggest note (in the local graph: the open note) |

The focused note's name and number of links are announced to screen
readers. In the full graph, the **Find a note** box jumps to any note by
name, so every note can be reached without a mouse.
