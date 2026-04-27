---
title: Web Clipper
description: One-click capture of any web page (or selection) into your Lumen workspace as clean markdown.
---

The Lumen Web Clipper is a tiny Chrome / Firefox extension (MV3). The
icon adds a "Save to Lumen" button + right-click context entry that
captures the active page, converts it to clean markdown, and either
posts it to your running Lumen instance or opens the editor with the
clip in the URL hash.

## Install (developer mode)

```bash
git clone https://github.com/your-org/lumen
cd lumen/extension
```

Then in Chrome:

1. `chrome://extensions/` → enable **Developer mode**
2. **Load unpacked** → pick `lumen/extension/`
3. Pin the icon to the toolbar.

Production install via Chrome Web Store comes with the 1.0 launch.

## Use

- **Save full page** — toolbar icon, no selection. Captures the
  article (`<article>` / `<main>`) and converts.
- **Save selection** — right-click → "Save selection to Lumen". Only
  the highlighted text becomes the clip.
- **Quick keyboard** — `Cmd+Shift+L` (configurable in
  `chrome://extensions/shortcuts`).

## What gets captured

Each clip lands in your workspace as `clips/<slug>-<date>.md` with
frontmatter:

```yaml
---
type: clip
title: "How CRDTs Work"
url: https://martin.kleppmann.com/2020/07/06/crdt-hard-parts.html
capturedAt: 2026-04-26T13:42:00Z
isSelection: false
---

# How CRDTs Work

(body, converted to markdown)
```

## Configure

Open the extension's **Settings** page and set the URL of your Lumen
instance. Defaults to `http://localhost:5173`. The extension POSTs
each clip as JSON to `<lumen>/api/clip`; if the API isn't running, it
falls back to opening the editor with the clip in `#clip=…`.

## Markdown conversion

The serializer handles headings, paragraphs, lists, blockquotes,
links, images, code blocks, and inline code. Heuristics:

- `<article>` / `<main>` / `[role=main]` is preferred over `<body>` to
  skip nav + footer noise.
- A user selection always wins, even when an `<article>` is present.
- Scripts, styles, and `<noscript>` blocks are dropped.
- Image `src=` and `alt=` are preserved verbatim.

For dense, JS-heavy pages where the article wrapper isn't obvious, use
a Reader-mode browser extension first, then clip from there.

## Privacy

The extension makes no network requests except to the Lumen URL you
configure. It doesn't fetch tracking pixels, doesn't beacon a usage
event, doesn't ship telemetry. The whole MV3 manifest is in
[`extension/manifest.json`](https://github.com/your-org/lumen/blob/main/extension/manifest.json) — read it.
