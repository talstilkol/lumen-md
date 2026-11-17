---
title: Cursor movement in Hebrew and English
description: Choose how the arrow keys move through a line that mixes Hebrew and English — visually, as the line looks (the default, like Word), or logically, in the order of the text.
type: how-to
tasks: ["W13.H1"]
---

A line such as `ראה iPhone 15 בחנות` holds two directions: the Hebrew runs
right to left, the English and the number left to right. When the caret
reaches the English word, an arrow key can mean two different things. Word
has offered the choice for decades (**Options → Cursor movement**); Lumen
offers the same choice in the source editor and in WYSIWYG.

![Visual and logical cursor movement on the same line](/gifs/cursor-movement.gif)

## Visual (the default)

The arrow moves the caret toward the side it points to **on screen**. Press
Left and the caret goes left, also inside the English word, where that is
backwards in the text. This is what Word, Pages and the browser do by
default, and what most people expect when they watch the caret.

## Logical

The arrow follows the **order of the text**. The key that points toward the
end of the line (Left in a Hebrew line, Right in an English one) always goes
to the next character, also inside the English word, where the caret then
moves the other way on screen. Some writers prefer it because it never skips
a character and matches what Backspace and Delete do.

## What is the same in both

- **Shift + arrow** selects in the same model as the arrow.
- **Ctrl + arrow** (⌥ + arrow on a Mac) moves by word, in the same model.
- **Home** and **End** go to the start and the end of the line in text order,
  so **Shift + End** always selects the whole rest of the line. When a Hebrew
  line ends with an English word, the end of the text is drawn where that
  word ends — at its right side, inside the line — because that is where the
  Unicode bidi algorithm places it.
- Code blocks are always left to right.

## Switching

- Command palette (⌘K) → **Cursor movement: switch to logical** (or **to
  visual**). A notice confirms the new mode, and the caret goes back to the
  note.
- Or **Settings → General → Cursor movement in mixed Hebrew and English
  text**.

The choice is a personal preference of this device, like a keyboard layout:
it is not written into notes and it is not synced to your other devices.
