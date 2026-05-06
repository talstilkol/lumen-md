# ADR-001: Safe initialization lifecycle for editor blocks and plugins

**Status:** Accepted
**Date:** 2026-05-06
**Deciders:** Lumen core (renderer + editor extensions)

## Context

A UI sweep surfaced four bugs. Three were variants of the same root cause — **a child component initializes before its host is ready**:

| Bug | Symptom | Root cause |
|---|---|---|
| #1 [src/editor/lintExtension.ts](../../src/editor/lintExtension.ts) | "Calls to EditorView.update are not allowed" spam | `view.dispatch()` called from a `ViewPlugin` constructor (host is still mid-update) |
| #2 [src/layouts/EditorLayout.tsx](../../src/layouts/EditorLayout.tsx) | Source pane blank on first launch | `useMemo` captured `docContent` before async store hydration; never re-ran |
| #3 [src/plugins/EChart.tsx](../../src/plugins/EChart.tsx) | "Can't get DOM width or height" + occasional `BlockErrorBoundary` fallback | `echarts.init()` called when host element is `0×0` (lazy/suspended/hidden) |

Each was fixed locally. Without a documented convention, the next contributor adding a block, ViewPlugin, or editor-host will hit the same trap.

The forces:
- The renderer mounts blocks lazily through `React.lazy` + Suspense → host DOM may be `0×0` when the child mounts.
- CodeMirror's `ViewPlugin.fromClass` constructor runs *inside* a view update.
- Zustand `persist` middleware hydrates synchronously from `localStorage`, but welcome-doc seeding runs in an `useEffect`, one tick after first paint. Memos that close over store values without depending on them go stale.

A pre-decision audit of the 17 block plugins found that **only EChart genuinely needs the deferred-init pattern**:
- Mermaid, Graphviz, PlantUML inject SVG strings — no init-time size dependency.
- Model3D delegates rendering to a self-sizing `<model-viewer>` web component.
- AbcBlock uses abcjs's own `responsive: "resize"` mode.

Extracting a shared `useDeferredCanvas` helper for one consumer would be over-engineering. The pattern lives inline in `EChart.tsx` as the canonical reference.

## Decision

Three documented conventions, no shared abstraction:

1. **External libraries that imperatively render into a `ref`-attached DOM element** (`echarts.init`, `abc.renderAbc`, etc.) must defer init until the container has nonzero size, using a `ResizeObserver`-driven `ensureChart()`-style pattern. See `EChart.tsx` for the reference implementation.
2. **CodeMirror `ViewPlugin` constructors** must defer any `view.dispatch(...)` to a `setTimeout(0)` callback — the constructor itself runs inside CM6's update cycle, where dispatching is forbidden. See `lintExtension.ts:60` for the canonical example.
3. **Editor-host components that forward live store values to controlled children** must NOT memoize those values without depending on them. The Editor's internal sync effect already early-returns when `current === value`, so passing the live value on every render is correct and bounded.

Each convention is documented inline in the relevant source files via top-of-file comments and cross-references.

## Options Considered

### Option A: Hand-roll per-block (status quo before this week)
- Pros: No abstraction; each block uses whatever lifecycle it wants.
- Cons: Three bugs in 17 blocks suggests ~18% defect rate from this class. Each fix is invisible to the next author.

### Option B: Shared `useDeferredCanvas` helper + parent-prop forwarding rule
- Pros: Single owner of the "wait for size, then init, then setOption" dance.
- Cons: Audit shows only 1 consumer. Premature for the current block surface.

### Option C: Suspense-boundary-aware plugin contract
- Pros: Declarative; blocks state their requirements and the runtime honors them.
- Cons: Overkill for 17 blocks. Designs a system we don't yet have.

### Option D — Chosen: Documented convention, no shared abstraction
- Pros: Zero new code surface. The `EChart.tsx` reference implementation is the documentation. Plugin authors and CM6 contributors discover the convention via top-of-file comments at the natural entry points.
- Cons: Discipline-based, not enforced. Mitigated by regression tests pinning the three behaviors.

## Trade-off Analysis

The audit collapsed Option B's case: extracting a helper for one consumer is more abstraction than the codebase needs. Option C would design a system we don't have. Option D — convention + regression tests — captures the lesson without paying the abstraction tax. If a 5th canvas-style block lands later (or user-installable plugins arrive), revisit Option B retroactively.

## Consequences

What becomes easier:
- Adding a new chart/canvas block — read the comment in `pluginSystem.ts`, copy the pattern from `EChart.tsx`'s `ensureChart`.
- Code review — a clear convention to point at when reviewing new blocks or ViewPlugins.
- Tests — three regression tests pin the three behaviors; future regressions are caught at CI.

What becomes harder:
- Nothing structurally. The convention is additive.

What we'll need to revisit:
- If we add a 5th canvas-style block, extract the helper retroactively.
- If we ever swap CodeMirror for ProseMirror, the lint-plugin convention disappears (or becomes a different convention). The ADR is dependent on CM6 being our editor base.
- Reconsider Option C if blocks grow past ~30 or if user-installable plugins land.

## Action Items

1. [x] Document the deferred-init convention as a `// PLUGIN AUTHORS:` block in [src/plugins/pluginSystem.ts](../../src/plugins/pluginSystem.ts), pointing at `EChart.tsx`'s `ensureChart` as the reference.
2. [x] Document the CM6 dispatch convention as a `// CM6 AUTHORS:` block in [src/editor/Editor.tsx](../../src/editor/Editor.tsx), cross-referencing `lintExtension.ts` as the canonical example.
3. [x] Tighten the prop comment in [src/layouts/EditorLayout.tsx](../../src/layouts/EditorLayout.tsx) to explicitly forbid memoizing live store values without depending on them.
4. [x] Add three regression tests (one per bug class):
   - Lint extension constructor doesn't throw on mount.
   - EChart inside a 0×0 container doesn't warn until resized.
   - EditorLayout passes hydrated content into `value` after async store update.

## Dropped from earlier drafts

The first draft of this ADR proposed extracting a shared `useDeferredCanvas(ref, initFn, deps)` helper and migrating Mermaid / Graphviz / PlantUML / Model3D / Abc to it. A per-file audit before finalization showed those five blocks don't need the pattern. Helper extraction has been deferred until a second consumer exists.
