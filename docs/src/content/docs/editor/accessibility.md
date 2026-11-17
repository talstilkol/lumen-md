---
title: Accessibility
description: Keyboard use, screen readers, contrast and reduced motion in Lumen — and how each is checked.
type: how-to
tasks: ["W10.E5", "10.1"]
---

Lumen is meant to be used without a mouse, with a screen reader, in Hebrew
or English, in light or dark mode.

## Keyboard

- **⌘K / Ctrl+K** opens the command palette; every feature is a command
  there. **⌘/ / Ctrl+/** lists the shortcuts.
- **Dialogs keep focus.** When a dialog opens, focus moves into it. Tab
  and Shift+Tab stay inside it, **Escape** closes it, and focus returns to
  where it was before (for example the editor). This holds for every modal
  dialog: the palette, search, settings, prompts, setup, version history,
  sign-in, sync conflicts and the rest. While a dialog is open the page
  behind it cannot be clicked or reached with Tab, and a screen reader
  does not read it: every dialog is a native `<dialog>` opened as a modal.
- **The sidebar's edge** is a separator you can reach with Tab. **←/→**
  resize the sidebar by 16 px (**Shift**: 48 px), **Home** / **End** make it
  narrowest / widest. In right-to-left layouts the arrows follow the edge's
  direction.
- The command list in the palette can be reached with Tab and scrolled with
  the keyboard.

## Screen readers

Dialogs are announced with their names (a native modal `<dialog>` with a
label); the rest of the page is hidden from the screen reader while one is
open. The editor has a label, the palette is a combobox with a listbox,
and the sidebar edge reports its width (`aria-valuenow`).

In the editor, moving the cursor onto a heading, a task, a code fence or a
quote speaks what it is ("Heading 2: Plan", "Task, done"), in the interface
language. A new suggestion and long AI work (when it starts and when it
ends) are spoken too. From the palette:

- **Announce cursor position**: the line, the column and the heading above.
- **Screen reader announcements**: switch between headings and structure
  (the default), every line, and off.

See the [accessibility statement](/editor/accessibility-statement/) and the
[screen reader protocol](/editor/screen-reader-protocol/).

## Contrast

Text meets WCAG AA (at least 4.5:1) in light and dark mode: the accent
colour, muted text, inline code and the status-bar indicators (saved,
warning, error) were adjusted for this.

## Reduced motion

With the system's *reduce motion* setting on, animations and transitions are
cut to an instant, and scrolling that Lumen starts (the outline, comments,
typewriter mode, page view) jumps instead of gliding.

## How it is checked

- `e2e/a11y.spec.ts` runs [axe-core](https://github.com/dequelabs/axe-core)
  (WCAG 2.0/2.1 A and AA rules, colour contrast included) on the main
  screen, the command palette, search, the shortcuts list, theme settings and
  setup — in English (left-to-right) and Hebrew (right-to-left), light and
  dark. Any *serious* or *critical* finding fails the build.
- The same file walks a keyboard-only path: palette, a dialog that keeps
  focus for 25 Tab presses and gives it back, and the sidebar edge.
- `src/__tests__/useFocusTrap.test.tsx` covers the shared focus trap, and
  `src/__tests__/modal.test.tsx` the dialog every modal is built on
  (`src/ui/Modal.tsx`).
- `e2e/a11y-dialogs.spec.ts` opens every modal dialog (the list is
  `e2e/dialogs.registry.mjs`) in English and Hebrew and checks each one: it
  is modal, 30 Tab and 30 Shift+Tab presses stay inside, the page behind
  is covered, the focused control is not hidden, axe finds no serious or
  critical problem, and Escape closes it and gives focus back.
- `src/__tests__/modalTraps.test.ts` and the `lumen/modal-only` lint rule
  fail on any element that sets `aria-modal` outside `src/ui/Modal.tsx`, so a
  hand-made dialog cannot come back.
