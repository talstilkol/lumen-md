---
title: Canvas — moving from tldraw to Excalidraw
description: What happens to your tldraw canvases when the canvas moves to Excalidraw, what converts, what doesn't, and where the backup is.
---

The canvas (`🎨 Canvas / Whiteboard`, `⌘K`) is moving from tldraw to
[Excalidraw](https://github.com/excalidraw/excalidraw). Excalidraw is MIT
licensed and runs fully on your device; tldraw needs a licence key in
production and contacts its CDN.

:::note[Status]
The converter and the new file format are in place. The Excalidraw canvas
itself is not switched on yet. Until then the canvas is still tldraw, and the
conversion command below isn't in the palette.
:::

## Where canvases live

| Before | After |
|---|---|
| `canvases/<name>.tldr` (tldraw snapshot) | `canvases/<name>.excalidraw` (Excalidraw scene, open JSON) |

An `.excalidraw` file is the standard Excalidraw format. It opens in any
Excalidraw app, and it is pretty-printed, so diffs stay readable in a
git-synced vault.

## Converting

Command: `🎨 Canvas: convert tldraw canvases to Excalidraw`.

It converts every `.tldr` canvas in the vault in one go and reports how many
were converted, skipped or failed, plus a warning list per canvas. It runs
on your device and makes no network requests.

**The backup.** Your `.tldr` files are never changed, renamed or deleted.
Each one stays next to its new `.excalidraw` file. If a canvas already has an
`.excalidraw` file, it is skipped, so your Excalidraw work is never
overwritten. Running the command twice does nothing the second time.

## What converts

| tldraw | Excalidraw |
|---|---|
| Rectangle, ellipse, diamond (with label) | Rectangle, ellipse, diamond, with the label bound inside |
| Triangle, trapezoid, rhombus, pentagon, hexagon, octagon, star, block arrows | A closed polygon, with the label grouped with it |
| Cloud, heart, oval | Ellipse |
| Check box, x box | Rectangle (the inner mark is dropped) |
| Text | Text: same characters, size and colour |
| Sticky note | Filled rectangle with the text inside |
| Arrow, including its label and bend | Arrow, curved through the same midpoint, label bound to it |
| Arrow connected to a shape | Arrow bound to the same shape, at both ends |
| Frame and the shapes in it | Frame, with its shapes inside |
| Group | Excalidraw group (nested groups too) |
| Image embedded in the canvas | Image, with crop and flip |
| Freehand drawing, highlighter | Freehand stroke (pen pressure kept) |
| Line | Line (smooth if it was a spline) |

Ids, positions, sizes, rotation, opacity, locks, links and colours carry
over. Colours map to the closest Excalidraw colour, and sizes to stroke widths
and font sizes.

## What doesn't convert exactly

Every one of these is kept as something you can see and is listed in the
warning report. Nothing is dropped silently.

- **A frame inside a frame.** Excalidraw frames don't nest. The inner frame
  becomes a top-level frame, and its shapes stay in it.
- **Elbow arrows** become straight arrows.
- **Video, embeds, bookmarks and unknown shapes** become a dashed rectangle
  labelled with the shape type, and the link is kept on it.
- **Images that weren't embedded** (a web address or a missing file) become
  a placeholder with the link. Nothing is downloaded during the conversion.
- **More than one page.** Excalidraw has a single scene, so later pages are
  placed to the right of the previous one.
- **Text formatting** (bold, italic, links inside text) becomes plain text.
  List bullets and numbers are kept as characters.

## Hebrew and right-to-left text

Text is copied exactly, character for character. Excalidraw text has no
direction setting, so the conversion sets the alignment: text that tldraw
aligned to the *start* is aligned right when it begins with Hebrew or Arabic,
and left otherwise.

Excalidraw's own fonts don't include Hebrew letters, so the browser shows
Hebrew text in a system font.

## Older canvases

The converter reads every format a canvas may have been saved in: what the
current tldraw canvas saves, older tldraw snapshots (plain text instead of
rich text, arrows connected the old way), and `.tldr` files exported from
tldraw itself. Canvases from the first Lumen whiteboard (`.canvas.json`) are
converted to tldraw from the canvas picker first.
