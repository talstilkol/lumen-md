/**
 * The text a study room is about, on each device (plan W12.H1): the room
 * carries the reference only, and every partner loads the passage on their
 * own side.
 *
 *  - First the vault's offline copy (`Sources/Sefaria/<ref>.md`, W5.1): no
 *    request at all.
 *  - Otherwise Sefaria, through the one path the app already allows for it
 *    (sources/sefaria/app.ts `lookup`: the privacy ledger's consented fetch,
 *    after the user says yes). No other Sefaria request is added here.
 *  - In airplane mode (or offline), never the network: the offline copy, or
 *    "not available offline". 0 requests.
 *
 * Each version keeps its licence. A version whose licence does not allow
 * copying is link-only: its text is not fetched into the app, and the study
 * screen shows its title, licence and a link to read it on Sefaria.
 */
import { lookupPassage, parseSourceNote, sourceNotePath, type SourceStorage } from "../sources/sefaria/store";
import { licenseLabel } from "../sources/sefaria/license";
import type { Passage } from "../sources/sefaria/client";
import type { SourceRef } from "../sources/sefaria/refs";

export interface StudyVersion {
  title: string;
  language: string;
  direction: "rtl" | "ltr";
  license: string;
  licenseLabel: string;
  licenseUrl: string | null;
  /** The text may be shown here (a free licence); otherwise a link only. */
  free: boolean;
  /** One string per segment; null for a link-only version. */
  segments: string[] | null;
}

export interface StudyText {
  ref: SourceRef;
  heRef: string | null;
  versions: StudyVersion[];
  from: "vault" | "network";
}

export type StudyTextResult = StudyText | { unavailable: "offline" | "declined" };

/** A passage as the study screen shows it (link-only versions without text). */
export const studyTextOf = (p: Passage, from: StudyText["from"]): StudyText => ({
  ref: p.ref,
  heRef: p.heRef,
  from,
  versions: p.versions.map((v) => ({
    title: v.title,
    language: v.language,
    direction: v.direction,
    license: v.license,
    licenseLabel: licenseLabel(v.license),
    licenseUrl: v.licenseUrl,
    free: v.free,
    segments: v.free ? v.text : null,
  })),
});

/**
 * The passage for a study room. `offline()` is airplane mode or no network;
 * `fetch` is the allowed Sefaria path (in the app, the consented ledger fetch).
 */
export async function loadStudyText(ref: SourceRef, deps: { storage: SourceStorage; fetch: typeof fetch; offline: () => boolean }): Promise<StudyTextResult> {
  if (deps.offline()) {
    const saved = await deps.storage.read(sourceNotePath(ref));
    const parsed = saved ? parseSourceNote(saved) : null;
    return parsed ? studyTextOf(parsed, "vault") : { unavailable: "offline" };
  }
  const r = await lookupPassage(ref, deps);
  return studyTextOf(r.passage, r.from);
}

/** Every segment of every version this device has: what a note may not repeat (room.ts `addNote`). */
export function localSegments(t: StudyText): string[] {
  return t.versions.flatMap((v) => v.segments ?? []);
}

/** How many segments the passage has (the longest version). */
export const segmentCount = (t: StudyText) => Math.max(0, ...t.versions.map((v) => v.segments?.length ?? 0));
