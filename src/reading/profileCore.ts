/**
 * The stored reading options (`lumen-reading` in localStorage: the global
 * profile and the per-note overrides on this device), read and written raw.
 * Tiny on purpose (review 13 H2): the preview's margins switch and a note's
 * book-pages place are in the startup bundle and need two fields, not the
 * whole of ./settings.ts with its faces and aids. ./settings.ts validates
 * and normalises on top of this; the startup callers read their own fields
 * defensively.
 */
import type { ReadingProfile } from "./settings";

export const READING_KEY = "lumen-reading";
export const READING_CHANGED = "lumen-reading-changed";

export interface StoredReading {
  /** The global settings (and, plan W13.R1, the global reading profile's other fields). */
  global?: Partial<ReadingProfile>;
  /** Per-note overrides kept on this device only, by workspace path — sparse: only the keys the note changes. */
  notes?: Record<string, Partial<ReadingProfile>>;
}

/**
 * A note's reading place (W13.R6): kept on this device, per note, never in
 * the file and never in the global profile (review 13 M6).
 */
export const PLACE_KEYS = ["spread", "spreadMode", "spreadDir", "spreadBlock", "spreadTop"] as const satisfies ReadonlyArray<keyof ReadingProfile>;

export function readStored(): StoredReading {
  try {
    const raw = localStorage.getItem(READING_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as StoredReading) : {};
  } catch {
    return {};
  }
}

export function writeStored(s: StoredReading): void {
  try {
    localStorage.setItem(READING_KEY, JSON.stringify(s));
  } catch {
    // why: storage is blocked or full (private mode, quota): the setting holds for this session only
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(READING_CHANGED));
}

/** Set some keys of the global profile, leaving the others as stored. */
export function patchGlobal(patch: Partial<ReadingProfile>): void {
  const s = readStored();
  writeStored({ ...s, global: { ...(s.global ?? {}), ...patch } });
}
