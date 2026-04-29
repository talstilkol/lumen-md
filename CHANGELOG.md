# Changelog

All notable changes to Lumen will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Quality metrics (2026-04-29, final hardening — post multi-session test surge)
- Tests: **1074 passing across 131 files** (Vitest) + 11 Playwright e2e specs.
- Coverage: **lines 97.24 %, statements 97.24 %, branches 69.56 %, functions 46.48 %** (`npm run test:coverage`).
- Bundle: vendor-shiki **261 KB** (down from 9.2 MB after lazy-grammar split); vendor-tldraw **391 KB** (lazy, canvas-only).
- Security: `npm audit` 0 critical / 0 high / 0 moderate (uuid pinned via overrides).
- Production code: 0 `Math.random()` in collision-sensitive paths, 0 `console.*` outside the logger module, 0 `as any`.
- Locales: 8 selectable (en + he fully translated; ar / ru / fr / de / ja / zh-CN lazy-loaded infra ready).
- MCP server tools: 9 (`read_note`, `write_note`, `list_notes`, `search_workspace`, `delete_note`, `update_frontmatter`, `list_tags`, `get_backlinks`, `append_note`).
- Status-bar pills: 4 (Privacy, Roadmap, Grammar, Telemetry).
- Hardcoded English strings in UI: **0** (46+ eliminated across sessions).
- New test coverage: billing (checkout + entitlement store), auth (localProvider), collab/yjs (room utilities + snapshotPeers), plugin signing (trust key CRUD + fingerprintOf), i18n (locale availability + t() contract), pipeline (extractFrontmatter + extractToc), exportDocx, useFetchSource (parseSrcFromMeta).

### Added
- SECURITY.md — vulnerability reporting process, data-at-rest/in-transit model, plugin sandbox architecture, telemetry PII scrubbing.
- CONTRIBUTING.md rewrite — architecture overview, testing patterns, i18n rules, plugin authoring guide, CI pipeline documentation.
- MIT LICENSE file for public distribution.
- CHANGELOG, CONTRIBUTING, and CODE_OF_CONDUCT for open-source hygiene.
- `*.tsbuildinfo` to `.gitignore`.
- Vitest config now includes `.tsx` test files (`CommandPalette.test.tsx` now runs).
- **Smart Insert** — `⌘⇧V` opens a single dialog that auto-detects the type of any pasted content (URL → embed, CSV / JSON / SQL → table, Mermaid / Graphviz / PlantUML → diagram, math, code with language sniff, …) across 19 kinds with an override dropdown.
- **Database views** — Notion-style ` ```database ` block with Table / Kanban / Gallery / Calendar views over YAML frontmatter across the workspace.
- **Live data URLs** — chart / CSV / JSON blocks accept `src="https://…"` + `refresh="30s"` for auto-rotating dashboards.
- **Smart search** — hybrid OpenAI-embeddings + BM25 retrieval (Reciprocal Rank Fusion) inside `⇧⌘F`.
- **MCP server** — `npx @lumen-md/mcp-server` exposes a Lumen workspace to Claude Desktop / Cursor with `read_note` / `write_note` / `list_notes` / `search_workspace` tools.
- **Local LLM** — `useLocalAi` toggle routes prompts to `@mlc-ai/web-llm` (WebGPU, on-device).
- **Spell-check toggle** + **LanguageTool grammar** check command.
- **Whiteboard auto-save** — every Canvas persists to `canvases/<name>.canvas.json` in OPFS, with a name picker in the toolbar.
- **Cloud sync** — Dropbox provider + provider-agnostic sync engine (`src/sync/cloud/`).
- **Persistent collab server** — y-websocket starter (`sync-server/persistent-server.js`) + dynamic-imported `WebsocketProvider` on the client.
- **Auth** framework with Supabase adapter (dynamic-imported, optional).
- **Stripe billing** skeleton with entitlement → capabilities mapping (Free / Pro / Team).
- **Performance budgets** — `npm run budget` enforces per-chunk gzip limits in CI; Lighthouse CI workflow on tagged runs.
- **iOS native shell** — Capacitor 8 scaffold with permission strings, file-sharing, markdown UTI, `npm run ios:open`.
- **macOS bundle** — Tauri 2 build produces `Lumen.app` (23 MB) + `Lumen_*.dmg` (16 MB).
- **Release pipeline** — `.github/workflows/release.yml` triggers on `v*` tags and builds web + macOS / Windows / Linux Tauri bundles.
- **RELEASE.md** — full instructions for web / Tauri / iOS / Android releases including signing + notarization.
- **Welcome.md** social-network demo curated with 18 verified iconic public posts (Elon Musk's "the bird is freed", Jack Dorsey's first tweet, Bella Poarch's most-liked TikTok, NASA on Facebook, world-record Egg on Instagram, Bill Gates on Reddit, …).
- "Show Welcome.md" entry at the bottom of the File menu so first-timers can replay the tour.
- Source-view content centered to a comfortable 80-column measure to match preview's prose width.
- Submenus open as a horizontal 3-column grid via `createPortal` to escape parent `overflow:auto`.

### Changed
- `package.json` declares `license: "MIT"`.
- Insert menu reorganized: "Insert anything…" is the headline entry; categorical sub-menus stay under "Or pick a specific block".
- LinkedIn embed regex now also matches the regular `linkedin.com/posts/…activity-{id}-…` URL; EmbedBlock converts to the embed-share form internally.
- Figma embed regex now also matches `figma.com/community/file/…` URLs.

### Removed
- `node_modules_bad/` directory (19k+ files) and its tracked entries.

## [0.1.0] - 2026-04-26

### Added
- Source / Split / Preview / WYSIWYG editor modes (CodeMirror 6 + Milkdown).
- Unified/remark/rehype rendering pipeline with GFM, math (KaTeX), directives, frontmatter.
- Shiki syntax highlighting (VS Code-grade).
- Mermaid, Graphviz (WASM), PlantUML (Kroki), ECharts, Leaflet, abcjs, model-viewer, BibTeX block plugins.
- DataTable for CSV/TSV/JSON-table with auto chart suggestions.
- OPFS workspace with subfolders, autosave, recents.
- Wiki-links and backlinks panel.
- Yjs + WebRTC peer-to-peer collaboration.
- Git sync via isomorphic-git + lightning-fs.
- AES-256-GCM secrets vault with PBKDF2.
- OpenAI streaming chat + BM25+ neural search Web Worker.
- i18n (English + Hebrew) with RTL support.
- Tauri 2 desktop wrapper, Capacitor mobile wrapper, PWA installable.
- Voice dictation, focus mode, onboarding tour, command palette (100+ commands).

[Unreleased]: https://github.com/your-org/lumen/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/lumen/releases/tag/v0.1.0
