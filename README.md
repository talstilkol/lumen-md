# Lumen — Markdown, illuminated

> **Local-first. AI-native. Privacy-respecting.**

A production-grade markdown editor built on the open web platform: CodeMirror 6,
unified/remark/rehype, Yjs, OPFS, and WebRTC. Zero server required by default.

[![Tests](https://img.shields.io/badge/tests-992%20passing-brightgreen)](TASKS.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-clean-blue)](tsconfig.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ✨ What makes Lumen different

| Feature | Description |
|---|---|
| **AI Copilot** | OpenAI GPT-4o streaming inline prompts, rewrites, summaries — or run fully on-device via WebGPU (`@mlc-ai/web-llm`) |
| **Smart Search** | BM25+ keyword index fused with OpenAI vector embeddings (Reciprocal-Rank Fusion) inside `⇧⌘F` |
| **Voice Dictation** | Two modes: Quick (Web Speech API, real-time) and AI Memo (MediaRecorder → Whisper transcription) |
| **Live Collaboration** | Yjs CRDT over WebRTC — peer-to-peer, zero server required for P2P rooms |
| **MCP Server** | `npx @lumen-md/mcp-server` gives Claude Desktop / Cursor direct access to your workspace |
| **Privacy-first** | AES-256-GCM secrets vault, telemetry opt-out, full offline capability (PWA) |
| **i18n + RTL** | 8 languages with 595-key full coverage; RTL-safe layout, LTR code/math islands |

---

## 🚀 Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Or try the online version at [lumen.md](https://lumen.md) — no install needed.

---

## 📋 Feature overview

### Editor modes
| Shortcut | Mode | Description |
|---|---|---|
| `⌘1` | **Source** | CodeMirror 6 markdown with syntax highlighting |
| `⌘2` | **Split** | Side-by-side source + live preview |
| `⌘3` | **Preview** | Rendered-only view |
| `⌘4` | **WYSIWYG** | Milkdown (ProseMirror) — round-trips to plain markdown |

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` | Command palette (100+ commands) |
| `⇧⌘F` | Workspace search (fuzzy + semantic) |
| `⌘N` / `⌘O` / `⌘S` / `⇧⌘S` | New / Open / Save / Save As |
| `⌘1` – `⌘4` | Editor mode switching |
| `⌘⇧V` | Smart Insert (auto-detects clipboard content) |
| `⌃Space` | Editor autocomplete |
| `⌘⇧B` | Toggle backlinks panel |
| `⌘⇧G` | Toggle wiki-link graph view |
| `Esc` | Close any overlay |

### Special markdown blocks

| Fence lang | Renders as |
|---|---|
| `mermaid` | Mermaid diagram (flowchart, sequence, gantt, ER, mindmap…) |
| `dot` / `graphviz` | Graphviz (all engines: dot, neato, fdp, twopi, circo) |
| `plantuml` / `puml` | PlantUML via Kroki |
| `chart` | ECharts spec (YAML or JSON) |
| `csv` / `tsv` / `json-table` | Sortable DataTable + auto chart suggestions |
| `database` | Notion-style DB view (Table / Kanban / Gallery / Calendar) |
| `map` / `geojson` | Leaflet map |
| `abc` | Sheet music via abcjs |
| `model` | 3D model viewer (glTF / GLB) |
| `embed` | Sandboxed iframe (YouTube, Vimeo, Figma, Spotify, CodePen…) |
| `htmlpreview` | Live HTML/CSS/JS sandbox |
| `live-css` / `live-js` / `live-svg` / `live-glsl` | Single-language live previews |
| `bibtex` / `bib` | BibTeX citation renderer |
| Anything else | Shiki syntax-highlighted code (VS Code-grade) |

### AI features (set key via `⌘K → AI Settings`)

- **Inline AI prompt** — select text → `⌘⇧A` → describe the change → streamed diff applied
- **Rewrite / Summarize / Translate / Explain** via command palette
- **AI commit messages** — `⌘K → Git: AI Commit Message` generates a commit from the diff
- **Voice AI Memo** — record speech → Whisper transcribes → AI cleans + inserts
- **Smart Search** — hybrid BM25+vector retrieval (`⌘K → Smart search`)
- **On-device LLM** — toggle `useLocalAi` to route prompts to WebGPU via `@mlc-ai/web-llm`
- **Custom fine-tune** — `⌘K → AI: Fine-tune` exports JSONL training pairs from your notes

### Workspace & files

- **OPFS workspace** — multi-file tree with subfolders, autosave, rename/delete (recursive)
- **Recents** — `⌘K → Recent files`
- **Image paste & drag-drop** — saves to OPFS, inserts markdown `![](…)`
- **Frontmatter editor** — structured panel for YAML/TOML metadata
- **Templates** — 20+ starter templates + template marketplace
- **Version history** — per-file undo history with timeline scrubber
- **Wiki-links** `[[Page|label]]` + backlinks panel + graph view
- **Tags panel** — workspace-wide tag index from frontmatter `tags:`
- **Export** — self-contained HTML, DOCX, PDF (browser print dialog)
- **Git sync** — clone / commit / push / pull / status via `isomorphic-git` + `lightning-fs`

### Collaboration

- **Real-time P2P collab** — Yjs over WebRTC, live peer cursors + selection
- **Inline comments** — anchor to text ranges via `Y.RelativePosition`, survive concurrent edits
- **Persistent rooms** — opt-in Fly.io WebSocket server (`sync-server/`) for sessions that survive all peers disconnecting
- **Conflict-free editing** — all edits are CRDT operations; no merge conflicts possible

### Platform

| Platform | Command |
|---|---|
| Web / PWA | `npm run dev` — installable offline-capable PWA |
| macOS / Windows / Linux | `npm run tauri:build` — Tauri 2 native app (23 MB) |
| iOS | `npm run ios:open` — Capacitor 8 Xcode project |
| Android | `npm run android:open` — Capacitor Android Studio project |

---

## 📁 Project layout

```
src/
├── ai/              AI copilot — LLM client, RAG engine, voice transcription, agents
├── auth/            AuthProvider interface (Supabase adapter included)
├── billing/         Stripe entitlements + capability mapping (Free/Pro/Team)
├── collab/          Yjs CRDT, inline comments, live awareness decorations
├── commands/        Command palette action registry
├── data/            CSV/JSON/YAML parsing, type inference, chart suggestions
├── editor/          CodeMirror 6 extensions (typewriter, lint, embed hints…)
├── hooks/           React hooks (collab, git, drag-drop, Tauri menu…)
├── i18n/            i18next setup + 8 locale JSON files (595 keys each)
├── lib/             Utilities: logger, cryptoRandom, debounce, telemetry, audit
├── lint/            Markdown lint rules (markdownlint-rule-remark compatible)
├── mcp-server/      Model Context Protocol server (9 tools)
├── plugins/         Block renderers (Mermaid, Chart, DataTable, ECharts…)
├── renderer/        unified pipeline → rehype-react (Shiki, KaTeX, Wiki-links…)
├── snippets.ts      Block templates for Smart Insert
├── storage/         OPFS workspace, CRDT, encryption, templates, export
├── store/           Zustand store + toast notifications
├── sync/            Git sync + cloud providers (Dropbox, Google Drive)
├── ui/              All React UI components (40+)
├── views/           Graph view (Louvain community detection)
├── App.tsx
└── main.tsx
```

---

## 🧪 Testing

```bash
npm test              # vitest (992 unit tests across 123 files)
npm run test:e2e      # playwright (11 e2e specs)
npm run typecheck     # tsc --noEmit (0 errors)
npm run bundle-budget # verify all chunks within size limits
```

**Coverage**: lines 97.24 % · statements 97.24 % · branches 69.56 %

---

## 🌍 Internationalisation

8 languages with full key coverage (595 keys each):

| Language | Code | Direction |
|---|---|---|
| English | `en` | LTR |
| עברית | `he` | RTL |
| العربية | `ar` | RTL |
| Français | `fr` | LTR |
| Deutsch | `de` | LTR |
| Русский | `ru` | LTR |
| 日本語 | `ja` | LTR |
| 简体中文 | `zh-CN` | LTR |

Switch via `⌘K → Language: …`. Adding a new locale: create `src/i18n/locales/<code>.json`, run `node scripts/generate-all-locales.mjs`, then add the code to `SUPPORTED_LOCALES` in `src/i18n/index.ts`.

---

## 🔌 MCP Server

Expose your Lumen workspace to Claude Desktop, Cursor, or any MCP client:

```bash
npx @lumen-md/mcp-server
```

Available tools: `read_note`, `write_note`, `list_notes`, `search_workspace`, `delete_note`, `update_frontmatter`, `list_tags`, `get_backlinks`, `append_note`.

Configure in Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lumen": {
      "command": "npx",
      "args": ["@lumen-md/mcp-server"]
    }
  }
}
```

---

## ☁️ Lumen Cloud (optional)

Lumen is fully local-first — nothing leaves your browser by default. Opt in to unlock account features (persistent collab, cloud sync, smart search):

### Auth / Database (Supabase)

```bash
# .env.local
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### Error telemetry (Sentry)

```bash
VITE_SENTRY_DSN=https://xxx@o123.ingest.sentry.io/456
```

Users can opt out via `⌘K → Privacy → Disable telemetry`. The Sentry SDK is never loaded when the DSN is absent or the user has opted out.

### Enterprise audit log

```bash
VITE_AUDIT_ENDPOINT=https://audit.yourcompany.com
VITE_AUDIT_TOKEN=your-bearer-token
```

### Self-hosting (Docker Compose)

```bash
cp .env.onprem.example .env   # fill in passwords, domain
make onprem-up                # docker compose up -d (5 services)
```

Services: **web** (nginx), **collab** (Yjs WebSocket), **billing** (Stripe entitlements), **postgres**, **redis**.

### Signaling server (Fly.io)

```bash
cd sync-server
fly launch --name lumen-signal --region sjc
fly deploy
```

Then set `VITE_WEBRTC_SIGNALING_URL=wss://signal.yourdomain.com` in `.env`.

---

## 🗺️ Roadmap

See [ROADMAP.md](ROADMAP.md) for the full phased plan. Key upcoming milestones:

| Milestone | Status |
|---|---|
| Stripe billing integration | 🔑 awaiting keys |
| Persistent collab rooms (Fly.io) | 🔑 awaiting deploy |
| iOS TestFlight + Android Play | 🔑 awaiting Apple/Google accounts |
| npm publish `@lumen-md/mcp-server` | 🔑 awaiting npm org |
| Locale translations (ar/ru/fr/de/ja/zh-CN) | 🔑 awaiting OpenAI key |
| WorkOS SSO | 🔑 awaiting WorkOS account |

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, code style, and PR process.

## 📜 License

[MIT](LICENSE) © 2026 Lumen contributors
