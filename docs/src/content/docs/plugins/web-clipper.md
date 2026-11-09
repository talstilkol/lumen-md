---
title: Web Clipper
description: Save a web page as a clean Markdown note — from inside Lumen (works today), or from the browser extension (still a developer preview).
---

## Clip from inside Lumen

Two commands save a page into your vault as a clean note, with its source
and the date in the front matter:

- `⌘K → Clip a web page…` — paste a URL; Lumen fetches the page and keeps
  the article (`<article>` / `<main>`), without navigation, ads, forms and
  scripts. Fetching an arbitrary site needs the research service
  ([Research](/ai/research/)); without it, only sites the app's security
  policy already allows can be clipped, and Lumen says so.
- `⌘K → Clip from clipboard` — copy something on a page first; the copied
  HTML (or text) becomes the note.

Clips go into the **Library** folder (**ספרייה** with the interface in
Hebrew), get a number when the name is taken, and open in a new tab.

```yaml
---
title: "How CRDTs Work"
source: "https://martin.kleppmann.com/2020/07/06/crdt-hard-parts.html"
clipped: 2026-04-26
---
```

## The browser extension (developer preview)

`extension/` holds a small Chrome extension (Manifest V3): a **Save to
Lumen** toolbar button and a **Save selection to Lumen** right-click
entry. It converts the selection, or the page's article, to Markdown.

:::caution[It does not save into a vault yet]
The extension sends each clip to `<your Lumen URL>/api/clip`, and when
that fails it opens `<your Lumen URL>/#clip=…`. **No Lumen build answers
either one yet**, so a clip from the extension doesn't arrive in your
vault. Use the commands above until it does.
:::

To try it in developer mode:

```bash
git clone https://github.com/talstilkol/lumen-md
cd lumen-md/extension
```

1. `chrome://extensions/` → enable **Developer mode**
2. **Load unpacked** → pick `lumen-md/extension/`
3. In the extension's **Options** page, set your Lumen URL (the default
   is `http://localhost:5173`).

## Privacy

The in-app commands fetch only the page you ask for (through the research
service when one is set up). The extension makes
no request except to the Lumen URL you configure: no tracking and no
telemetry. Its manifest is
[`extension/manifest.json`](https://github.com/talstilkol/lumen-md/blob/main/extension/manifest.json).
