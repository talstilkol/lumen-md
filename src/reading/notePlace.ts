/**
 * A note's book pages and reading place (plan W13.R6) in its reading
 * profile (W13.R1): the fields `spread`, `spreadMode`, `spreadDir`,
 * `spreadBlock` and `spreadTop` (./profileCore.ts PLACE_KEYS) of the note's
 * override on this device — never in the file, never in the global profile.
 *
 * Callers pass the preview's document key (renderer/previewDoc docIdentity).
 * Review 13 M6: the place is kept by the note's workspace PATH (`ws:<path>`
 * → `<path>`, the key ReadingModeMenu and moveNoteReading use). A document
 * without a path (a file opened from disk, `fh:N:…`; an unsaved buffer,
 * `name:…`) has a key that changes every session, so its place lives in
 * memory for the session only and never grows the stored map; such keys
 * left in storage by earlier builds are dropped. A place saved before the
 * profile had these fields (`lumen.spread:<key>`) is moved in on first read.
 * Books (EPUB) keep theirs in ./bookSpread.ts: a book is not a note.
 *
 * Tiny on purpose: in the startup bundle, so it reads ./profileCore.ts, not
 * ./settings.ts (review 13 H2), and checks its own fields.
 */
import type { SpreadPlace } from "./bookSpread";
import type { ReadingProfile } from "./settings";
import { readStored, writeStored } from "./profileCore";

const LEGACY = "lumen.spread:";
type Place = Partial<Pick<ReadingProfile, "spread" | "spreadMode" | "spreadDir" | "spreadBlock" | "spreadTop">>;

/** The stored map's key for a document key: its workspace path, or null (session only). */
export function placePath(docKey: string): string | null {
  return docKey.startsWith("ws:") && docKey.length > 3 ? docKey.slice(3) : null;
}

const session = new Map<string, Place>();
/** Document keys of earlier builds in the notes map: never a workspace path. */
const STALE = /^(?:ws:|fh:\d+:|name:)/;

function legacy(docKey: string): Partial<SpreadPlace> | null {
  try {
    const raw = localStorage.getItem(LEGACY + docKey);
    if (raw === null) return null;
    localStorage.removeItem(LEGACY + docKey);
    const v = JSON.parse(raw) as Partial<SpreadPlace> | null;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

const int = (n: unknown, max: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(-1, Math.round(n))) : -1);
const fields = (p: Partial<SpreadPlace>): Place => ({
  spread: p.on === true,
  spreadMode: p.mode === "even" || p.mode === "none" ? p.mode : "odd",
  spreadDir: p.dir === "rtl" || p.dir === "ltr" ? p.dir : "auto",
  spreadBlock: int(p.block, 10_000_000),
  spreadTop: int(p.scrollTop, 1e9),
});

function stored(path: string): Place {
  const s = readStored();
  const notes = s.notes ?? {};
  let own: Place = notes[path] ?? {};
  // Earlier builds keyed the place by the document key: move `ws:<path>`, drop the per-session keys.
  const stale = Object.keys(notes).filter((k) => STALE.test(k));
  if (stale.length) {
    const next = { ...notes };
    const old = next[`ws:${path}`];
    if (old && !("spread" in own)) own = { ...own, ...pick(old) };
    for (const k of stale) delete next[k];
    next[path] = { ...(next[path] ?? {}), ...own };
    if (!Object.keys(next[path]).length) delete next[path];
    writeStored({ ...s, notes: next });
  }
  return own;
}

function pick(v: Partial<ReadingProfile>): Place {
  const out: Place = {};
  for (const k of ["spread", "spreadMode", "spreadDir", "spreadBlock", "spreadTop"] as const) if (k in v) (out as Record<string, unknown>)[k] = v[k];
  return out;
}

/** Keep the note's spread and place on this device (by path; in memory for a document without one). */
export function saveNotePlace(docKey: string, place: SpreadPlace): void {
  const path = placePath(docKey);
  if (path === null) return void session.set(docKey, fields(place));
  const s = readStored();
  const notes = { ...(s.notes ?? {}) };
  notes[path] = { ...(notes[path] ?? {}), ...fields(place) };
  writeStored({ ...s, notes });
}

/** The note's spread and place (defaults: scrolling, page 1 alone, direction by script). */
export function loadNotePlace(docKey: string): SpreadPlace {
  const path = placePath(docKey);
  let p: Place = path === null ? (session.get(docKey) ?? {}) : stored(path);
  if (!("spread" in p)) {
    const old = legacy(docKey);
    if (old) {
      saveNotePlace(docKey, old as SpreadPlace);
      p = path === null ? (session.get(docKey) ?? {}) : stored(path);
    }
  }
  return {
    on: p.spread === true,
    mode: p.spreadMode === "even" || p.spreadMode === "none" ? p.spreadMode : "odd",
    dir: p.spreadDir === "rtl" || p.spreadDir === "ltr" ? p.spreadDir : undefined,
    block: typeof p.spreadBlock === "number" && p.spreadBlock >= 0 ? p.spreadBlock : undefined,
    scrollTop: typeof p.spreadTop === "number" && p.spreadTop >= 0 ? p.spreadTop : undefined,
  };
}
