/**
 * AI-written text in the WYSIWYG editor (plan 5.9, W10.E37), tagged when it
 * is inserted rather than found by matching recent answers: the code that
 * puts an agent's text into the document marks its transaction
 * (`markAiInsert`), and every range that transaction inserts is AI text.
 *
 * - The spans are a plugin state, mapped through every later transaction,
 *   and drawn as inline decorations (`.ai-authored`, lighter, hidden with
 *   `data-ai-marks-hidden` on <html>, like the source editor's).
 * - A transaction that is not marked (typing, pasting, an edit) takes the
 *   range it changes out of the spans: edited text is the user's.
 * - It is not a schema mark on purpose: the Markdown round trip never sees
 *   it, so no `<span>` or attribute can leak into the note's text.
 */
import { Plugin, PluginKey, type EditorState, type Transaction } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";

export const wysiwygAiKey = new PluginKey<DecorationSet>("lumen-ai-authorship");
const META = "lumenAiAuthored";

/** Mark `tr` as an agent's insertion: everything it inserts is AI text. Returns `tr`. */
export function markAiInsert(tr: Transaction): Transaction {
  return tr.setMeta(META, true);
}

const isAi = (tr: Transaction) => tr.getMeta(META) === true;
const deco = (from: number, to: number) => Decoration.inline(from, to, { class: "ai-authored" }, { ai: true });

/** The ranges a transaction inserted or replaced, in the final document. */
function changedRanges(tr: Transaction): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  tr.mapping.maps.forEach((map, i) => {
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      // Positions after this step, carried through the steps that follow.
      const rest = tr.mapping.slice(i + 1);
      out.push([rest.map(newStart, -1), rest.map(newEnd, 1)]);
    });
  });
  return out;
}

function apply(tr: Transaction, set: DecorationSet): DecorationSet {
  if (!tr.docChanged) return set;
  let next = set.map(tr.mapping, tr.doc);
  const ranges = changedRanges(tr);
  if (isAi(tr)) {
    const add = ranges.filter(([a, b]) => b > a).map(([a, b]) => deco(a, b));
    return add.length ? next.add(tr.doc, add) : next;
  }
  // The user's edit: what it touches is no longer AI text; the parts on either side stay.
  for (const [a, b] of ranges) {
    // A pure deletion (a === b) inside a span cuts nothing out: the text around it is still the AI's.
    if (b <= a) continue;
    const hit = next.find(a, b, (spec) => spec.ai === true).filter((d) => d.from < b && d.to > a);
    if (!hit.length) continue;
    // remove() clears the entries of the array it is given: hand it a copy.
    next = next.remove([...hit]);
    const keep: Decoration[] = [];
    for (const d of hit) {
      if (d.from < a) keep.push(deco(d.from, a));
      if (d.to > b) keep.push(deco(b, d.to));
    }
    if (keep.length) next = next.add(tr.doc, keep);
  }
  return next;
}

export function wysiwygAiAuthorshipPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: wysiwygAiKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set) => apply(tr, set),
    },
    props: {
      decorations: (state) => wysiwygAiKey.getState(state),
    },
  });
}

/** The AI-written ranges of the document, merged and in order (for tests and the export). */
export function aiRanges(state: EditorState): Array<[number, number]> {
  const set = wysiwygAiKey.getState(state);
  if (!set) return [];
  const list = set.find().map((d) => [d.from, d.to] as [number, number]).sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of list) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The AI-written text of the document, range by range. */
export function aiTexts(state: EditorState): string[] {
  return aiRanges(state).map(([a, b]) => state.doc.textBetween(a, b, "\n"));
}

const OPEN = "";
const CLOSE = "";

/**
 * The AI ranges as offsets into the note's Markdown (for the saved spans,
 * the source view and the export, W10.E37): the ranges are bracketed with
 * two private-use characters in a copy of the document, the copy is
 * serialized with the editor's own serializer, and the brackets' places in
 * that Markdown are the spans. A range whose brackets do not both come out
 * (one fell inside a link's URL, say) is left out rather than guessed.
 */
export function markdownAiSpans(state: EditorState, serialize: (doc: EditorState["doc"]) => string): { markdown: string; spans: Array<[number, number]> } {
  const ranges = aiRanges(state);
  const plain = () => ({ markdown: serialize(state.doc), spans: [] as Array<[number, number]> });
  if (!ranges.length) return plain();
  const tr = state.tr;
  // From the end, so the earlier positions stay valid.
  for (const [a, b] of [...ranges].reverse()) tr.insertText(CLOSE, b).insertText(OPEN, a);
  const marked = serialize(tr.doc);
  let markdown = "";
  const spans: Array<[number, number]> = [];
  let open: number | null = null;
  for (const ch of marked) {
    if (ch === OPEN) open = markdown.length;
    else if (ch === CLOSE) {
      if (open !== null && markdown.length > open) spans.push([open, markdown.length]);
      open = null;
    } else markdown += ch;
  }
  // A serializer that escaped or dropped a bracket would leave a different text: then nothing is claimed.
  return markdown === serialize(state.doc) ? { markdown, spans } : plain();
}
