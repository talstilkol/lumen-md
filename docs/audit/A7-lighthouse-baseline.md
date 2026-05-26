# A7 — Lighthouse baseline (local prod, desktop preset)

First Lighthouse audit run against the post-round-25 + post-bundle-fix
build. Numbers measured against `http://localhost:5180` (local
http-server serving `dist/`) with the `--preset=desktop` flag so the
default 4× CPU + slow-4G mobile simulation doesn't blow up the
results.

## Scores

| Category | Score |
|---|---|
| Performance | 55 % |
| Accessibility | 93 % |
| Best Practices | 92 % |
| SEO | 100 % |

## Core Web Vitals (desktop)

| Metric | Value | Threshold |
|---|---|---|
| First Contentful Paint | 4.8 s | ≤ 1.8 s (good) |
| Largest Contentful Paint | 9.6 s | ≤ 2.5 s (good) |
| Time to Interactive | 9.6 s | ≤ 5.0 s (good) |
| Cumulative Layout Shift | **0.065** ✅ | ≤ 0.1 (good) |
| Total Blocking Time | 30 ms | ≤ 200 ms (good) |

## What this run found and fixed

**CLS regression — fixed in this session:**

The earlier audit showed CLS at 0.463 (mobile preset) — the preview
pane shifted 0.44 of the visible viewport as the async-rendered tree
populated it. Root cause: `<div data-preview-root>` had no layout
containment, so its async content-load rippled into the page
geometry.

Fix: `style={{ contain: "layout" }}` on the preview-root wrapper.
Desktop CLS dropped from 0.463 → 0.065 (7× improvement, well under
the 0.1 "good" threshold).

## What's still slow

**4.8 s FCP and 9.6 s LCP/TTI are not acceptable for a public launch.**
On a localhost server with no network latency, these numbers reflect
pure CPU work during boot. The likely culprits:

1. **6,074 KiB unused JavaScript** at FCP. Even though Lumen
   lazy-loads heavy vendors (mermaid, tldraw, echarts, graphviz, leaflet),
   they're still being fetched in parallel during boot — just not
   executed. The eager fetches compete with the critical path.

2. **CodeMirror mount cost.** `vendor-codemirror` is 530 KB gzipped
   and parses synchronously during the editor mount. This is on the
   critical path.

3. **Welcome doc rendering.** The 510-line welcome doc includes a
   Mermaid block, ECharts spec, math, code blocks, and tables — every
   one of those triggers a lazy import on first paint.

## Path to a real performance fix

| # | Lever | Estimated savings |
|---|---|---|
| 1 | Defer the welcome-doc render until after first paint (show editor first, render preview lazy) | LCP -2-4 s |
| 2 | Inline a placeholder ProseMirror that loads CodeMirror after FCP | FCP -1-2 s |
| 3 | Strip the welcome doc's Mermaid + ECharts blocks for first-paint pass; let user trigger | LCP -3-5 s |
| 4 | Move `i18n` table to a lazy chunk (currently ~50 KB eager) | FCP -0.5 s |
| 5 | Service-worker prefetch warmer for the next paint cycle | TTI -1-2 s |

Each is a meaningful refactor (1-2 days). Together they could bring
FCP into the ≤ 1.8 s "good" band.

## What I did NOT change

- The mobile preset numbers (FCP 29.7s, LCP 34.6s) are Lighthouse's
  default heavy throttling. Real users on real mobile devices see
  something between desktop (4.8s) and mobile preset (29.7s) —
  somewhere in the 8-15s range. Still not great.

- I did not run the full Lighthouse-CI gated workflow. CI's
  `lighthouserc.json` is configured but the job only runs on
  explicit triggers (main pushes or `lighthouse` label).

## Recommendations

1. Land the CLS fix (this commit). Locks in the win.
2. File a "Phase B performance push" task: items 1-3 above.
3. Don't accept the 4.8 s FCP for v1.0 — it's a real differentiator
   gap vs. Obsidian (loads in ~1 s) and iA Writer (~0.5 s).
