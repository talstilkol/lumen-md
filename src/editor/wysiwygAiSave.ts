/**
 * The WYSIWYG editor's AI ranges into the note's saved spans on every
 * emission (plan 5.9, W10.E37), so the source view and "Export with AI
 * marks" keep what an agent wrote here. The saved spans of the unchanged
 * parts are carried across the edit (carrySpans); the editor's own ranges
 * are mapped to Markdown offsets with its serializer (markdownAiSpans).
 */
import { editorViewCtx, serializerCtx, type Editor } from "@milkdown/core";
import { authorshipKey, carrySpans } from "../ai/aiWrites";
import { loadSpans, normalize, saveSpans, type Span } from "../ai/authorship";
import { useAppStore } from "../store/useStore";
import { log } from "../lib/logger";
import { markdownAiSpans } from "./wysiwygAiAuthorship";

/** Pure part (tests): the spans to save for `full` (frontmatter + body), given the body's own AI spans. */
export function spansForEmission(prevFull: string, full: string, saved: readonly Span[], frontmatter: string, md: string, body: string, bodySpans: ReadonlyArray<readonly [number, number]>): Span[] {
  // The body as written may differ from the serialization (unedited blocks keep their source): keep only spans in the common parts.
  const own = carrySpans(md, body, bodySpans.map(([a, b]) => [a, b] as Span)).map(([a, b]): Span => [a + frontmatter.length, b + frontmatter.length]);
  return normalize([...carrySpans(prevFull, full, saved), ...own]);
}

export function saveWysiwygAiSpans(editor: Editor, prevFull: string, full: string, frontmatter: string, md: string): void {
  try {
    const key = authorshipKey(useAppStore.getState().doc);
    const saved = loadSpans(key, prevFull);
    const mapped = editor.action((ctx) => markdownAiSpans(ctx.get(editorViewCtx).state, ctx.get(serializerCtx)));
    if (!saved.length && !mapped.spans.length) return;
    // The serializer's own text must be the emission's: otherwise the offsets point elsewhere.
    if (mapped.markdown !== md) return;
    saveSpans(key, full, spansForEmission(prevFull, full, saved, frontmatter, md, full.slice(frontmatter.length), mapped.spans));
  } catch (e) {
    log.warn("[wysiwyg] AI marks not saved", e);
  }
}
