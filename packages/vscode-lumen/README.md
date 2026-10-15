# Lumen Markdown Preview for VS Code

Preview Markdown the way [Lumen](../../README.md) renders it, without leaving VS Code.

**Lumen: Open Preview** (`Ctrl+Alt+L` / `Cmd+Alt+L`, the preview icon in the editor title bar, or the Command Palette) opens a live preview beside the active Markdown file. The preview updates as you type and follows you when you switch to another Markdown file.

## What renders

| Feature | Support |
|---|---|
| GitHub-flavoured Markdown (tables, task lists, strikethrough, autolinks, footnotes) | Full |
| Math: `$inline$` and `$$display$$` | Full, via KaTeX (rendered in the extension, fonts bundled) |
| ` ```mermaid ` diagrams | Full, via a bundled Mermaid that follows the light or dark theme |
| Callouts: `:::note` / `tip` / `info` / `warning` / `danger` (with `{title="…"}`) | Full, with the same colours as Lumen |
| GitHub alerts: `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` | Shown as Lumen callouts |
| `:::columns`, `[[wikilinks]]`, soft line breaks, heading anchors, YAML frontmatter (hidden) | Same as Lumen |
| Lumen's interactive blocks (` ```chart `, ` ```csv `, ` ```map `, ` ```live-js `/`python`/`sql`/`lua`, …) | Shown as labelled source code. Open the file in Lumen to use them |
| Raw HTML inside Markdown | Removed (see Security) |
| Syntax highlighting inside code blocks | Not yet. Code is shown in a monospace block |

## How it reuses Lumen's renderer

Lumen's app pipeline (`src/renderer/pipeline.ts`) ends in React components and Shiki, and most of its blocks are interactive browser widgets. That is too heavy for a webview that only needs static HTML.

The extension instead imports Lumen's **Markdown dialect** directly from `src/renderer/remarkLumen.ts`: the remark plugins for callouts, columns, wikilinks, line breaks and frontmatter. It runs them through the same unified chain as the app (remark-gfm, remark-math, remark-directive, remark-rehype, rehype-slug, rehype-katex) and serializes the result with `hast-util-to-html`. A change to that dialect in Lumen therefore shows up in the extension on the next build.

`src/render.ts` contains the whole Markdown-to-HTML step and has no `vscode` dependency, so it can be unit-tested in plain Node.

## Security

The webview runs under a strict Content Security Policy: `default-src 'none'`, scripts limited to one nonce'd bundled file, and styles, fonts and images limited to the extension's own files (plus `https:` and `data:` images). No CDN is used.

Raw HTML in the Markdown source is dropped before rendering. Mermaid runs with `securityLevel: "strict"`.

## Build and develop

From the repository root (the extension bundles dependencies from the root `node_modules`):

```bash
npm install                                   # once, at the repo root
cd packages/vscode-lumen
npm install --no-save @types/vscode@1.85.0    # only for `npm run typecheck`
node build.mjs                                # → dist/extension.js, media/preview.js, media/katex/
```

To try it, open `packages/vscode-lumen` in VS Code and press `F5` (Run Extension), or package a `.vsix` with `npx @vscode/vsce package --no-dependencies`.

Tests live in `test/render.test.ts` and run with the root suite (`npx vitest run vscodeLumen`).

The extension is **not published** to the Marketplace.

## Layout

```
src/extension.ts   extension host: command, webview panel, live re-render
src/render.ts      Markdown → HTML (shared Lumen dialect) + webview document/CSP
src/webview.ts     webview script: renders pre.mermaid with bundled Mermaid
media/preview.css  preview styles (VS Code theme variables + Lumen callouts)
build.mjs          esbuild bundling + KaTeX CSS/fonts copy
```
