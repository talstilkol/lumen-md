# Lumen — Markdown, illuminated

A web-based markdown editor focused on **rendering quality** and **automatic data → visualization**. Hybrid web + desktop is on the roadmap (Tauri shell wrapping the same web app).

## What's in this build

- **Source / Split / Preview / WYSIWYG** modes (`⌘1` / `⌘2` / `⌘3` / `⌘4`) — WYSIWYG runs Milkdown (ProseMirror) and round-trips to plain markdown
- **Command palette** (`⌘K`) — file ops, view switching, theme, insert templates for every block type, workspace controls, collaboration, Git clone / commit / pull / status
- **Workspace search** (`⇧⌘F`) — fuzzy filename + content search across the OPFS workspace
- **CodeMirror 6** editor with markdown syntax highlighting, line numbers, smart-pair brackets, autocompletion (`⌃Space`), spellcheck, and an optional **Vim** mode
- **Unified / remark / rehype** rendering pipeline:
  - GitHub-flavored Markdown (tables, task lists, strikethrough, autolinks)
  - YAML frontmatter (parsed, hidden from preview)
  - Footnotes
  - Math via **KaTeX** (inline, display, `\ce{}` chemistry)
  - Container directives → admonitions (`:::note`, `:::tip`, `:::info`, `:::warning`, `:::danger`)
  - Heading slugs for outline links
- **Code highlighting via Shiki** (VS Code-grade) with a copy button and optional `title="..."` filename badge
- **Mermaid** diagrams (flowcharts, sequence, gantt, pie, ER, mindmap…)
- **Graphviz** local rendering via `@hpcc-js/wasm/graphviz` (`dot` / `graphviz` fences, all engines)
- **PlantUML** via the [Kroki](https://kroki.io) public render service (`plantuml` / `puml` fences)
- **ECharts** charts:
  - Explicit `chart` block (YAML or JSON ECharts spec)
  - Automatic chart suggestions from `csv` / `tsv` / `json-table` blocks (line / bar / pie / scatter / radar based on column-type heuristics)
- **DataTable** (sortable, type-aware, virtualized to 200 visible rows) for `csv` / `tsv` / `json-table`
- **Maps via Leaflet** for `map` and `geojson` blocks
- **Music notation** via abcjs (`abc` fences)
- **3D model viewer** for glTF / GLB via Google's `<model-viewer>` (`model` fences)
- **Sandboxed embeds** (`embed` fences): YouTube, Vimeo, Loom, CodePen, CodeSandbox, Figma, Spotify, or any URL
- **Live HTML/CSS/JS preview** (`htmlpreview` fences) — drop in raw HTML, CSS, or scripts and Lumen renders it in a sandboxed iframe with Source / Fullscreen toggles
- **File open / save** via File System Access API (with download fallback) — `⌘O` / `⌘S` / `⇧⌘S`
- **OPFS workspace** — multi-file tree with **subfolders**, rename / delete (recursive for folders), debounced autosave per file, recent-file history (`⌘K → Recent`)
- **Image paste & drop into editor** — saves to OPFS as `lumen-asset-*` files and inserts a markdown image; falls back to a base64 data URL when OPFS isn't available
- **Wiki-links** `[[Page|label]]` — slug-based jump within a doc; with the workspace open, the **Backlinks panel** shows every other file linking to the active doc
- **Real-time collaboration** via Yjs over WebRTC — `⌘K → Start collaboration` creates a peer-to-peer room, copies a share link to your clipboard, and shows live peer dots in the status bar. Joining via `#room=…` link auto-prompts.
- **Git sync** via `isomorphic-git` + `lightning-fs` — clone any HTTPS repo into the workspace, edit files, then commit & push back, **pull** remote changes, view working-tree **status**. Token + identity are stored locally in IndexedDB.
- **i18n & RTL** — bundled English + Hebrew, `<html lang dir>` is set automatically. Switch via `⌘K → Language: …`. Code blocks, math, and the editor stay LTR even in RTL UIs.
- **Mobile-responsive layout** — sidebars float as overlays on small screens, split mode degrades to stacked rows, toolbar hamburger toggles the workspace.
- **Resizable workspace sidebar** with persisted width (drag the edge, or reset to default).
- **Themed prompt / confirm / alert dialogs** replacing the browser natives (focus-trapped, Esc to dismiss, RTL-aware).
- **Accessibility baseline** — `:focus-visible` rings, `prefers-reduced-motion` opt-out, ARIA labels on toolbar buttons, skip-link to the main content, focus-trap + focus-restore on command palette / search / prompt dialogs, `role="dialog"` + `aria-modal` on every overlay.
- **Outline scroll-spy** — the preview pane reports the currently visible heading and the outline panel highlights it live.
- **Installable PWA** (Progressive Web App) — install as a desktop app via the browser's "install" affordance; service-worker precaches the shell + all heavy WASM/lazy chunks (~18 MB) so the editor works fully offline after the first visit. Updates surface as a non-blocking in-app banner you can dismiss or accept.
- **Export to self-contained HTML** (inlines all stylesheets so the file looks identical when opened anywhere)
- **Print / Save as PDF** (browser print dialog with a comprehensive print stylesheet)
- **Drag-and-drop import** of `.md`, `.csv`, `.tsv`, `.json` files
- **Outline panel** (live TOC, click-to-jump)
- **Status bar** with live word-count, character-count, reading-time estimate, and collab peer dots
- **Light / dark theme** with persisted preference; Mermaid retints itself on theme change
- **Persisted document state** (last document survives a refresh)

## Layout

```
src/
├─ editor/          CodeMirror 6 wrapper
├─ renderer/        unified pipeline + rehype-react + Shiki
├─ plugins/         Chart, Mermaid, CSV, JSON-table, Map, DataTable, ECharts wrapper
├─ data/            CSV/JSON parsing, type inference, chart suggestion
├─ storage/         File System Access API + download fallback
├─ store/           Zustand store (doc, mode, theme, outline)
├─ ui/              Toolbar, Outline
├─ lib/             utilities (cn, debounce)
├─ welcome.ts       The demo document showcasing every renderer
├─ App.tsx
└─ main.tsx
```

When the project grows enough to warrant it, this folder structure maps 1:1 to a `packages/*` monorepo split.

## Running

```bash
npm install
npm run dev        # vite dev server on http://localhost:5173
npm run build      # production build to dist/
npm run preview    # serve the production build
npm run typecheck  # tsc --noEmit
```

### Desktop (Tauri)

Requires the [Rust toolchain](https://www.rust-lang.org/tools/install).

```bash
npm run tauri:dev    # launch dev app
npm run tauri:build  # produce platform installer
npm run tauri:icons  # regenerate src-tauri/icons/* from public/favicon.svg
```

All icons required by `src-tauri/tauri.conf.json` are committed, so `tauri build` works without re-running `tauri:icons`.

## Keyboard shortcuts

| Shortcut | Action |
| -------- | ------ |
| `⌘N` / `⌘O` / `⌘S` / `⇧⌘S` | New / Open / Save / Save As |
| `⌘K` | Command palette |
| `⇧⌘F` | Workspace search |
| `⌘1` – `⌘4` | Source / Split / Preview / WYSIWYG |
| `⌃Space` (editor) | Autocomplete |
| `Esc` (overlays) | Close dialog |

## Special markdown blocks

| Lang fence            | Renders as                                                        |
| --------------------- | ----------------------------------------------------------------- |
| `mermaid`             | Mermaid diagram                                                   |
| `dot` / `graphviz`    | Graphviz diagram (`engine=neato\|fdp\|twopi\|circo` via meta)     |
| `plantuml` / `puml`   | PlantUML diagram via Kroki                                        |
| `chart`               | ECharts chart from a YAML or JSON ECharts spec                    |
| `csv` / `tsv`         | Sortable DataTable + auto chart suggestions                       |
| `json-table`          | DataTable + chart suggestions (from a JSON array of objects)      |
| `map`                 | Leaflet map (`center`, `zoom`, `markers: [{lat, lng, label}, …]`) |
| `geojson`             | Leaflet map of a GeoJSON FeatureCollection                        |
| `abc`                 | Sheet music via abcjs                                             |
| `model`               | 3D model viewer (`src` to a glTF / GLB)                           |
| `embed`               | Sandboxed iframe (YouTube, Vimeo, Loom, CodePen, CodeSandbox, Figma, Spotify, …) |
| `htmlpreview`         | Sandboxed live HTML/CSS/JS preview (Source / Fullscreen toggles)  |
| anything else         | Shiki-highlighted code block (with optional `title="file.ts"`)    |

## Manual test checklist

- Open a markdown file → Save → reload → Recents restores it.
- `⌘K` → filter → arrows / `Enter` → action runs, focus returns to the previous element.
- `⇧⌘F` → search → `Enter` opens the hit file.
- Drag the sidebar divider → width persists across reload.
- Switch locale to `עברית` → UI flips to RTL, code blocks stay LTR.
- In WYSIWYG: type `/` → slash menu appears; select text → formatting tooltip appears; type `$e=mc^2$` inside a math block.
- Git: clone an HTTPS repo → edit → `⌘K → Commit & push` → `⌘K → Pull` → `⌘K → Status`.
- Deploy a new build → refresh a previously-opened tab → update banner appears → click Reload.

## Lumen Cloud (optional)

Lumen is fully local-first: nothing leaves your browser by default. To unlock
account features — persistent collab rooms, cloud sync, Smart search — opt in
to Lumen Cloud:

1. Create a free [Supabase](https://supabase.com) project.
2. Copy `Project Settings → API → URL` and `anon key` into `.env.local`:
   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
3. `npm install @supabase/supabase-js` (the SDK is dynamically imported, so
   builds without it skip the dependency).
4. Restart `npm run dev`. The toolbar's `Sign in` pill becomes active.

The auth surface lives in [`src/auth/`](src/auth/) and exposes a small
`AuthProvider` interface — swap Supabase for Clerk / Firebase / a homegrown
backend by writing a new provider module.

## Smart search (P2-11)

`⌘K → Smart search` (or the **Smart** tab inside `⇧⌘F`) runs a hybrid
retrieval over your workspace:

1. `indexWorkspace()` chunks every `.md` / `.markdown` / `.txt` file at heading
   boundaries and embeds each chunk via OpenAI `text-embedding-3-small`.
2. Vectors land in IndexedDB so subsequent runs only re-embed chunks whose
   content hash changed — keeping the OpenAI bill bounded.
3. Searches fuse the BM25 keyword index with cosine-similarity over the
   embeddings using Reciprocal-Rank Fusion (RRF, k = 60) with a 1.2× semantic
   boost. So a query like "deep learning" finds a doc titled "Neural networks"
   even when no surface words match.

Smart search needs an OpenAI key (`⌘K → AI Settings`) but no account.

## Roadmap (deferred)

- **Server-backed collaboration** with persistent rooms (the WebRTC build is peer-to-peer only — sessions evaporate when all peers leave).
- **Dropbox / Google Drive / iCloud Drive** sync.
- **Tauri native menus** (file / edit / view) wired to the same palette commands.
- More locales beyond English / Hebrew.
