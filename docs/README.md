# Lumen Docs

User-facing documentation for Lumen, built with [Astro Starlight](https://starlight.astro.build/).

## Develop

```bash
cd docs
npm install
npm run dev          # http://localhost:4321
```

## Build

```bash
npm run build        # → dist/
```

Deploy `dist/` to any static host. We point `docs.lumen.app` at Cloudflare
Pages with `npm run build` as the build command.

## Structure

```
docs/
├── astro.config.mjs           # sidebar, locales, integrations
└── src/content/docs/
    ├── index.mdx              # home / hero
    ├── getting-started/       # welcome, quickstart, shortcuts
    ├── editor/                # modes, smart insert, slash menu
    ├── blocks/                # one page per renderer (mermaid, csv, …)
    ├── workspace/             # OPFS, wiki-links, database views, search
    ├── collab/                # webrtc, persistent, encryption
    ├── ai/                    # settings, smart-search, agents, local-llm, mcp
    ├── plugins/               # gallery, templates, web-clipper
    ├── sync/                  # git, cloud, publish
    ├── security/              # vault, privacy
    └── faq.md
```

Hebrew translations live alongside English under each route — the sidebar
config supports both.
