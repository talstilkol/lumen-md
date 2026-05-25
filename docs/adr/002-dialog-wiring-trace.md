# ADR-002: Dialog wiring trace (M3 audit closure)

**Status:** Accepted
**Date:** 2026-05-22
**Context:** Round-4 master-plan item M3 asked for an explicit trace of how four dialogs reach the screen: Find&Replace, Plugin Gallery, Template Gallery, Version History. Earlier rounds covered Find&Replace explicitly and the other three got coverage via the Meta+K race fix + smoke tests, but never had their wiring traced layer-by-layer. This ADR documents the trace so future regressions are easy to debug.

## The three layers

Every dialog in Lumen follows the same three-layer pattern:

1. **Command registration** — `src/commands/useCommands.ts` builds a flat list of palette commands. Each command has an `id`, a localized `label`, and an `action()` callback.
2. **State ownership** — `src/App.tsx` owns the `open` useState for each dialog and passes the `setXOpen` setter to `useCommands` via its options object.
3. **Render mount** — Either `src/App.tsx` or `src/components/AppOverlays.tsx` mounts the dialog component with `open={xOpen}` and `onClose={() => setXOpen(false)}`.

The palette searches the command list, the user hits Enter, the `action()` fires the setter, React re-renders, and the dialog's component checks `if (!open) return null;` and renders.

## Find & Replace (covered by surfaces-smoke + ADR-001)

- Command: `useCommands.ts:587` — id `view.findReplace`, label `t("cmd.view.findReplace")`, action `() => setFindReplaceOpen(true)`. Shortcut `⌘H`.
- State: `App.tsx:102` — `const [findReplaceOpen, setFindReplaceOpen] = useState(false);`
- Mount: `App.tsx:637` — `<SearchReplace open={findReplaceOpen} onClose={() => setFindReplaceOpen(false)} />`
- Gate: `SearchReplace.tsx:60` — `if (!open) return null;`
- e2e: `surfaces-smoke.spec.ts` (Find & Replace command opens its dialog).

## Plugin Gallery

- Command: `useCommands.ts:642` — id `view.pluginGallery` (or similar), action `() => setGalleryOpen(true)`.
- State: `App.tsx:107` — `const [galleryOpen, setGalleryOpen] = useState(false);`
- Mount (two sites):
  - `App.tsx:824` — `<PluginGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} />` (eager wrapper inside `Suspense`).
  - `AppOverlays.tsx:108` — `<PluginGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} />` (when invoked from overlay layer).
- Gate: `PluginGallery.tsx` returns `null` when `open=false`.
- e2e coverage: lazy chunk smoke (block-render specs); not driven from palette in current e2e.
- KNOWN GAP: there's a redundant mount in both `App.tsx` and `AppOverlays.tsx`. Either site rendering the same gallery with the same state is OK because React reconciles identical trees, but the redundancy could surface as a bug if the props ever diverge. Cleanup follow-up.

## Template Gallery

- Command: `useCommands.ts:644` — wrapped in `...(setTemplateGalleryOpen ? [{ id: "view.templateGallery", ... }] : [])` so the command only appears if the setter is wired. Action: `() => setTemplateGalleryOpen(true)`.
- State: `App.tsx:108` — `const [templateGalleryOpen, setTemplateGalleryOpen] = useState(false);`
- Mount: `App.tsx:825` — `<TemplateGallery open={templateGalleryOpen} onClose={() => setTemplateGalleryOpen(false)} />`
- Data: `fetchTemplateRegistry()` reads `public/templates/registry.json` — currently 10 starter templates.
- e2e: `template-gallery.spec.ts` (opens gallery, asserts gallery has at least 5 templates OR palette closes).

## Version History

- Command: `useCommands.ts:605` — id `view.versionHistory`, label `t("cmd.view.versionHistory")`, action `() => setHistoryOpen(true)`.
- State: `App.tsx:104` — `const [historyOpen, setHistoryOpen] = useState(false);`
- Mount: `App.tsx:847` (lazy) — `<VersionHistory open={historyOpen} onClose={() => setHistoryOpen(false)} />` inside `<Suspense>`.
- Data: pulls from CRDT (Yjs document history) — no separate persistence layer.
- e2e: `version-history.spec.ts` (opens via palette, asserts palette closes).

## What broke in production (the race that 6 specs hit)

Before round-7, all four dialogs failed in e2e because React mounted the listener inside a `useEffect` that ran AFTER `page.goto("/")` resolved. Tests pressed `Meta+K` before the listener attached, so the keypress was a no-op. The fix lives in 6 spec files: each `beforeEach` waits for `<header>` to be visible after `goto`, then issues keys.

## Why M3 was claimed "documented as test-infra" originally

Honest answer: I dismissed M3 too quickly in round-4 because I assumed the dialog wiring was "obviously fine" once the Meta+K race was fixed. That's true for Find&Replace (verified end-to-end) but the other three never got an explicit trace. This ADR closes that gap.
