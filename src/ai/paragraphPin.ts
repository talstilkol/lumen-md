/**
 * "Pin link" for a cited paragraph (W12.A1): the paragraph gets a real
 * Obsidian block id through the same edit as "Copy link to block"
 * (editor/blockLink.ts). Kept apart from ./paragraphAnchors so the indexer
 * (headingChunks) does not load the editor's block-link code.
 */
import { blockIdEdit } from "../editor/blockLink";
import { resolveParagraphAnchor } from "./paragraphAnchors";

/**
 * "Pin link": give the paragraph a real Obsidian block id, so the link
 * survives edits. Returns the new note text (unchanged when the paragraph
 * already had one) and the id, or null when the anchor no longer resolves.
 */
export function pinParagraphAnchor(content: string, anchor: string, makeId?: (taken: ReadonlySet<string>) => string): { content: string; id: string } | null {
  const p = resolveParagraphAnchor(content, anchor);
  if (!p) return null;
  if (p.blockId) return { content, id: p.blockId };
  const edit = blockIdEdit(content, p.start, makeId);
  if (edit.kind !== "block") return null;
  const next = edit.change ? content.slice(0, edit.change.from) + edit.change.insert + content.slice(edit.change.from) : content;
  return { content: next, id: edit.id };
}
