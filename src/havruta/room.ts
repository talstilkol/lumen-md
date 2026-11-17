/**
 * Havruta, part 1 (plan W12.H1): a shared study room anchored to one
 * Sefaria reference ("Berakhot 2a").
 *
 * The room is a Yjs document that holds only what the two partners write
 * and point at, never the text they study:
 *
 *   meta        { v, ref, refHe, created, ended? }: the reference (a pointer)
 *   notes       Y.Array of { id, segment, text, author, name, at }: notes on
 *               a segment (a verse / a line of the daf, by index)
 *   highlights  Y.Array of { id, segment, version, start, end, author, at }:
 *               a highlight is offsets into one version's segment, not text
 *
 * Each side fetches the text itself, from its own offline copy or from
 * Sefaria (./text.ts), and shows it with each version's licence. A note may
 * not carry the source text: `sourceOverlap` finds a run of the passage's
 * words in it, and `addNote` refuses it ("point at the segment instead"),
 * so a licence that limits sharing is never broken through the room — the
 * text of a link-only version is never even fetched, and that of a free one
 * stays on each device. Positions (the partner's segment and selection)
 * travel in the encrypted presence, not in the document.
 *
 * The document is end-to-end encrypted on the way (./session.ts, the same
 * src/collab/e2e.ts as shared notes): the relay sees only envelopes.
 */
import * as Y from "yjs";
import { normalizeForMatch } from "../text/hebrew";
import { compareNames } from "../i18n/collate";

export const HAVRUTA_VERSION = 1;
/** Server-side names of study rooms start with this (sync-server and the public worker keep them ≤ 30 days). */
export const HAVRUTA_ROOM_PREFIX = "havruta-";
/** A run of this many consecutive words of the passage in a note counts as copying the text. */
export const OVERLAP_WORDS = 6;

export interface HavrutaRef {
  /** The reference's stable key (sources/sefaria/refs `SourceRef.key`). */
  key: string;
  /** How it is shown in Hebrew. */
  he: string;
}

export interface HavrutaNote {
  id: string;
  /** 0-based segment of the passage the note is on. */
  segment: number;
  text: string;
  /** The writer's Yjs client id, and the display name they chose for the session. */
  author: number;
  name: string;
  at: number;
}

export interface HavrutaHighlight {
  id: string;
  segment: number;
  /** The version's title: the offsets are into that version's segment, which each side has locally. */
  version: string;
  start: number;
  end: number;
  author: number;
  at: number;
}

/** A fresh room name: `havruta-` + 128 random bits. */
export function newHavrutaRoomName(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return HAVRUTA_ROOM_PREFIX + [...random(16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const meta = (doc: Y.Doc) => doc.getMap<unknown>("meta");
const notesArr = (doc: Y.Doc) => doc.getArray<Y.Map<unknown>>("notes");
const hlArr = (doc: Y.Doc) => doc.getArray<Y.Map<unknown>>("highlights");

/** Anchor a new room to its reference (once; joining partners read it). */
export function initRoom(doc: Y.Doc, ref: HavrutaRef, now = Date.now()): void {
  const m = meta(doc);
  if (m.get("ref")) return;
  doc.transact(() => {
    m.set("v", HAVRUTA_VERSION);
    m.set("ref", ref.key);
    m.set("refHe", ref.he);
    m.set("created", now);
  });
}

export function roomRef(doc: Y.Doc): HavrutaRef | null {
  const key = meta(doc).get("ref");
  return typeof key === "string" ? { key, he: String(meta(doc).get("refHe") ?? key) } : null;
}

/** The session was ended by a partner (./session.ts then saves the note and leaves). */
export const roomEnded = (doc: Y.Doc) => meta(doc).get("ended") === true;
export const markEnded = (doc: Y.Doc) => meta(doc).set("ended", true);

const words = (s: string) => normalizeForMatch(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The longest run of consecutive words that `text` shares with any of the
 * passage's segments (any version the device has), as a word count.
 */
export function sourceOverlap(text: string, segments: readonly string[]): number {
  const t = words(text);
  if (!t.length) return 0;
  let best = 0;
  for (const seg of segments) {
    const s = words(seg);
    // Longest common substring over words, O(|t|·|s|) — notes and segments are short.
    let prev = new Array<number>(s.length + 1).fill(0);
    for (let i = 1; i <= t.length; i++) {
      const cur = new Array<number>(s.length + 1).fill(0);
      for (let j = 1; j <= s.length; j++) {
        if (t[i - 1] === s[j - 1]) {
          cur[j] = prev[j - 1] + 1;
          if (cur[j] > best) best = cur[j];
        }
      }
      prev = cur;
    }
  }
  return best;
}

export class SourceTextInNoteError extends Error {
  constructor(readonly words: number) {
    super(`The note repeats ${words} words of the text: point at the segment instead (the text is not shared in the room).`);
    this.name = "SourceTextInNoteError";
  }
}

let seq = 0;
const newId = (doc: Y.Doc) => `${doc.clientID.toString(36)}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/**
 * Add a note on a segment. `sourceSegments` is the text this device has for
 * the passage (every version): a note that repeats OVERLAP_WORDS or more of
 * it in a row is refused, so the text never enters the room.
 */
export function addNote(doc: Y.Doc, n: { segment: number; text: string; name: string; sourceSegments: readonly string[] }, now = Date.now()): HavrutaNote {
  const text = n.text.trim();
  if (!text) throw new Error("empty note");
  const overlap = sourceOverlap(text, n.sourceSegments);
  if (overlap >= OVERLAP_WORDS) throw new SourceTextInNoteError(overlap);
  const note: HavrutaNote = { id: newId(doc), segment: Math.max(0, Math.floor(n.segment)), text, author: doc.clientID, name: n.name.slice(0, 40), at: now };
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(note)) m.set(k, v);
  notesArr(doc).push([m]);
  return note;
}

/** Highlight part of a segment of one version: only the offsets go into the room. */
export function addHighlight(doc: Y.Doc, h: { segment: number; version: string; start: number; end: number }, now = Date.now()): HavrutaHighlight {
  if (!(h.end > h.start) || h.start < 0) throw new Error("empty highlight");
  const hl: HavrutaHighlight = { id: newId(doc), segment: Math.max(0, Math.floor(h.segment)), version: h.version.slice(0, 200), start: Math.floor(h.start), end: Math.floor(h.end), author: doc.clientID, at: now };
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(hl)) m.set(k, v);
  hlArr(doc).push([m]);
  return hl;
}

/** Remove one's own note (a partner's stays). */
export function removeNote(doc: Y.Doc, id: string): boolean {
  const arr = notesArr(doc);
  const i = arr.toArray().findIndex((m: Y.Map<unknown>) => m.get("id") === id && m.get("author") === doc.clientID);
  if (i < 0) return false;
  arr.delete(i, 1);
  return true;
}

const asNote = (m: Y.Map<unknown>): HavrutaNote => ({ id: String(m.get("id")), segment: Number(m.get("segment")), text: String(m.get("text") ?? ""), author: Number(m.get("author")), name: String(m.get("name") ?? ""), at: Number(m.get("at")) });
const asHl = (m: Y.Map<unknown>): HavrutaHighlight => ({ id: String(m.get("id")), segment: Number(m.get("segment")), version: String(m.get("version") ?? ""), start: Number(m.get("start")), end: Number(m.get("end")), author: Number(m.get("author")), at: Number(m.get("at")) });

/** Every note, oldest first (ties: by author, so both sides list them alike). */
export function listNotes(doc: Y.Doc): HavrutaNote[] {
  return notesArr(doc).toArray().map(asNote).sort((a: HavrutaNote, b: HavrutaNote) => a.at - b.at || a.author - b.author || compareNames(a.id, b.id));
}

export function listHighlights(doc: Y.Doc): HavrutaHighlight[] {
  return hlArr(doc).toArray().map(asHl);
}

/** Notes by segment, split into mine and my partner's (the study screen's two columns). */
export function notesBySegment(doc: Y.Doc, me = doc.clientID): Map<number, { mine: HavrutaNote[]; theirs: HavrutaNote[] }> {
  const out = new Map<number, { mine: HavrutaNote[]; theirs: HavrutaNote[] }>();
  for (const n of listNotes(doc)) {
    const row = out.get(n.segment) ?? { mine: [], theirs: [] };
    (n.author === me ? row.mine : row.theirs).push(n);
    out.set(n.segment, row);
  }
  return out;
}

/** What a partner's presence carries: where they are, never what they read. */
export interface HavrutaPresence {
  name: string;
  color: string;
  segment: number | null;
  /** A selection inside the segment: offsets into `version`. */
  selection?: { version: string; start: number; end: number } | null;
  /** They asked the partner to follow their scrolling. */
  leading?: boolean;
}
