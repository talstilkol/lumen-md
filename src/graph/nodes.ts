/**
 * Verses as graph nodes (plan W5.1 step 3, W10.C24). A note that links a
 * Jewish source — "[[בראשית א:א]]", "[[Genesis 1:1|the verse]]" — is joined
 * to one node for that verse, whatever spelling it used, so two notes on the
 * same verse meet in the graph. The node is the verse's saved source note
 * (Sources/Sefaria/<key>.md) when the vault has one, and a node of its own
 * otherwise, with the verse's Hebrew name as its label.
 *
 * Pure: the graph builder (graphModel.ts) gets the notes with these links
 * rewritten and the verse nodes added.
 */
import type { GraphNoteInput } from "./graphModel";
import type { SourceRef } from "../sources/sefaria/refs";

export const VERSE_DIR = "Sources/Sefaria";

/** A link text that could be a reference (a cheap check before the parser). */
const MAYBE = /[\s:,.]\s*[\dא-ת"'״׳]{1,6}[ab.:]?\s*$/u;

export function withVerseNodes(notes: readonly GraphNoteInput[], parse: (s: string) => SourceRef | null): GraphNoteInput[] {
  const paths = new Set(notes.map((n) => n.path));
  const verses = new Map<string, SourceRef>();
  const out = notes.map((n) => {
    let changed = false;
    const targets = n.wikiTargets.map((raw) => {
      const target = raw.split("|")[0]!.split("#")[0]!.trim();
      if (!target || target.length > 60 || !MAYBE.test(target) || paths.has(target) || paths.has(`${target}.md`)) return raw;
      const ref = parse(`[[${target}]]`);
      if (!ref) return raw;
      changed = true;
      verses.set(ref.key, ref);
      return `${VERSE_DIR}/${ref.key}`;
    });
    return changed ? { ...n, wikiTargets: targets } : n;
  });
  for (const [key, ref] of verses) {
    const path = `${VERSE_DIR}/${key}.md`;
    if (paths.has(path)) continue;
    out.push({ path, wikiTargets: [], label: ref.he, meta: { tags: [], props: { type: "verse", sefaria: ref.tref } } });
  }
  return out;
}
