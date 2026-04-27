---
title: Editor modes
description: Source / Split / Preview / WYSIWYG — pick the one that fits the task.
---

Lumen has four editor surfaces. Switch with `⌘1` / `⌘2` / `⌘3` / `⌘4`.

## Source (`⌘1`)

Plain CodeMirror 6 with markdown highlighting. Use it when you want to
write fast, see exactly what the file contains, or paste pre-formatted
markdown. The "Smart Insert" pill (`⌘⇧V`) is most powerful here.

**Best for**: writers who think in markdown; data-heavy notes where you
want the fence delimiters visible.

## Split (`⌘2`, default)

Editor on one side, live preview on the other. The split orientation
follows your viewport — horizontal on wide screens, vertical on phones.
Override via the **Scroll orientation** menu in the top bar.

Scroll-link is on by default — both panes track the same heading even at
different content heights.

**Best for**: most authoring sessions. You see the rendered output the
moment you type.

## Preview (`⌘3`)

Read-only render of the markdown. Tables, charts, diagrams, math, embeds
— everything in its final form. Print preview lives here too: `⌘P`
preserves colours so PDFs come out faithful.

**Best for**: reading notes back, proof-reading, sharing your screen.

## WYSIWYG (`⌘4`)

Notion-grade editing on top of Milkdown / ProseMirror. Slash menu (`/`),
inline math, drag-and-drop block reordering. Round-trips to plain
markdown — so a doc you wrote in WYSIWYG opens cleanly in Source.

**Best for**: visual thinkers; rich documents (presentations, decks);
anyone migrating from Notion.

## Toggle without leaving the keyboard

| Key | Mode |
| --- | --- |
| `⌘1` | Source |
| `⌘2` | Split |
| `⌘3` | Preview |
| `⌘4` | WYSIWYG |

The mode persists across reloads (per-document), so you can come back to
your preferred view automatically.
