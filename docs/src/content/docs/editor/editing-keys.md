---
title: Lists, cursors and Vim
description: Smart lists, several cursors and column selection, and Vim mode — in the source editor, in Hebrew and in English.
---

## Smart lists

In a list, the keys do what you mean:

| Key | In a list item |
| --- | --- |
| `Enter` | A new item: the next number (`3.` after `2.`, `ב.` after `א.`), an unchecked box after a task, the rest of the line moves with it. The items after it are renumbered. On an empty item: one level out, or the end of the list. |
| `Shift+Enter` | A new line inside the same item |
| `Tab` / `Shift+Tab` | One level in / out, with the item's own sub-items. An item never goes deeper than one level under the item above it. |
| `Alt+↑` / `Alt+↓` | Move the item, with its sub-items, above or below its neighbour |
| `Backspace` | At the start of the item's text: remove the bullet or number |
| `⌘Enter` | Add a task box, check it, remove it |
| `⌘B` | Bold. Select part of a bold phrase to take that part out of bold; select across the edge of a bold phrase to make all of it bold. |

Pasting a list into an item adds no second bullet, and the pasted sub-items
keep their levels under the item you pasted into. Numbered lists in Hebrew
letters (`א.`, `ב.` … `י.`, `יא.` … `טו.`, `טז.`) number themselves like
digits do.

## Several cursors

| Key | Does |
| --- | --- |
| `Alt` + drag | Select a column (a rectangle), for example one column of a table — the pointer turns to a crosshair while `Alt` is down |
| `⌘` + click | Another cursor |
| `⌘D` | Select the word under the cursor, then each next one (a Hebrew word with its niqqud is one word; `ושלום` is not `שלום`) |
| `Esc` | Back to one cursor |

Whatever you type then goes in at every cursor.

## Vim mode

Turn it on in **Settings → General → Enable Vim mode** (or search the
settings for *vim*). The Vim keys load only then.

- In a Hebrew line, `h` and `l` move left and right on the screen, as Vim's
  *rightleft* does; `w`, `b` and `e` move by words in reading order. A
  letter with its niqqud is one character.
- `:w` saves, `:q` closes the tab, `:wq` and `:x` do both.
- `Esc` while an AI request runs cancels the request and keeps you in
  insert mode; the next `Esc` leaves insert mode.
- With Vim mode on, the settings screen moves with `j` and `k` too, and `/`
  goes to its search box.
