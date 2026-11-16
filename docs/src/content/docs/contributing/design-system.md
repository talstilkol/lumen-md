---
title: Design system
description: Lumen's tokens for colour, space, radius, type, elevation and motion, the rules the code is held to, and the shared components.
---

Every surface of Lumen draws from one set of tokens. They are CSS custom
properties in `src/index.css`, so dark mode, the theme presets (Settings →
Theme) and *reduce motion* change them in one place. Inline styles use them
through `src/ui/tokens.ts`.

## Tokens

| Group | Tokens | Use |
|---|---|---|
| Surfaces and text | `--bg`, `--bg-subtle`, `--bg-muted`, `--bg-inset`, `--fg`, `--fg-subtle`, `--fg-muted`, `--border`, `--border-strong`, `--accent`, `--accent-fg` | HSL triplets: `hsl(var(--bg))`, `hsl(var(--accent) / 0.15)` |
| Status | `--danger`, `--success`, `--warning`, `--info` | errors and destructive actions, confirmations, cautions, information; tuned for light and dark |
| Gradients | `--gradient-brand`, `--gradient-ai`, `--gradient-success` | the logo, the AI button, progress — decoration only |
| Behind a modal | `--overlay` | every dialog backdrop |
| Elevation | `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`, `--shadow-accent` | badges, popovers, menus, dialogs; the accent glow |
| Space | `--space-1` … `--space-8` (4 px steps) | padding and gaps |
| Radius | `--radius-sm` 4, `--radius-md` 6, `--radius-lg` 10, `--radius-full` | |
| Type | `--text-xs` 11 … `--text-xl` 18 px | |
| Motion | `--duration-fast` 100 ms, `--duration-base` 250 ms, `--duration-slow` 350 ms; `--ease-out`, `--ease-in-out` | menus and hovers; dialogs and toasts; panels |

In TypeScript: `color.danger`, `color.tint("danger", 0.1)`, `shadow.lg`,
`transition(["opacity"], "base")`, `enter("cmdSlideIn")`. A `<canvas>`
cannot read `var()`: use `resolvedColor("fg", 0.15)` when drawing.

## Rules

1. **No hard-coded colour in the interface** — no hex, `rgb()` or `hsl()`
   with numbers in `src/ui`, nor in the other folders that draw dialogs,
   panels and blocks (`COLOR_SCOPE` in `scripts/check-design.mjs`: sign-in,
   sync, backup, tasks, views, plugins, and more). Colours a person picks
   for their content (the note colours of the canvas) are content, and so
   is a QR code, which stays black on white for the camera; both are marked
   `design-allow`.
2. **Only `transform` and `opacity` move**, with the three durations.
   Nothing animates width, height, top/left or margins: a progress bar
   scales (`transform: scaleX()`), a menu slides (`translateY`), a hover
   changes colour instantly.
3. **Reduce motion is respected everywhere**: with the system setting on,
   the duration tokens become 0 and a global rule cuts every remaining
   animation.
4. **Logical sides**: `marginInlineStart`, `insetInlineEnd`, `textAlign:
   "start"` — a surface mirrors in Hebrew by itself. Viewport coordinates
   from `getBoundingClientRect()` stay physical.
5. **A modal backdrop is `var(--overlay)`; a shadow is a step of the scale.**

`npm run design:check` runs both gates: `scripts/check-design.mjs` (rules
1 on the interface folders, rule 2 on all of `src/ui`, and no layout
animation anywhere in `src`) and `scripts/design-audit.mjs`, which runs the
checklist (rules 1, 2, 4, 5) on the 43 surfaces listed in
`scripts/design-surfaces.json`. A bare name there is `src/ui/<name>.tsx`; a
name with a folder, such as `sync/cloud/ConflictDialog`, is a surface outside
`src/ui`. A real exception is
marked `design-allow: <reason>` in the code.

## Component library

Build a new surface from these parts before writing a new one. Each row names
the export and its file; `src/__tests__/designLibrary.test.ts` fails when a
row names something that is not exported there, and when a component that
many surfaces import is missing from this table.

| Component | Import | For | Behaviour you get |
|---|---|---|---|
| `Modal` | `src/ui/Modal.tsx` | every modal dialog | a native `<dialog>` in the top layer; the rest of the page inert; Tab stays inside; Escape (and the Android back gesture) calls `onClose`; focus goes back to the opener; `closedBy="none"` while it works; `embedded` for a tab inside another surface. Needs `aria-label` or `aria-labelledby`. Only this element may set `aria-modal` (the `lumen/modal-only` lint rule) |
| `uiAlert`, `uiConfirm`, `uiPrompt`, `uiSelect` | `src/ui/PromptDialog.tsx` | every question, confirmation and short input | promise-based (`await uiConfirm({ message })`), built on `Modal`; `password: true` for a secret, `choices` for a list. Never `window.confirm` / `prompt` |
| `EmptyState` | `src/ui/EmptyState.tsx` | a panel with nothing in it | one sentence on why it is empty and one required `action` out of it (`runCommand(id)`, `learnHow(topic)`); `role="status"`. `scripts/check-empty-states.mjs` fails an empty string rendered without it |
| `HelpButton`, `openHelp` | `src/ui/HelpButton.tsx` | the “?” next to a setting or a panel title | opens the in-app help on a topic; `openHelp(topic)` from code |
| `showAiToast` | `src/ui/AiToast.tsx` | a short message that does not need an answer | `info` / `success` / `error`; one optional `action` (an Undo) and a `learnMoreUrl`; errors read out at once (`role="alert"`), the rest politely (`role="status"`) |
| `ErrorBoundary` | `src/ui/ErrorBoundary.tsx` | around a surface that can fail on its own | shows its `fallback`, or by default the recovery actions (`ErrorActions`), instead of a white screen |
| `CommandPalette`, `Command` | `src/ui/CommandPalette.tsx` | every action the app has | an action is a command first (an id, a title, a shortcut); menus and buttons call the same command |
| `cmdIcons` | `src/ui/cmdIcons.ts` | the icon of a command | one icon per command, the same in the palette, the menus and the toolbar |
| `useFocusTrap` | `src/ui/useFocusTrap.ts` | a non-modal surface that still holds focus (a popover) | Tab cycles inside, Escape, focus restore; `Modal` already uses it |
| `color`, `shadow`, `space`, `radius`, `text`, `transition`, `enter`, `resolvedColor` | `src/ui/tokens.ts` | inline styles | the tokens above as TypeScript; `transition()` accepts only `transform` and `opacity` |
| `.icon-btn` | `src/index.css` | a toolbar or panel button with only an icon | the hover, focus ring and size of every icon button; give it an `aria-label` |
| `.cmd-palette-backdrop`, `.cmd-palette` | `src/ui/CommandPalette.css` | the frame of a large panel (trash, AI doctor) | the overlay colour, elevation and enter motion of the palette |
| `toast` | `src/store/useToastStore.ts` | a toast from a store or a non-React module | the same toasts as `showAiToast`, through the store |

### Using them together

```tsx
import { Modal } from "../ui/Modal";
import { EmptyState, runCommand } from "../ui/EmptyState";
import { HelpButton } from "../ui/HelpButton";
import { uiConfirm } from "../ui/PromptDialog";
import { color, space } from "../ui/tokens";

<Modal aria-labelledby="trash-title" onClose={close}>
  <h2 id="trash-title">{t("trash.title")} <HelpButton topic="trash" /></h2>
  {items.length === 0 ? (
    <EmptyState message={t("trash.empty")} action={{ label: t("trash.openFiles"), onClick: () => runCommand("files.open") }} />
  ) : (
    <ul style={{ padding: space[3], color: color.fg }}>…</ul>
  )}
  <button className="icon-btn" aria-label={t("trash.emptyAll")} onClick={async () => (await uiConfirm({ message: t("trash.confirmEmpty") })) && emptyAll()} />
</Modal>
```

A new shared component gets a row here, in English and in Hebrew, in the same
change.
