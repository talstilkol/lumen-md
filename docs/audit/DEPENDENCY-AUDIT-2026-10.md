# Dependency audit — 2026-10

GitHub reported 142 alerts (5 critical, 64 high) on the default branch.
Dependabot counts one alert per advisory per manifest, so its number is
higher than the per-package `npm audit` counts below. Those counts are
what this pass measured and fixed. Measured with `npm audit` (npm 10.9 /
Node 22) against the public advisory DB on 2026-10-16, branch
`feat/plans-completion`.

## Packages audited

| Package | Lockfile | Notes |
|---|---|---|
| `/` (web app) | yes | main app, Capacitor shell, tooling |
| `sync-server/` | yes | WebSocket relay (prod runtime) |
| `mcp-server/` | yes | MCP stdio server (published CLI) |
| `docs/` | yes | Astro Starlight static site |
| `packages/create-lumen-plugin/` | yes | 0 vulnerabilities, nothing to do |
| `api-server/`, `marketplace-server/` | no deps | `package.json` declares no dependencies; checked with `node --check` |
| `extension/` | no `package.json` | plain JS; checked with `node --check` |
| `edge-workers/*` | no `package.json` | no npm deps; bundled with esbuild as a syntax/type check |

## Before / after

| Package | Before (crit / high / mod / low = total) | After | Commits |
|---|---|---|---|
| `/` | **3 / 18 / 34 / 7 = 62** | **0 / 5 / 2 / 6 = 13** | `b509872`, `46bb5ea`, `bb24133` |
| `sync-server/` | 0 / 1 / 0 / 0 = 1 | 0 / 0 / 0 / 0 = **0** | `2e8b090` |
| `mcp-server/` | 1 / 3 / 3 / 1 = 8 | 0 / 0 / 0 / 0 = **0** | `3864d67` |
| `docs/` | 1 / 10 / 1 / 1 = 13 | 0 / 0 / 10 / 1 = 11 | `a1da375`, `68cd05b` |
| `packages/create-lumen-plugin/` | 0 | 0 | — |
| **Total** | **5 / 32 / 38 / 9 = 84** | **0 / 5 / 12 / 7 = 24** | |

All 5 critical advisories are fixed. 27 of 32 high advisories are fixed,
and the 5 that remain are one dev-only build-tool chain (see below).

## What changed, per package

### Root (`/`)

1. **`npm audit fix`** (lockfile only, all in-range): Capacitor
   android/ios 8.5.3 (critical GHSA-rvm3-566m-v7fv), tar (critical),
   vite 6.4.4, postcss 8.5.30, pdfjs-dist 6.4.299, prosemirror-view
   1.42.6, ws, nanoid, form-data, fast-uri, @xmldom/xmldom,
   browserslist, brace-expansion, source-map-js, dompurify 3.4.17,
   @babel/core, esbuild, and mermaid 11.15 → 11.17.2 (CSS injection,
   prototype pollution and DoS advisories fixed in ≥11.16.1). The
   mermaid bump grows the lazy `vendor-mermaid` chunk to 833 KB gzipped,
   so its budget in `scripts/bundle-budget.mjs` goes from 800 to 860 KB
   (CI runs `npm run budget`).
   *Note:* npm 10.9's `audit fix` crashes on this tree (`Cannot read
   properties of null (reading 'edgesOut')` in arborist). It was run
   with `npx npm@11.6.2 audit fix`. The resulting lockfile installs
   cleanly with `npm ci` on npm 10.
2. **In-range transitive refresh**: `@tiptap/*` 3.22.4 → 3.32.0 (pulled
   by `tldraw`, range `^3.12.1`; high GHSA-cp6q-959q-f8rh /
   GHSA-j95f-988m-3j2f) and `vitest` / `@vitest/*` 4.1.8 → 4.1.12
   (GHSA-82fw-gwwq-j7x9). `audit fix` left a mixed 3.22/3.32 tiptap tree.
   I re-resolved those entries so everything dedupes to 3.32.0.
3. **Raised declared floors** so a fresh resolve can't land on a
   vulnerable version: `@capacitor/{android,cli,core,ios}` → `^8.5.3`,
   `pdfjs-dist` → `^6.4.299`. The **iOS native** dependency is pinned
   separately via SwiftPM (`ios/App/CapApp-SPM/Package.swift`,
   `exact: "8.3.1"`), so the npm bump alone would **not** have patched
   the iOS app. The pin is now `8.5.3` and `Package.resolved` points at
   the 8.5.3 tag revision. Xcode refreshes `originHash` on next open.
   There is no `android/` project in the repo.
4. **echarts 5 → 6.1.0** (semver-major; moderate XSS GHSA-fgmj-fm8m-jvvx).
   Taken because chart options come from user/AI-authored fenced
   blocks. The only consumer (`src/plugins/EChart.tsx`) uses
   `init(el, 'dark', {renderer:'canvas'})`, `setOption(opt,{notMerge:true})`,
   `resize()` and `dispose()`, all unchanged in v6, and the built-in
   `dark` theme is still registered. v6 changes default palette and
   layout, which is visual only. Smoke-tested bar/line/pie via SSR
   render. The gzipped chunk is 370 KB, under its 400 KB budget.

### `sync-server/`

- `ws` `^8.20.1` → `^8.22.0` (supersedes Dependabot #51, which targeted
  8.21.0). This fixes high GHSA-96hv-2xvq-fx4p. y-websocket's nested
  ws 6.x moved to 6.2.6.
- The lockfile was **already out of sync** with `package.json`
  (`y-leveldb ^0.2.0` vs locked 0.1.2), so `npm ci` failed before this
  change. I regenerated it with npm 10, and `npm ci` now passes on both
  npm 10 and npm 11.
- Verified: `node --check` on `server.js` and `persistent-server.js`,
  `/healthz`, and a two-client join + relay round-trip.

### `mcp-server/`

- `npm audit fix` (lockfile only): `@modelcontextprotocol/sdk` 1.32.1,
  proxy-addr (critical IP-spoofing), fast-uri, ip-address,
  body-parser, hono, qs (supersedes Dependabot #49).
- Verified: `npm run build` (tsc) and a stdio `initialize` + `tools/list`
  round-trip.

### `docs/`

- `npm audit fix` moved astro 6.1.9 → 6.4.8 (supersedes Dependabot #50).
- Then **astro 7.4.0 + @astrojs/starlight 0.42.6 + sharp 0.35.5**
  (semver-major). The remaining critical (astro ≤7.2.7: several XSS
  fixes and server-island param replay) and high (sharp: libvips,
  libheif and librsvg CVEs) only have fixes in these majors. docs is a
  static Starlight site with no custom components, so the only
  migration needed was config.
- **The docs site did not build before this audit**, independent of any
  bump. The causes were stale Starlight config syntax (`social` object,
  `label + autogenerate`), a missing `src/content.config.ts`,
  `defaultLocale: "en"` with no `en/` folder, and 14 sidebar slugs
  pointing at pages that don't exist. Fixed in `a1da375`; the build now
  produces 35 pages.

## Remaining items and why they are left

| Package | Advisory | Severity | Why left |
|---|---|---|---|
| `/` | `braces` ≤3.0.3 stack-exhaustion DoS (GHSA-vfj7-8cjw-p6xm) via `micromatch` → `fast-glob` / `chokidar` → **`tailwindcss@3`** | high ×5 (one chain counted 5×) | **Dev/build-time only**: Tailwind 3 uses these to glob `content` paths from our own config. None of it ships to the browser and no untrusted pattern input reaches it. The fix is `tailwindcss@4`, a rewrite (CSS-first config, new PostCSS plugin, `tailwind.config.ts` replaced). That is a separate migration, not a security patch. `braces` has no 3.x fix. |
| `/` | `postcss-selector-parser` <7.1.6 via `postcss-nested` ← `tailwindcss@3` | moderate ×2 | Same chain. It only parses our own CSS at build time. Fix also requires Tailwind 4. |
| `/` | `katex` <0.18.2 "existing prototype pollution can bypass trust restrictions" (GHSA-238p-pmpm-9mq7) plus dependents `rehype-katex`, `remark-math`, `micromark-extension-math`, `@milkdown/plugin-math`, `mermaid` | low ×6 | Precondition is an *already-present* prototype-pollution bug elsewhere, which this advisory does not create. Lumen does not enable KaTeX `trust`. No fix is reachable: `rehype-katex@7` and `mermaid@11` require `katex ^0.16`, and npm suggests a *downgrade* to rehype-katex 1.2.0. Revisit when rehype-katex/mermaid accept katex ≥0.18.2. |
| `docs/` | `postcss-selector-parser` <7.1.6 via `@expressive-code/*` → `postcss-nested` (in Starlight) | moderate ×10 (one chain) | Static-site build-time CSS processing of our own sources. Already on the latest Starlight (0.42.6). npm's suggested "fix" is a *downgrade* to Starlight 0.21.5. Will clear when expressive-code bumps postcss-nested. |
| `docs/` | `esbuild` <0.28.1 dev-server arbitrary file read **on Windows** (GHSA-g7r4-m6w7-qqqr) | low | Dev server only, Windows only, nested in astro 7.4 → vite 8. Not used for the deployed static output. |

## Dependabot PRs from `docs/audit/M10-decisions-needed.md`

| PR | Bump | Status |
|---|---|---|
| #51 | ws 8.20.1 → 8.21.0 (sync-server) | superseded: ws ^8.22.0 |
| #50 | astro 6.1.9 → 6.3.7 (docs) | superseded: astro 7.4.0 |
| #49 | qs 6.15.1 → 6.15.2 (mcp-server) | superseded by `audit fix` |
| #48 | brace-expansion 5.0.5 → 5.0.6 | superseded: root lock now ≥5.0.12 |
| #43 | @babel/plugin-transform-modules-systemjs → 7.29.4 | superseded by root `audit fix` (@babel/* refreshed) |

All five can be closed once this branch lands.

## Verification

| Check | Result |
|---|---|
| root `npx tsc --noEmit` | pass |
| root `npx vitest run --maxWorkers=2` | 161 files / 1371 tests pass |
| root `vite build` | pass |
| `npm run budget` against that build | pass (after mermaid budget 800 → 860) |
| root `npm ci` on npm 10 | pass |
| sync-server `npm ci` (npm 10 and 11), `node --check`, relay smoke | pass |
| mcp-server `npm run build`, stdio smoke | pass |
| docs `npm ci`, `astro build` | pass, 35 pages |
| marketplace-server, extension `node --check`; edge-workers esbuild | pass |

To reproduce the counts, run `npm audit` in each package directory.
