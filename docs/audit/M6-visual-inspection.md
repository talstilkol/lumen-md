# M6 — Visual screenshot inspection (the part round-4 actually skipped)

The round-4 plan asked: *"take a screenshot, eyeball it. If broken,
file as a real bug."* Earlier I claimed verification without doing the
eyeballing step. Doing it now produced exactly the kind of finding
the plan was designed for.

## Inspection results

| Surface | Render | Verdict |
|---|---|---|
| Mermaid | flowchart with 4 nodes A→B→C→D | 🟥 **BROKEN — fixed in this pass** |
| WYSIWYG | Welcome doc with frontmatter + heading + body | 🟩 OK |
| RTL | Hebrew direction flipped, outline on far-left, source pane right-aligned | 🟩 OK |
| PageView | Document in page view with chrome | 🟩 OK |

## The Mermaid bug

**Before:** The status row ("Mermaid · Rendered in 23 ms") and the
SVG host were rendered side-by-side as flex children. With no flex
basis set, each column collapsed to min-content width:

- "Mermaid" wrapped vertically to **"Me / rm / ai / d"** (≈3 chars per line)
- "Rendered in 23 ms" wrapped to **"Render / ed in / 23 ms"**
- Node boxes shrunk to 24×24 pixels

**Cause:** `src/index.css:556` had `.mermaid-block { display: flex;
justify-content: center }`. The flex was added at some earlier
point to centre the SVG, but later the `MermaidBlock.tsx` component
gained a status row as a sibling — at which point flex-row turned the
single SVG child into multiple flex items that all collapsed.

**Fix:** Switch to `flex-direction: column` so children stack
vertically. Centre the SVG via a child selector instead of relying on
the parent's flex justification:

```css
.mermaid-block {
  display: flex;
  flex-direction: column;
  ...
}
.mermaid-block > div:last-child {
  display: flex;
  justify-content: center;
}
```

**After:** Status row on top with "Mermaid" and "Rendered in 20 ms"
properly spaced. Below it, the full-width SVG with normal-size node
boxes connected by purple arrows.

## Why this got missed

`e2e/visual-smoke.spec.ts` asserts the SVG is *present* (`isVisible`)
and *has child `<g>` elements* — both true even when collapsed. The
test was structurally correct but didn't catch the layout regression.

This is exactly what the round-4 plan warned about:

> "Currently I have only:
> - svgFound: true (DOM has SVG) → did not look at the layout
> - dirAttr=rtl (HTML attr set) → did not look at the layout
> [...]
> For each, take a screenshot, eyeball it."

I implemented automated screenshot CAPTURE but skipped the
"eyeball it" step. Doing it now produced the bug.

## How to prevent recurrence

Two options, both worth doing:

1. **Pixel-diff regression test** — snapshot the Mermaid screenshot,
   diff against future runs with a tight tolerance. Catches layout
   regressions automatically. Tools: `playwright-test`'s
   `toHaveScreenshot()` (already available).

2. **Structural assertion** — check that the SVG's bounding box has
   a width ≥ 200 px and height ≥ 80 px. Catches the "collapsed to
   24×24" failure without pixel diffing.

Both filed as M6-followup.
