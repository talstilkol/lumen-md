/**
 * The note a havruta session leaves in each vault (plan W12.H2): "חברותא —
 * <reference> — <date>", with both partners' notes by segment, the
 * highlights as pointers, and a link to the passage. Written on this
 * device when the session is saved or ended; it never carries the studied
 * text (only what the partners wrote, which room.ts already keeps free of
 * the text), so it is safe whatever the versions' licences.
 */
import type * as Y from "yjs";
import { listHighlights, listNotes, roomRef, type HavrutaRef } from "./room";

export const HAVRUTA_DIR = "Havruta";

/** A file name safe on every platform: no / \ : * ? " < > |. */
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();

export function sessionNotePath(ref: HavrutaRef, date: string): string {
  return `${HAVRUTA_DIR}/${safe(`חברותא — ${ref.he} — ${date}`)}.md`;
}

/** Sefaria's page for a reference key ("Berakhot.2a"), a plain link (no request). */
export const sefariaPage = (key: string) => `https://www.sefaria.org/${encodeURI(key)}`;

export interface SessionNoteInput {
  doc: Y.Doc;
  date: string;
  /** Display names by author (client id); unknown authors are "?". */
  names: Map<number, string>;
  /** "קטע 3" or, when the text has its own labels, those (e.g. a verse's Hebrew number). */
  segmentLabel?: (i: number) => string;
}

export function sessionNoteMarkdown({ doc, date, names, segmentLabel = (i) => `קטע ${i + 1}` }: SessionNoteInput): string {
  const ref = roomRef(doc) ?? { key: "?", he: "?" };
  const notes = listNotes(doc);
  const highlights = listHighlights(doc);
  const who = (id: number, fallback: string) => names.get(id) ?? fallback ?? "?";
  const partners = [...new Set(notes.map((n) => who(n.author, n.name)))];
  const lines = [
    "---",
    "type: havruta",
    `ref: ${JSON.stringify(ref.key)}`,
    `date: ${date}`,
    `partners: ${JSON.stringify(partners)}`,
    "---",
    `# חברותא — ${ref.he} — ${date}`,
    "",
    `[[${ref.key}|${ref.he}]] · [Sefaria](${sefariaPage(ref.key)})`,
  ];
  const segments = [...new Set([...notes.map((n) => n.segment), ...highlights.map((h) => h.segment)])].sort((a, b) => a - b);
  for (const s of segments) {
    lines.push("", `## ${segmentLabel(s)}`, "");
    for (const n of notes.filter((x) => x.segment === s)) lines.push(`- **${who(n.author, n.name)}**: ${n.text.replace(/\n+/g, " ")}`);
    const hs = highlights.filter((h) => h.segment === s);
    if (hs.length) lines.push(`- הדגשות: ${hs.map((h) => `${h.version} ${h.start}–${h.end}`).join("; ")}`);
  }
  if (!segments.length) lines.push("", "_אין הערות במפגש הזה._");
  return lines.join("\n") + "\n";
}
