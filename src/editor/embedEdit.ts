/**
 * Editing an embedded block where it is shown (plan W12.U1): the embed of
 * `![[Note#^id]]` or `![[Note#Heading]]` knows the exact range of its source
 * in Note (from the parse positions, ./renderer/embeds.ts), and an edit
 * replaces that range and nothing else. Pure; the component writes the file.
 *
 * Safety: the range carries a checksum of the text it covered when the
 * preview rendered. If the source note changed since, the edit is refused
 * (the preview re-renders with the new range) instead of overwriting the
 * wrong text. A block's `^id` marker is kept: the editor shows the text
 * without it and puts it back on save, so links to the block keep working.
 */
import { BLOCK_MARK } from "../renderer/remarkBlockIds";

/** FNV-1a over UTF-16 code units, as 8 hex digits: enough to notice a changed range. */
export function checksum(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface EmbedRange {
  start: number;
  end: number;
  sum: string;
}

/** The block's text and its `^id` marker (kept apart, so it is not edited away). */
export function splitMarker(slice: string): { body: string; marker: string } {
  const lines = slice.split("\n");
  const last = lines[lines.length - 1];
  const m = BLOCK_MARK.exec(last);
  if (!m) return { body: slice, marker: "" };
  return { body: [...lines.slice(0, -1), last.slice(0, m.index)].join("\n").replace(/\s+$/, ""), marker: last.slice(m.index) };
}

export type EditResult = { ok: true; text: string } | { ok: false; reason: "changed" | "range" };

/** The range's current text, or why it is not there any more. */
export function currentSlice(source: string, r: EmbedRange): { ok: true; slice: string } | { ok: false; reason: "changed" | "range" } {
  if (!(r.start >= 0 && r.end >= r.start && r.end <= source.length)) return { ok: false, reason: "range" };
  const slice = source.slice(r.start, r.end);
  return checksum(slice) === r.sum ? { ok: true, slice } : { ok: false, reason: "changed" };
}

/** The source note with the range replaced by `body` (plus the block's marker). Nothing else changes. */
export function applyEmbedEdit(source: string, r: EmbedRange, body: string): EditResult {
  const cur = currentSlice(source, r);
  if (!cur.ok) return cur;
  const { marker } = splitMarker(cur.slice);
  const next = body.replace(/\s+$/, "") + marker;
  return { ok: true, text: source.slice(0, r.start) + next + source.slice(r.end) };
}
