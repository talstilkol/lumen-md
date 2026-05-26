# M12 — Bundle-bloat root cause

The round-4 plan flagged: "main bundle grew 0.8 KB" with no
investigation. Across rounds the budget climbed 220 → 225 → 230 KB
reactively. This is the long-overdue analysis.

## Current state (main bundle, gzipped)

- **Budget: 230 KB**
- **Actual: 227.3 KB on macOS, 225.2 KB on Linux CI** (round-25 numbers)
- **Headroom: ~3 KB**

## Composition (raw, pre-minify, via sourcemap)

Total raw source bytes assembled into `main-*.js` = **1,684 KiB**.
Gzip ratio ≈ 7.4× (1684 raw → 227 gzipped).

| Bytes | % | Source |
|---:|---:|---|
| 808,581 | 46.9 % | **FIRST-PARTY (src/)** |
| 277,994 | 16.1 % | `yaml` (frontmatter parser) |
| 275,072 | 16.0 % | `parse5` (HTML parser, used by rehype-raw) |
| 70,037 | 4.1 % | `entities` (HTML entity decoder) |
| 49,995 | 2.9 % | `mdast-util-to-hast` |
| 43,792 | 2.5 % | `lucide-react` (eagerly-imported icons) |
| 23,584 | 1.4 % | `micromark-extension-directive` |
| 19,753 | 1.1 % | `hast-util-to-jsx-runtime` |
| 19,698 | 1.1 % | `hast-util-raw` |
| 17,858 | 1.0 % | `zustand` |
| ~50,186 | 3.0 % | misc smaller (mdast-util-directive, github-slugger, …) |

## Findings

### #1 — first-party is 47 % of the bundle

Largest single category. Most of this is `App.tsx` (40 KB), `useCommands.ts`
(60 KB), `i18n/index.ts` (50 KB+ — 8 languages × 638 keys), and the
renderer pipeline. **Healthy** — this is the actual app.

### #2 — `yaml` (16 %) + `parse5` (16 %) = 32 % of bundle

These are the two largest single-package contributors. Both are
necessary at startup (frontmatter parsing fires on every doc, rehype-raw
needs parse5 to convert HTML inside markdown). **Neither can be
lazy-loaded without breaking first-paint correctness.**

Possible optimizations:
- `yaml` has a smaller "parse-only" build (`yaml/parse`). We use the full
  package. Switching to parse-only could shave 50-80 KB raw (~7-12 KB
  gzipped). **Filed as M12-followup.**
- `parse5` is used by `hast-util-raw`. The rehype-raw plugin is what
  pulls it in. If we don't actually need to embed arbitrary HTML in
  markdown for first-paint, we could lazy-load rehype-raw. **Worth a
  spike** — many docs don't have inline HTML.

### #3 — `lucide-react` at 2.5 %

We use lucide-react liberally for command-palette icons. Vite's
tree-shaking is working (74 source files included, not 1000+), but
each icon is ~600 bytes. Aggressive icon-consolidation could shave
~10 KB.

### #4 — `mdast-util-to-hast` + `hast-util-*` = ~7 %

These are unified.js pipeline components. Hard to remove without
changing the renderer.

## The "0.8 KB growth" mystery

Looking at the per-round budget history:

- Pre-round-3: 220 KB budget
- Round-3: bumped to 222 (no investigation)
- Round-16: bumped to 225 ("react-dom + react merged into one chunk to fix TDZ")
- Round-25: bumped to 230 ("y-websocket externalize keeps an import statement in main + Linux gzip variance")

**Verified contributors:**

- Round-16 merge of `vendor-react-dom` → `vendor-react`: adds ~1-2 KB to main because
  React's runtime helpers move from a separate chunk to main when the boundary collapses.
  Justified by the TDZ fix; alternative was a broken prod build.
- Round-25 `y-websocket` externalize: adds a literal `import("y-websocket")` statement
  to main (~0.2 KB) instead of being tree-shaken when the module isn't found.

**Unverified contributors (pre-round-16):**

- Round-3 220 → 222: no commit message explains it. Most likely first-party
  growth (App.tsx grew as features landed). Acceptable.

## Recommendations

1. **Don't bump the budget reactively without analysis.** If a regression
   hits 232 KB, dig in before bumping. The current 230 ceiling is fair.
2. **Spike: `yaml/parse` vs full `yaml`.** If frontmatter parsing
   doesn't need stringify (we may use it for *writing* frontmatter
   when editing — check), the swap is free. **High-leverage.**
3. **Spike: lazy-load `rehype-raw`.** If docs without inline HTML can
   skip the rehype-raw plugin, parse5 falls out of main → saves ~40 KB
   gzipped. **Highest-leverage.**
4. **Don't worry about lucide-react.** 10 KB savings isn't worth the
   ergonomics hit of one-icon-per-import.

Both spikes (#2, #3) filed as M12-followups.
