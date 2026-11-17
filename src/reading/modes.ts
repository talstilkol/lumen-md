/**
 * The reading modes the "Reading mode" menu offers (plan W13.R1). Each mode
 * names the profile fields it reads (the menu shows them under the mode)
 * and how it opens; its code loads only when it opens. A mode of a later
 * task adds one entry here.
 */
import type { ReadingModeId, ReadingProfile } from "./settings";

export interface ReadingModeDef {
  id: ReadingModeId;
  /** i18n keys (src/i18n/lazy/readingMode.json). */
  label: string;
  hint: string;
  /** Shown with an "experimental" badge and a link to the research. */
  experimental?: { research: string };
  /** The profile fields this mode reads, besides the common ones. */
  fields: Array<keyof ReadingProfile>;
  open: (p: Readonly<ReadingProfile>) => Promise<void>;
}

/** The fields every mode reads (the menu shows them once). */
export const COMMON_FIELDS: Array<keyof ReadingProfile> = ["font", "size", "lineHeight", "width", "spacedHebrew", "dyslexiaLatin", "nikud", "aids", "lineFocus", "tint", "voice", "rate", "anchor"];

export const MODE_DEFS: ReadingModeDef[] = [
  {
    id: "page",
    label: "readingMode.mode.page",
    hint: "readingMode.mode.page.hint",
    fields: ["layout"],
    open: async (p) => {
      if (p.layout === "sideBySide") return (await import("../ai/mt/openSideBySide")).openSideBySide();
      (await import("../epub/ReadingMode")).openReadingMode();
    },
  },
  {
    id: "focus",
    label: "readingMode.mode.focus",
    hint: "readingMode.mode.focus.hint",
    // W13.R2: what stays bright, and readability highlights.
    fields: ["focusUnit", "hemingway"],
    open: async () => {
      window.dispatchEvent(new Event("lumen-open-focus"));
    },
  },
  {
    id: "rsvp",
    label: "readingMode.mode.rsvp",
    hint: "readingMode.mode.rsvp.hint",
    // W13.R3: comprehension falls without look-backs (Schotter, Rayner et al.), hence rewind.
    experimental: { research: "https://www.psychologicalscience.org/news/releases/speed-reading-apps-may-impair-reading-comprehension-by-limiting-ability-to-backtrack.html" },
    fields: ["wpm"],
    open: async (p) => (await import("../ui/RsvpReader")).openRsvpReader(p.wpm),
  },
  {
    id: "immersive",
    label: "readingMode.mode.immersive",
    hint: "readingMode.mode.immersive.hint",
    // W13.R5: parts of speech (tagged on this device), syllables / niqqud, line focus.
    fields: ["pos", "syllables", "lineFocus"],
    open: async (p) => (await import("../ui/ImmersiveReader")).openImmersiveReader(p),
  },
];

export const modeDef = (id: ReadingModeId): ReadingModeDef => MODE_DEFS.find((m) => m.id === id) ?? MODE_DEFS[0];

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
 * W13.R1's Reading mode menu (MODE_DEFS above) is in the same file: each of
 * its modes is a registered entry here (MENU_GATE), so the menu cannot offer
 * a mode the gate does not open. The markers: ./modeRoot.ts.
 */
export interface ReadingModeEntry {
  /** The `data-reading-mode` value of the mode's root. */
  id: string;
  /** The plan item that made it. */
  plan: string;
  /**
   * How it opens: a palette command, the app shortcut, the Reading mode
   * menu (W13.R1: the mode is one of MODE_DEFS, opened with its "Open"
   * button), or — for a view that needs two texts, such as compare — a
   * module of the e2e hooks (src/testing/e2eHooks.ts) the gate calls.
   */
  open: { command: string } | { shortcut: "focusMode" } | { menu: ReadingModeId } | { hook: "reading/openCompare" };
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
  // Registered by INT7 (wave g3): the modes of W13.R2–R9 that the gate did not reach yet.
  { id: "focus-layer", plan: "W13.R2", open: { shortcut: "focusMode" }, close: "Escape", file: "src/ui/FocusLayerBar.tsx" },
  { id: "rsvp", plan: "W13.R3", open: { menu: "rsvp" }, close: "Escape", file: "src/ui/RsvpReader.tsx" },
  { id: "immersive", plan: "W13.R5", open: { menu: "immersive" }, close: "Escape", file: "src/ui/ImmersiveReader.tsx" },
  { id: "book-spread", plan: "W13.R6", open: { command: "reading.bookSpread" }, close: "toggle", preview: true, file: "src/reading/noteSpread.ts" },
  { id: "triple", plan: "W13.R7", open: { command: "view.tripleLinked" }, close: "toggle", file: "src/App.tsx" },
  { id: "compare", plan: "W13.R8", open: { hook: "reading/openCompare" }, close: "Escape", file: "src/reading/CompareView.tsx" },
  { id: "sidenotes", plan: "W13.R9", open: { command: "reading.sidenotes" }, close: "toggle", preview: true, file: "src/reading/sidenotes.ts" },
];

/** The gate's entry for each mode of the Reading mode menu (MODE_DEFS above): page opens the reader, focus the focus mode. */
export const MENU_GATE: Record<ReadingModeId, string> = { page: "reader", focus: "focus", rsvp: "rsvp", immersive: "immersive" };

export const readingModeSelector = (id: string) => `[data-reading-mode="${id}"]`;
