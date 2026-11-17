/**
 * Reading options (plan W3.5): the face, size, line height and column
 * width of the preview, for all notes or for one note, and two aids — a
 * dyslexia-friendly face for Latin text and a spaced layout for Hebrew.
 *
 * Settings live in localStorage (`lumen-reading`): one global set, and
 * per-note overrides keyed by the note's workspace path. A note is never
 * rewritten to store them. They reach the page as CSS custom properties on
 * <html> (index.css, `.prose-lumen`), and the chosen faces are downloaded
 * then (./fonts.ts) — never at startup unless chosen.
 */
import { DYSLEXIA_FONT, HEBREW_FONTS, loadReadingFont, type ReadingFont, type ReadingFontId } from "./fonts";
import { loadAids, AIDS_KEY, AIDS_TINTS, AIDS_LIMITS, type AidsTint } from "./readingAids";
import { READING_KEY, readStored, writeStored } from "./profileCore";

export interface ReadingSettings {
  font: ReadingFontId;
  /** Preview body size in px. */
  size: number;
  /** Unitless line height. */
  lineHeight: number;
  /** Column width in `ch`. */
  width: number;
  /** OpenDyslexic for Latin text (Hebrew keeps its face). */
  dyslexiaLatin: boolean;
  /** Wider word and letter spacing and taller lines, for Hebrew. */
  spacedHebrew: boolean;
}

export const READING_LIMITS = {
  size: { min: 14, max: 28, step: 1 },
  lineHeight: { min: 1.3, max: 2.4, step: 0.05 },
  width: { min: 40, max: 120, step: 2 },
} as const;

export const DEFAULT_READING: Readonly<ReadingSettings> = Object.freeze({
  font: "default",
  size: 17,
  lineHeight: 1.7,
  width: 72,
  dyslexiaLatin: false,
  spacedHebrew: false,
});

const FONT_IDS = new Set<string>(["default", ...HEBREW_FONTS.map((f) => f.id)]);

const TYPO_KEYS = ["font", "size", "lineHeight", "width", "dyslexiaLatin", "spacedHebrew"] as const;
const hasTypography = (v: Partial<ReadingProfile> | undefined) => !!v && TYPO_KEYS.some((k) => k in v);

const clamp = (n: unknown, { min, max }: { min: number; max: number }, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d);

/** Any stored value made valid (unknown face → default, numbers clamped). */
export function normalize(v: Partial<ReadingSettings> | undefined, base: Readonly<ReadingSettings> = DEFAULT_READING): ReadingSettings {
  const s = v ?? {};
  return {
    font: typeof s.font === "string" && FONT_IDS.has(s.font) ? s.font : base.font,
    size: clamp(s.size, READING_LIMITS.size, base.size),
    lineHeight: clamp(s.lineHeight, READING_LIMITS.lineHeight, base.lineHeight),
    width: clamp(s.width, READING_LIMITS.width, base.width),
    dyslexiaLatin: typeof s.dyslexiaLatin === "boolean" ? s.dyslexiaLatin : base.dyslexiaLatin,
    spacedHebrew: typeof s.spacedHebrew === "boolean" ? s.spacedHebrew : base.spacedHebrew,
  };
}

const read = readStored;
const write = writeStored;

export function globalReading(): ReadingSettings {
  return normalize(read().global);
}

/** The note's own settings, or null when it follows the global ones. */
export function noteReading(path: string | null | undefined): ReadingSettings | null {
  if (!path) return null;
  const own = read().notes?.[path];
  return hasTypography(own) ? normalize(own, globalReading()) : null;
}

/** What the note shows: its own settings, else the global ones. */
export function effectiveReading(path: string | null | undefined): ReadingSettings {
  return noteReading(path) ?? globalReading();
}

export function saveGlobalReading(v: ReadingSettings): void {
  const s = read();
  write({ ...s, global: { ...s.global, ...normalize(v) } });
}

export function saveNoteReading(path: string, v: ReadingSettings | null): void {
  const s = read();
  const notes = { ...(s.notes ?? {}) };
  // The note's other profile fields (plan W13.R1) stay; only the typography is replaced or dropped.
  const rest: Partial<ReadingProfile> = { ...notes[path] };
  for (const k of TYPO_KEYS) delete rest[k];
  const next = v ? { ...rest, ...normalize(v) } : rest;
  if (Object.keys(next).length) notes[path] = next;
  else delete notes[path];
  write({ ...s, notes });
}

/** A renamed or moved note — or every note of a moved folder — keeps its settings. */
export function moveNoteReading(from: string, to: string): void {
  const s = read();
  if (!s.notes) return;
  let moved = false;
  const notes: Record<string, Partial<ReadingProfile>> = {};
  for (const [path, v] of Object.entries(s.notes)) {
    const next = path === from ? to : path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
    if (next !== path) moved = true;
    notes[next] = v;
  }
  if (moved) write({ ...s, notes });
}

/** Has the person ever changed a reading option? (App skips loading this module until then.) */
export function hasReadingSettings(): boolean {
  try {
    return localStorage.getItem(READING_KEY) !== null;
  } catch {
    return false;
  }
}

export const READING_VARS = ["--reading-font", "--reading-size", "--reading-line-height", "--reading-width", "--reading-word-spacing", "--reading-letter-spacing"] as const;

/** The CSS custom properties for `s` (`null` = leave the stylesheet's value). */
export function readingVars(s: ReadingSettings): Record<(typeof READING_VARS)[number], string | null> {
  const hebrew = HEBREW_FONTS.find((f) => f.id === s.font);
  const stack: string[] = [];
  if (s.dyslexiaLatin) stack.push(`"${DYSLEXIA_FONT.family}"`);
  if (hebrew) stack.push(`"${hebrew.family}"`);
  const fallback = hebrew?.serif === false ? "var(--font-sans)" : "var(--font-serif)";
  return {
    "--reading-font": stack.length ? `${stack.join(", ")}, ${fallback}` : null,
    "--reading-size": s.size === DEFAULT_READING.size ? null : `${s.size}px`,
    // Spaced Hebrew needs room between the lines for nikud above and below.
    "--reading-line-height": s.spacedHebrew ? String(Math.max(s.lineHeight, 1.9)) : s.lineHeight === DEFAULT_READING.lineHeight ? null : String(s.lineHeight),
    "--reading-width": s.width === DEFAULT_READING.width ? null : `${s.width}ch`,
    "--reading-word-spacing": s.spacedHebrew ? "0.18em" : null,
    "--reading-letter-spacing": s.spacedHebrew ? "0.02em" : null,
  };
}

/** Write `s` to `root` and download the faces it needs. Resolves when they are ready. */
export async function applyReading(s: ReadingSettings, root: HTMLElement = document.documentElement): Promise<boolean> {
  const vars = readingVars(s);
  for (const name of READING_VARS) {
    const v = vars[name];
    if (v === null) root.style.removeProperty(name);
    else root.style.setProperty(name, v);
  }
  const wanted = [HEBREW_FONTS.find((f) => f.id === s.font), s.dyslexiaLatin ? DYSLEXIA_FONT : undefined].filter((f): f is ReadingFont => !!f);
  const ok = await Promise.all(wanted.map((f) => loadReadingFont(f)));
  return ok.every(Boolean);
}

/* ───────────────────────── Reading profile (plan W13.R1) ─────────────────────────
 * One schema for every reading mode of wave 13: the reading options above
 * (W3.5) plus the aids (W5.6), niqqud for display, the layout, the voice and
 * speed, and each mode's own fields. A note's profile is sparse — only the
 * keys it changes — and lives either in its frontmatter (`lumen-reading:`,
 * ./profileStore.ts) or, when the person does not want the file touched, on
 * this device (`notes[path]` above). What a note shows, key by key:
 *
 *     defaults  <  global profile  <  the file's lumen-reading  <  this device's override
 *
 * Modes add fields here, additively: give the field a default, a check in
 * PROFILE_FIELDS, and nothing else changes.
 */

/** The reading modes the profile can open (each one's task in brackets). */
export const READING_MODES = ["page", "focus", "rsvp", "immersive"] as const;
export type ReadingModeId = (typeof READING_MODES)[number];
/** Niqqud for display (W5.6): as the author wrote it, or added by the on-device model — never written to the note. */
export const NIKUD_DISPLAY = ["asWritten", "show"] as const;
export type NikudDisplay = (typeof NIKUD_DISPLAY)[number];
/** Single column, side by side with a translation (W12.H6), or a two-page spread (W13.R6). */
export const READING_LAYOUTS = ["single", "sideBySide", "spread"] as const;
export type ReadingLayout = (typeof READING_LAYOUTS)[number];
/** Focus mode's unit (W13.R2): the line, sentence or paragraph being read stays bright. */
export const FOCUS_UNITS = ["line", "sentence", "paragraph"] as const;
export type FocusUnit = (typeof FOCUS_UNITS)[number];
/** Where a book spread starts (W13.R6; the same values as reading/bookSpread's SpreadMode). */
export const SPREAD_STARTS = ["odd", "even", "none"] as const;
export type SpreadStart = (typeof SPREAD_STARTS)[number];
/** Lines highlighted by line focus (0 = off). */
export const LINE_FOCUS = [0, 1, 3, 5] as const;
export type LineFocusLines = (typeof LINE_FOCUS)[number];

export interface ReadingProfile extends ReadingSettings {
  /** The mode "Reading mode" opens. */
  mode: ReadingModeId;
  nikud: NikudDisplay;
  /** The dyslexia-friendly layout (W5.6). */
  aids: boolean;
  lineFocus: LineFocusLines;
  tint: AidsTint;
  layout: ReadingLayout;
  /** A speechSynthesis voice name ("" = the system's voice for the note's language). */
  voice: string;
  /** Read-aloud speed (SpeechSynthesisUtterance.rate). */
  rate: number;
  /** W13.R2 */
  focusUnit: FocusUnit;
  /** W13.R2: readability highlights (long sentence, passive, adverb, complex word) as a display layer. */
  hemingway: boolean;
  /** W13.R3: RSVP words per minute. */
  wpm: number;
  /** W13.R4: anchor emphasis (experimental, off by default). */
  anchor: boolean;
  /** W13.R5: parts of speech in colour. */
  pos: boolean;
  /** W13.R5: syllables (English) and niqqud as the parallel aid (Hebrew). */
  syllables: boolean;
  /** W13.R9: the margins mode (side notes for footnotes, comments and suggestions). */
  sidenotes: boolean;
  /** W13.R6: the note was left in book pages (kept per note on this device: ./notePlace.ts). */
  spread: boolean;
  /** W13.R6: which page a spread starts on ("odd": page 1 alone, like a printed book). */
  spreadMode: SpreadStart;
  /** W13.R6: page order ("auto": by the note's script). */
  spreadDir: "auto" | "rtl" | "ltr";
  /** W13.R6: the reading place — the first block on the page (-1: none yet). */
  spreadBlock: number;
  /** W13.R6: where the scrolling view was left when the spread closed (-1: none). */
  spreadTop: number;
}

export const PROFILE_LIMITS = {
  rate: AIDS_LIMITS.rate,
  wpm: { min: 150, max: 600, step: 10 },
  spreadBlock: { min: -1, max: 10_000_000, step: 1 },
  spreadTop: { min: -1, max: 1e9, step: 1 },
} as const;

export const DEFAULT_PROFILE: Readonly<ReadingProfile> = Object.freeze({
  ...DEFAULT_READING,
  mode: "page",
  nikud: "asWritten",
  aids: false,
  lineFocus: 0,
  tint: "none",
  layout: "single",
  voice: "",
  rate: 1,
  focusUnit: "sentence",
  hemingway: false,
  wpm: 300,
  anchor: false,
  pos: true,
  syllables: false,
  sidenotes: false,
  spread: false,
  spreadMode: "odd",
  spreadDir: "auto",
  spreadBlock: -1,
  spreadTop: -1,
});

type Check = (v: unknown) => boolean;
const oneOf =
  (xs: readonly unknown[]): Check =>
  (v) =>
    xs.includes(v);
const isBool: Check = (v) => typeof v === "boolean";
const inRange =
  ({ min, max }: { min: number; max: number }): Check =>
  (v) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** What a stored value of each key may be. A key without a check is not part of the profile. */
const PROFILE_FIELDS: { [K in keyof ReadingProfile]: Check } = {
  font: (v) => typeof v === "string" && FONT_IDS.has(v),
  size: inRange(READING_LIMITS.size),
  lineHeight: inRange(READING_LIMITS.lineHeight),
  width: inRange(READING_LIMITS.width),
  dyslexiaLatin: isBool,
  spacedHebrew: isBool,
  mode: oneOf(READING_MODES),
  nikud: oneOf(NIKUD_DISPLAY),
  aids: isBool,
  lineFocus: oneOf(LINE_FOCUS),
  tint: oneOf(AIDS_TINTS),
  layout: oneOf(READING_LAYOUTS),
  voice: (v) => typeof v === "string" && v.length <= 200,
  rate: inRange(PROFILE_LIMITS.rate),
  focusUnit: oneOf(FOCUS_UNITS),
  hemingway: isBool,
  wpm: inRange(PROFILE_LIMITS.wpm),
  anchor: isBool,
  pos: isBool,
  syllables: isBool,
  sidenotes: isBool,
  spread: isBool,
  spreadMode: oneOf(SPREAD_STARTS),
  spreadDir: oneOf(["auto", "rtl", "ltr"]),
  spreadBlock: inRange(PROFILE_LIMITS.spreadBlock),
  spreadTop: inRange(PROFILE_LIMITS.spreadTop),
};

export const PROFILE_KEYS = Object.keys(PROFILE_FIELDS) as Array<keyof ReadingProfile>;

/**
 * The valid keys of a stored or hand-written profile, sparse. Numbers out of
 * range are clamped (a hand-edited `width: 200` still means "wide"); an
 * unknown key or a wrong type is dropped, never guessed.
 */
export function sparseProfile(v: unknown): Partial<ReadingProfile> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, unknown> = {};
  const limits: Record<string, { min: number; max: number }> = { ...READING_LIMITS, ...PROFILE_LIMITS };
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!(k in PROFILE_FIELDS)) continue;
    let val = raw;
    if (k in limits && typeof val === "number" && Number.isFinite(val)) val = Math.min(limits[k].max, Math.max(limits[k].min, val));
    // YAML gives `lineFocus: "3"` when quoted by hand.
    if (k === "lineFocus" && typeof val === "string" && /^\d$/.test(val)) val = Number(val);
    if (PROFILE_FIELDS[k as keyof ReadingProfile](val)) out[k] = val;
  }
  return out as Partial<ReadingProfile>;
}

/** A full profile: `v`'s valid keys over `base`. */
export function normalizeProfile(v: unknown, base: Readonly<ReadingProfile> = DEFAULT_PROFILE): ReadingProfile {
  return { ...base, ...sparseProfile(v) };
}

/** The keys where `p` differs from `base` — what a note saves. */
export function profileDiff(p: Readonly<ReadingProfile>, base: Readonly<ReadingProfile> = DEFAULT_PROFILE): Partial<ReadingProfile> {
  const out: Record<string, unknown> = {};
  for (const k of PROFILE_KEYS) if (p[k] !== base[k]) out[k] = p[k];
  return out as Partial<ReadingProfile>;
}

function hasStoredAids(): boolean {
  try {
    return localStorage.getItem(AIDS_KEY) !== null;
  } catch {
    return false;
  }
}

/** The global profile. The aids' own settings (W5.6, `lumen-reading-aids`) seed the aids fields until the profile sets them. */
export function globalProfile(): ReadingProfile {
  let fromAids: Partial<ReadingProfile> = {};
  if (hasStoredAids()) {
    const a = loadAids();
    fromAids = { aids: a.dyslexia, tint: a.tint, rate: a.rate, lineFocus: a.dyslexia && a.lineFocus ? 1 : 0 };
  }
  return normalizeProfile({ ...fromAids, ...read().global });
}

export function saveGlobalProfile(p: ReadingProfile): void {
  const s = read();
  write({ ...s, global: { ...normalizeProfile(p) } });
}

/** This device's override for the note (sparse), or null. */
export function localNoteProfile(path: string | null | undefined): Partial<ReadingProfile> | null {
  if (!path) return null;
  const own = sparseProfile(read().notes?.[path]);
  return Object.keys(own).length ? own : null;
}

/** Keep `v` (sparse) for the note on this device only — the file is not touched. `null` drops it. */
export function saveLocalNoteProfile(path: string, v: Partial<ReadingProfile> | null): void {
  const s = read();
  const notes = { ...(s.notes ?? {}) };
  const own = v ? sparseProfile(v) : {};
  if (Object.keys(own).length) notes[path] = own;
  else delete notes[path];
  write({ ...s, notes });
}

export type ProfileSource = "global" | "file" | "device";

/** What the note shows, and where each key came from. */
export function resolveProfile(global: Readonly<ReadingProfile>, file: Partial<ReadingProfile> | null, device: Partial<ReadingProfile> | null): { profile: ReadingProfile; from: Record<keyof ReadingProfile, ProfileSource> } {
  const f = sparseProfile(file);
  const d = sparseProfile(device);
  const from = {} as Record<keyof ReadingProfile, ProfileSource>;
  for (const k of PROFILE_KEYS) from[k] = k in d ? "device" : k in f ? "file" : "global";
  return { profile: { ...global, ...f, ...d }, from };
}
