/**
 * "Copy link to block" (plan 4.8): the block at the cursor gets an Obsidian
 * block id — ` ^id` at the end of a paragraph or list item, a `^id` line of
 * its own after a table, quote or code block — unless it has one, and
 * `[[Note#^id]]` goes to the clipboard. On a heading, the heading link.
 *
 * `blockIdEdit` is pure; `copyBlockLink` applies it to the source editor.
 */

import type { EditorView } from "@codemirror/view";
import { noteBlocks } from "./wikiComplete";
import { BLOCK_MARK } from "../renderer/remarkBlockIds";

export type BlockIdEdit =
  | { kind: "block"; id: string; change: { from: number; insert: string } | null }
  | { kind: "heading"; heading: string }
  | { kind: "none" };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST = /^\s*(?:[-*+]|\d+[.)])\s+/;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const OWN_LINE = /^\s*\^([A-Za-z0-9-]+)\s*$/;
const isTable = (l: string) => /^\s*\|/.test(l) || /^\s*[-:| ]+\|[-:| ]*$/.test(l);
const isQuote = (l: string) => /^\s{0,3}>/.test(l);

/** A short id, unique among the note's block ids. */
export function newBlockId(taken: ReadonlySet<string>, random: () => number = Math.random): string {
  for (;;) {
    const id = Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0");
    if (!taken.has(id)) return id;
  }
}

/** What "Copy link to block" does at offset `pos` of `text`. */
export function blockIdEdit(text: string, pos: number, makeId: (taken: ReadonlySet<string>) => string = (t) => newBlockId(t)): BlockIdEdit {
  const lines = text.split("\n");
  const starts: number[] = [];
  let off = 0;
  for (const l of lines) {
    starts.push(off);
    off += l.length + 1;
  }
  let at = starts.findIndex((s, i) => pos >= s && pos <= s + lines[i].length);
  if (at < 0) at = lines.length - 1;
  const endOf = (i: number) => starts[i] + lines[i].length;
  const clean = (l: string) => l.replace(/\r$/, "");

  // Front matter is no block.
  if (/^---\s*$/.test(clean(lines[0] ?? ""))) {
    const close = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(clean(l)));
    if (close >= 0 && at <= close) return { kind: "none" };
  }
  // Fenced code: where the fences are.
  let fenceOpen = -1;
  let fence: string | null = null;
  let inFence: [number, number] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (fence === null && m) {
      fence = m[1][0];
      fenceOpen = i;
    } else if (fence !== null && m && m[1][0] === fence) {
      if (at >= fenceOpen && at <= i) inFence = [fenceOpen, i];
      fence = null;
    }
  }
  if (fence !== null && at >= fenceOpen) inFence = [fenceOpen, lines.length - 1];

  const taken = new Set(noteBlocks(text).map((b) => b.id));
  /** A `^id` line of its own after line `last` (directly, or after one blank line). */
  const ownLineAfter = (last: number) => {
    for (const i of [last + 1, last + 2]) {
      const m = OWN_LINE.exec(clean(lines[i] ?? ""));
      if (m) return m[1];
      if (i === last + 1 && clean(lines[i] ?? "").trim()) return null;
    }
    return null;
  };
  const markOwnLine = (last: number): BlockIdEdit => {
    const existing = ownLineAfter(last);
    if (existing) return { kind: "block", id: existing, change: null };
    const id = makeId(taken);
    const next = lines[last + 1];
    const tail = next !== undefined && clean(next).trim() ? "\n" : "";
    return { kind: "block", id, change: { from: endOf(last) - (lines[last].endsWith("\r") ? 1 : 0), insert: `\n\n^${id}${tail}` } };
  };
  const markEnd = (last: number): BlockIdEdit => {
    const line = clean(lines[last]);
    const m = BLOCK_MARK.exec(line);
    if (m) return { kind: "block", id: m[2], change: null };
    const id = makeId(taken);
    return { kind: "block", id, change: { from: starts[last] + line.replace(/\s+$/, "").length, insert: ` ^${id}` } };
  };

  if (inFence) return markOwnLine(inFence[1]);
  const line = clean(lines[at]);
  if (!line.trim()) return { kind: "none" };
  if (OWN_LINE.test(line)) return { kind: "block", id: OWN_LINE.exec(line)![1], change: null };
  const h = HEADING.exec(line);
  if (h) return { kind: "heading", heading: h[1] };

  // Tables and quotes: the run of their lines, then an id line of its own.
  for (const kind of [isTable, isQuote]) {
    if (!kind(line)) continue;
    let last = at;
    while (last + 1 < lines.length && kind(clean(lines[last + 1])) && clean(lines[last + 1]).trim()) last++;
    return markOwnLine(last);
  }

  // A paragraph or a list item's paragraph: its last line takes ` ^id`.
  const startsBlock = (l: string) => !l.trim() || LIST.test(l) || HEADING.test(l) || FENCE.test(l) || isQuote(l) || isTable(l) || OWN_LINE.test(l);
  let last = at;
  while (last + 1 < lines.length && !startsBlock(clean(lines[last + 1]))) last++;
  return markEnd(last);
}

/** The link to a block of the open note: by its name, or its path when another note shares the name. */
async function noteLinkName(): Promise<string> {
  const { useAppStore } = await import("../store/useStore");
  const doc = useAppStore.getState().doc;
  const path = doc.workspaceName ?? null;
  if (path) {
    const { linkCatalog } = await import("./wikiLinkData");
    const { linkTarget } = await import("./wikiComplete");
    const catalog = await linkCatalog();
    const entry = catalog.notes.find((n) => n.path === path);
    if (entry) return linkTarget(entry, catalog);
    return path.replace(/\.(md|markdown)$/i, "");
  }
  return doc.name.replace(/\.(md|markdown)$/i, "");
}

/** Add the id if needed and copy the link. Returns the link, or null where there is no block. */
export async function copyBlockLink(view: EditorView): Promise<string | null> {
  const edit = blockIdEdit(view.state.doc.toString(), view.state.selection.main.head);
  if (edit.kind === "none") return null;
  if (edit.kind === "block" && edit.change) view.dispatch({ changes: edit.change, userEvent: "input" });
  const name = await noteLinkName();
  const link = edit.kind === "heading" ? `[[${name}#${edit.heading.replace(/[[\]|#^]/g, "")}]]` : `[[${name}#^${edit.id}]]`;
  await navigator.clipboard.writeText(link);
  return link;
}
