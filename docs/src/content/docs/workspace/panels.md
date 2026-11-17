---
title: Side panels
description: The file tree, outline, backlinks, tags, comments, trash and version history — what each side panel shows and how to use it.
type: how-to
tasks: ["W12.S2"]
---

Each panel has a **?** button that opens this help at its own section.

## File tree

The left sidebar lists the notes and folders of your vault. Click a note
to open it. Each note and folder has rename and delete, and folders can
take a new note or subfolder. Select several notes to move or delete them
together; a deleted note goes to the trash, and **Undo** brings it back. In
a large vault the folders start collapsed. The sidebar's edge resizes it:
drag it, or focus it and use ← and →.

## Outline

The headings of the open note, as a tree. Click one to jump there. The
outline follows the note as you type.

## Backlinks

Every note that links to the open one with a `[[wiki-link]]`, with the
line around each link. Click a backlink to open that note.

## Tags

Every tag in the vault, from `tags:` in the frontmatter and from `#tags`
in the text, with how many notes use it. Click a tag to filter the file
tree by it.

## Comments

Comments on the shared note, when you collaborate. Each card shows the
author, the text it is anchored to and the replies. Click a card to select
that text; resolve, reply to or delete a comment from its card. Show all
comments or only the unresolved ones.

## Trash

What you deleted in the last 30 days. **Restore** puts a note back where
it was; **Delete forever** removes it now. After 30 days notes are removed
for good.

## Version history

Every kept version of the open note, newest first. A version is kept every
couple of minutes while you type, on every save and when you close the
tab. Pick a version to preview it, with how much it differs from the
current text, and **Restore this version** if you want it back.

## What I knew then

**What I knew then** (command palette) shows the whole vault as it was on
a past date, from the same kept versions. Drag the date slider (in Hebrew
it runs right to left) and search: results come from a separate, temporary
index, so your normal search is not touched. A result opens read-only under
a "This is how it was on …" bar. **Then vs now** shows each paragraph that
changed since, word by word; with that note open in the editor,
**Restore paragraph** puts one paragraph back, and Ctrl+Z undoes it.

The dialog says from which date history exists. What was never saved into
history (before history began, or a note deleted for good) cannot be shown.
A vault that is a git repository also fills in dates before history began
from its commits.
