---
title: Smart Insert (⌘⇧V)
description: Paste anything into one dialog — Lumen detects the type and wraps it in the right block.
---

`⌘⇧V` opens a single dialog with one big text area. Paste **anything**
and Lumen figures out what to do with it — across 19 detectors, from
specific (a YouTube URL) to general (a code block whose language is
sniffed from the content).

## The detectors, in order

| Order | Match | Output |
| --- | --- | --- |
| 1 | YouTube / Vimeo / Spotify / Twitter / TikTok / Reddit / GitHub Gist / Figma / Maps / 8 more | ` ```embed ` |
| 2 | Bare HTTPS URL on a single line | Markdown link `[url](url)` |
| 3 | `$$…$$` or `\begin{equation}…\end{equation}` | Math fence |
| 4 | `flowchart LR …`, `sequenceDiagram`, `gantt`, … | ` ```mermaid ` |
| 5 | `digraph G { … }` | ` ```dot ` |
| 6 | `@startuml … @enduml` | ` ```plantuml ` |
| 7 | `X:1 T:Test K:C …` (ABC notation) | ` ```abc ` |
| 8 | `@article{…}` | ` ```bibtex ` |
| 9 | `{ "type": "FeatureCollection", … }` | ` ```map ` (GeoJSON) |
| 10 | YAML with `view:` + `type:` / `source:` | ` ```database ` |
| 11 | YAML with `series:` + `xAxis:` | ` ```chart ` |
| 12 | `CREATE TABLE / INSERT INTO / SELECT …` | ` ```sql ` (parsed to table) |
| 13 | JSON array of homogeneous objects | ` ```json-table ` |
| 14 | Other valid JSON | ` ```json ` |
| 15 | HTML with `<script>` / `<svg>` / `<canvas>` | ` ```htmlpreview ` (interactive iframe) |
| 16 | Other static HTML | Converted to markdown |
| 17 | `name,age\nalice,30\n…` | ` ```csv ` (table + chart suggestions) |
| 18 | Tab-separated rows | ` ```tsv ` |
| 19 | Code that sniffs as JS / TS / Python / Rust / Go / Java / C / C++ / PHP / Ruby / Dockerfile | ` ```<lang> ` |
| 20 | Anything else | Plain markdown — inserted as-is |

The first match wins. The detection badge in the dialog shows you
exactly what was identified ("Detected as: 🔗 YouTube embed") and a
dropdown lets you override.

## The preview pane

The dialog renders the converted markdown in a preview area below the
input. Live-updates as you type. You see exactly what's about to land
in the doc before you commit with ⌘↵.

## Insert position

- **At cursor** — uses the editor's exposed `insertText` handle so the
  surrounding selection is replaced cleanly.
- **Append** — adds to the end of the doc with two newlines.
- **Replace** — swaps the entire doc (use sparingly).

## Examples

> Paste "https://twitter.com/elonmusk/status/1585841080431321088"

→ Detected as: 🐦 X / Twitter embed → wraps as ```` ```embed ````.

> Paste "name,age\\nalice,30\\nbob,25"

→ Detected as: 📊 CSV table → wraps as ```` ```csv ```` and Lumen
suggests a bar chart based on the column types.

> Paste a multi-line `function fetch(url) { … }`

→ Detected as: 💻 JS code → wraps as ```` ```js ```` with Shiki
highlighting.

## Keyboard shortcut

`⌘⇧V` everywhere. Also reachable via:

- The toolbar's **Insert** menu → first item, marked with ✨.
- The command palette (`⌘K`), search "insert anything".
