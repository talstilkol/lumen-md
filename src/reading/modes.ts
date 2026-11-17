/**
 * Every reading mode, registered once (W13.R13). The reading-modes gate
 * (e2e/reading-modes.spec.ts) opens each one, in Hebrew (RTL) and in English
 * (LTR), and checks: axe clean, reachable and closable by keyboard, no
 * network request, the note's file unchanged (hash), and the reading
 * position (the cursor in the note) kept.
 *
 * A mode's root carries `data-reading-mode="<id>"`. The unit gate
 * (src/__tests__/readingModesGate.test.ts) fails when a root in the code has
 * an id that is not registered here, or an entry here has no root or no
 * command — so a new mode cannot ship around the gate.
 *
 * W13.R1's ReadingProfile can list its modes from here (it owns the profile
 * schema; this module only names the modes and how the gate reaches them).
 */
export interface ReadingModeEntry {
  /** The `data-reading-mode` value of the mode's root. */
  id: string;
  /** The plan item that made it. */
  plan: string;
  /** How it opens: a palette command, or the app shortcut. */
  open: { command: string } | { shortcut: "focusMode" };
  /** How it closes: Escape, or the same command again (a toggle). */
  close: "Escape" | "toggle";
  /** It shows in the preview pane (the gate switches to preview first). */
  preview?: boolean;
  /** It needs the note to be a vault file (it reads the vault). */
  vault?: boolean;
  /** The file that renders its root (the unit gate checks it carries the id). */
  file: string;
}

export const READING_MODES: readonly ReadingModeEntry[] = [
  { id: "focus", plan: "W5.6", open: { shortcut: "focusMode" }, close: "Escape", file: "src/ui/FocusMode.tsx" },
  { id: "reader", plan: "W1.14", open: { command: "view.reading" }, close: "Escape", file: "src/epub/ReadingMode.tsx" },
  { id: "reading-aids", plan: "W5.6", open: { command: "reading.aids" }, close: "Escape", file: "src/ui/ReadingAids.tsx" },
  { id: "page-view", plan: "W13.R10", open: { command: "view.pageView" }, close: "toggle", preview: true, file: "src/ui/PagedPreview.tsx" },
  { id: "side-by-side", plan: "W12.H6", open: { command: "view.sideBySide" }, close: "Escape", vault: true, file: "src/ai/mt/openSideBySide.tsx" },
  { id: "daf", plan: "W13.R11", open: { command: "view.daf" }, close: "Escape", file: "src/reading/daf/openDaf.tsx" },
  { id: "bilingual", plan: "W13.R12", open: { command: "view.bilingual" }, close: "Escape", file: "src/reading/bilingual/openBilingual.tsx" },
];

export const readingModeSelector = (id: string) => `[data-reading-mode="${id}"]`;
