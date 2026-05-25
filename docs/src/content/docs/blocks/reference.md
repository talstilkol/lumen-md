---
title: Dynamic blocks reference
description: All 20+ fenced code-block languages that Lumen renders as live, interactive previews.
---

Lumen's killer feature is **dynamic blocks**: write a fenced code block in markdown, and the preview renders it as a chart, diagram, table, map, or live sandbox. Every block degrades gracefully — if rendering fails, you still see the source.

## Quick-reference table

| Fence | Renders as | Notes |
|---|---|---|
| ` ```mermaid ` | Inline SVG diagram (flowcharts, sequence, gantt, class, state, ER) | Mermaid v11; lazy-loaded |
| ` ```chart ` | ECharts (line / bar / pie / scatter / heatmap / radar / boxplot / treemap / sunburst / sankey) | YAML or JSON spec |
| ` ```csv ` / ` ```tsv ` | Sortable / filterable DataTable + auto-chart suggestion | Title via `title="..."` |
| ` ```json-table ` | DataTable from a JSON array | Array of objects required |
| ` ```sql ` / ` ```pandas ` / ` ```object ` / ` ```data ` | Tabular display via the shared `DataBlock` renderer | `pandas` parses DataFrame `to_dict()` shape |
| ` ```map ` / ` ```geojson ` | Leaflet map (tile, markers, polygons, popups) | GeoJSON or YAML map-spec |
| ` ```dot ` / ` ```graphviz ` | Graphviz diagram via WASM | Rendered locally — no Kroki dependency |
| ` ```plantuml ` / ` ```puml ` | PlantUML via kroki.io | Network egress; opt out via privacy mode |
| ` ```abc ` | ABC music notation (renderable score) | Abcjs |
| ` ```model ` | 3-D model viewer (`<model-viewer>`) | GLB / GLTF |
| ` ```embed ` | Universal embed (YouTube, Vimeo, Twitter, Loom, CodePen, oembed) | URL on the body line |
| ` ```html ` / ` ```html-preview ` | Sanitized HTML preview | DOMPurify allowlist; no JS executes in the page |
| ` ```svg ` / ` ```live-svg ` | Sanitized inline SVG preview | Same hardening as HTML |
| ` ```live-js ` | JS sandbox (Worker isolate) with console output | Stdout/stderr/error states; timeout-protected |
| ` ```live-css ` | Sandboxed iframe HTML+CSS preview | `srcdoc` + sandbox flags |
| ` ```live-glsl ` / ` ```glsl ` / ` ```shader ` | GLSL fragment shader on a quad | Hot-reloads on edit |
| ` ```bibtex ` / ` ```bib ` | Citation list (formatted from BibTeX) | Click → copy citation |
| ` ```database ` | Workspace-wide database query (markdown frontmatter as the "table") | Lumen-native query DSL |
| ` ```insights ` / ` ```jsonl ` | JSONL analyzer: conclusions, freq, charts, file generators | No external model |
| ` ```code-doctor ` / ` ```fix-json ` | Malformed JSON/JSONL repair with diff + accept-fix UI | 7-pass tolerant tokenizer |

## Security & hardening

All HTML, SVG, and embed renderers funnel through `src/lib/markupSanitizer.ts`. The sanitizer:

- Strips every `on*` attribute via a prefix-matching hook (not just the named list, so future handlers like `onpointerdown` are caught).
- Blocks `style` attributes containing `expression(...)`, `url(javascript:...)`, or `behavior:`.
- Allows only image-MIME `data:` URIs (everything else, including `data:text/html`, is dropped).
- Rejects `javascript:`, `vbscript:`, and unknown protocols.

Each dynamic block is wrapped in an `ErrorBoundary` so a single broken block doesn't take down the whole preview.

## Lazy loading

Every block is `React.lazy`-imported. The block's vendor (Mermaid 718 KB, ECharts 343 KB, Tldraw 400 KB gzipped) only loads when the user actually opens a doc that uses it. The main bundle stays at ~221 KB gzipped regardless of how many block types Lumen supports.

## Authoring a new block

See [Plugin SDK](/plugins/sdk/) — every block is a React component registered with `registerPlugin`. The `pluginSystem` wires its fence language to a tag, mounts via `Suspense`, and routes it through the renderer pipeline.
