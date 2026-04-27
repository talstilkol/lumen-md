# Lumen Web Clipper

A tiny Chrome / Firefox extension that captures the current web page (or text
selection) as clean markdown and sends it to your running Lumen instance.

## Install (developer mode)

1. Clone this repo.
2. Open `chrome://extensions/`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and pick `extension/` from this repo.
5. Right-click any web page → **Save selection to Lumen**, or click the
   toolbar pin → **Save full page**.

## Configure

Open the extension's **Settings** page (gear icon) and set the URL of your
Lumen instance — defaults to `http://localhost:5173`. The extension then
POSTs each clip as JSON to `<lumen>/api/clip` and falls back to opening the
editor with the clip in the URL hash if the API isn't ready.

## What gets captured

- The page title + URL + capture timestamp (frontmatter).
- The selected text (if any), or the article body (`<article>` / `<main>` /
  `[role=main]` / `<body>`).
- Headings, lists, links, code, blockquotes, images — converted to markdown
  with a tiny inline serializer.

## Future

- Firefox MV3 manifest variant.
- Side-panel UI (Chrome 114+) for tagging during capture.
- Reader-mode pre-pass (à la Readability) for messier pages.
