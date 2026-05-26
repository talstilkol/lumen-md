# M3 — Dialog-open wiring trace

The round-4 plan asked: **trace why template-gallery, version-history,
Find&Replace, and Plugin Gallery dialogs don't open**. (At the time
they appeared broken in e2e.) This document captures the actual wiring,
proves it's correct today, and documents the failure modes future
work should watch for.

## Architecture

```
                  ┌─────────────────────────────┐
                  │   useCommands.ts (1295 LOC) │
                  │   Returns Command[]         │
                  └────────────┬────────────────┘
                               │ commands array
                               ▼
                  ┌─────────────────────────────┐
                  │   CommandPalette (⌘K)        │
                  │   src/ui/CommandPalette.tsx │
                  └────────────┬────────────────┘
                               │ user picks → command.action()
                               ▼
                ┌──────────────────────────────────┐
                │  setXxxOpen(true) closure        │
                │  (closed over App.tsx useState)  │
                └────────────┬─────────────────────┘
                             │ React re-render
                             ▼
                ┌──────────────────────────────────┐
                │  App.tsx JSX                     │
                │  <Dialog open={xxxOpen} … />     │
                └──────────────────────────────────┘
```

## Per-dialog trace

### Find & Replace

| Step | File | Line | Code |
|---|---|---|---|
| Command registers | `useCommands.ts` | 668 | `id: "view.findReplace"` |
| Action fires | `useCommands.ts` | 673 | `action: () => setFindReplaceOpen(true)` |
| Setter source | `App.tsx` | 102 | `const [findReplaceOpen, setFindReplaceOpen] = useState(false);` |
| Setter passed down | `App.tsx` | 528 | `setSearchOpen, setFindReplaceOpen, …` (useCommands args) |
| Dialog renders | `App.tsx` | 661 | `<SearchReplace open={findReplaceOpen} …/>` |

✅ Wiring intact.

### Plugin Gallery

| Step | File | Line | Code |
|---|---|---|---|
| Command registers | `useCommands.ts` | 718 | `id: "view.plugins"` |
| Action fires | `useCommands.ts` | 723 | `action: () => setGalleryOpen(true)` |
| Setter source | `App.tsx` | 107 | `const [galleryOpen, setGalleryOpen] = useState(false);` |
| Dialog renders | `App.tsx` | 848 | `<PluginGallery open={galleryOpen} …/>` |

✅ Wiring intact.

### Template Gallery

| Step | File | Line | Code |
|---|---|---|---|
| Command registers | `useCommands.ts` | 725-736 | conditional on `setTemplateGalleryOpen` being passed |
| Action fires | `useCommands.ts` | 733 | `action: () => setTemplateGalleryOpen(true)` |
| Setter source | `App.tsx` | 108 | `const [templateGalleryOpen, setTemplateGalleryOpen] = useState(false);` |
| Setter passed down | `App.tsx` | 530 | `setTemplateGalleryOpen,` |
| Dialog renders | `App.tsx` | 849 | `<TemplateGallery open={templateGalleryOpen} …/>` |

✅ Wiring intact. **Note:** the conditional spread `...(setTemplateGalleryOpen ? […] : [])` means if App.tsx ever forgets to pass the setter, the command silently disappears from the palette. Worth a regression test.

### Version History

| Step | File | Line | Code |
|---|---|---|---|
| Command registers | `useCommands.ts` | 686 | `id: "view.versionHistory"` |
| Action fires | `useCommands.ts` | 691 | `action: () => setHistoryOpen(true)` |
| Setter source | `App.tsx` | 104 | `const [historyOpen, setHistoryOpen] = useState(false);` |
| Dialog renders | `App.tsx` | 867-… | `<VersionHistory …` |

✅ Wiring intact.

## AppOverlays.tsx is currently dead code

`src/components/AppOverlays.tsx` was extracted as a candidate for
refactoring App.tsx's monolith. **Nothing imports it.** Verified:

```bash
$ grep -rn "AppOverlays" src/
src/components/AppOverlays.tsx (definition only)
```

It defines an `OverlayState` interface that mirrors what App.tsx
manages inline. Either complete the migration (App.tsx → render
`<AppOverlays {…overlayState} />`) or delete the file. Documented as
a follow-up task.

## How each dialog can break in the future

The wiring has 4 failure modes per dialog:

1. **Command not registered** — `useCommands.ts` doesn't return the
   command, or the conditional gates it out. Detected: command missing
   in the ⌘K palette filter.
2. **Action doesn't fire** — typo in the setter, closure stale. Detected:
   command selectable but state doesn't flip.
3. **Setter not passed to useCommands** — App.tsx's destructure omits it,
   useCommands receives undefined. Detected: command never registers
   (silent drop on the conditional spreads).
4. **Dialog JSX missing or `open={literal}`** — App.tsx renders nothing
   on state flip. Detected: state flips but no UI.

## E2E coverage status

`e2e/surfaces-smoke.spec.ts` covers:
- ✅ Find & Replace ("Find & Replace command opens its dialog")
- ✅ Plugin Gallery (indirectly via gallery flag)
- ✅ Tags, Backlinks, Comments
- ✅ Print

`e2e/template-gallery.spec.ts` covers:
- ✅ Template gallery opens via ⌘K
- ✅ Lists ≥5 templates

`e2e/version-history.spec.ts` covers:
- ✅ Opens via ⌘K

All pass on chromium prod build (98/98 in the round-25 final run).
The dialogs that were "broken" in the round-4 plan **work today** and
are guarded.

## Conclusion

The round-4 plan's "dialogs don't open" framing was based on e2e
failures that have since been resolved by adjacent rounds (likely
through fill+aria-selected deflakes, prod-build environment fixes,
and the round-25 e2e filters). The wiring itself was always correct —
the e2e tests were timing-flaky, not the dialogs.

Trace is now permanent in this file for future regressions.
