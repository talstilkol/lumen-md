/**
 * A note's book pages and reading place (plan W13.R6) in its reading
 * profile (W13.R1): the fields `spread`, `spreadMode`, `spreadDir`,
 * `spreadBlock` and `spreadTop` of the note's override on this device
 * (./settings.ts, `notes[id]`) — never in the file. A place saved before
 * the profile had these fields (`lumen.spread:<id>`) is moved in on first
 * read. Books (EPUB) keep theirs in ./bookSpread.ts: a book is not a note.
 */
import type { SpreadPlace } from "./bookSpread";
import { localNoteProfile, saveLocalNoteProfile, type ReadingProfile } from "./settings";

const LEGACY = "lumen.spread:";

function legacy(id: string): Partial<SpreadPlace> | null {
  try {
    const raw = localStorage.getItem(LEGACY + id);
    if (raw === null) return null;
    localStorage.removeItem(LEGACY + id);
    const v = JSON.parse(raw) as Partial<SpreadPlace> | null;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

const fields = (p: SpreadPlace): Partial<ReadingProfile> => ({
  spread: p.on,
  spreadMode: p.mode,
  spreadDir: p.dir ?? "auto",
  spreadBlock: typeof p.block === "number" ? p.block : -1,
  spreadTop: typeof p.scrollTop === "number" ? p.scrollTop : -1,
});

/** Keep the note's spread and place in its profile on this device. */
export function saveNotePlace(id: string, place: SpreadPlace): void {
  saveLocalNoteProfile(id, { ...(localNoteProfile(id) ?? {}), ...fields(place) });
}

/** The note's spread and place (defaults: scrolling, page 1 alone, direction by script). */
export function loadNotePlace(id: string): SpreadPlace {
  let p: Partial<ReadingProfile> = localNoteProfile(id) ?? {};
  if (!("spread" in p)) {
    const old = legacy(id);
    if (old) {
      const mode = old.mode === "odd" || old.mode === "even" || old.mode === "none" ? old.mode : "odd";
      const place: SpreadPlace = { on: old.on === true, mode, dir: old.dir === "rtl" || old.dir === "ltr" ? old.dir : undefined, block: typeof old.block === "number" ? old.block : undefined, scrollTop: typeof old.scrollTop === "number" ? old.scrollTop : undefined };
      saveNotePlace(id, place);
      p = localNoteProfile(id) ?? {};
    }
  }
  return {
    on: p.spread === true,
    mode: p.spreadMode ?? "odd",
    dir: p.spreadDir === "rtl" || p.spreadDir === "ltr" ? p.spreadDir : undefined,
    block: typeof p.spreadBlock === "number" && p.spreadBlock >= 0 ? p.spreadBlock : undefined,
    scrollTop: typeof p.spreadTop === "number" && p.spreadTop >= 0 ? p.spreadTop : undefined,
  };
}
