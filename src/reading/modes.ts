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
export const COMMON_FIELDS: Array<keyof ReadingProfile> = ["font", "size", "lineHeight", "width", "spacedHebrew", "dyslexiaLatin", "nikud", "aids", "lineFocus", "tint", "voice", "rate"];

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
    fields: [],
    open: async () => {
      window.dispatchEvent(new Event("lumen-open-focus"));
    },
  },
];

export const modeDef = (id: ReadingModeId): ReadingModeDef => MODE_DEFS.find((m) => m.id === id) ?? MODE_DEFS[0];
