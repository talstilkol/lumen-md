/**
 * Building and re-checking an edge's provenance (plan W12.E1).
 *
 * `makeProvenance` refuses a quote that is not word for word in the
 * paragraph (`quoteContained` of research/citations, the check "Ask the
 * vault" uses), and refuses an elided quote ("…"): an edge cites one
 * contiguous span. `edgeSourceState` is the "source changed" check: the
 * paragraph gone, its hash different, or the quote no longer in it.
 */
import { quoteContained } from "../research/citations";
import type { Edge, Provenance } from "./model";
import { paragraphByAnchor, paragraphHash } from "./paragraphs";

export const QUOTE_MAX_CHARS = 400;

/** The quote is a contiguous word-for-word span of the paragraph. */
export function quoteInParagraph(quote: string, paragraph: string): boolean {
  const q = quote.trim();
  if (!q || q.length > QUOTE_MAX_CHARS || /\.\.\.|…/.test(q)) return false;
  return quoteContained(q, paragraph);
}

export interface ProvenanceInput {
  note: string;
  anchor: string;
  paragraph: string;
  quote: string;
  extractor: string;
  model: string | null;
  date?: Date;
}

export function makeProvenance(i: ProvenanceInput): Provenance {
  if (!quoteInParagraph(i.quote, i.paragraph)) throw new Error("provenance: the quote is not word for word in the paragraph");
  return {
    note: i.note,
    anchor: i.anchor,
    quote: i.quote.trim(),
    paragraphHash: paragraphHash(i.paragraph),
    extractor: i.extractor,
    model: i.model,
    date: (i.date ?? new Date()).toISOString(),
  };
}

export type SourceState = "ok" | "changed" | "missing-note" | "missing-paragraph";

/**
 * Whether an edge still has its basis. `content` is the note's current
 * text (null when the note is gone). A paragraph whose text changed only
 * where the quote is not is still "changed": the claim was read in a
 * context that no longer exists, and the user decides.
 */
export function edgeSourceState(p: Provenance, content: string | null): SourceState {
  if (content === null) return "missing-note";
  const para = paragraphByAnchor(content, p.anchor);
  if (!para) return "missing-paragraph";
  if (para.hash !== p.paragraphHash) return "changed";
  return quoteInParagraph(p.quote, para.text) ? "ok" : "changed";
}

export interface EdgeWithSource extends Edge {
  source: SourceState;
}

/** Every edge with its source state, reading each note once. */
export function markSourceChanges(edges: readonly Edge[], read: (path: string) => string | null): EdgeWithSource[] {
  const cache = new Map<string, string | null>();
  const get = (p: string) => {
    if (!cache.has(p)) cache.set(p, read(p));
    return cache.get(p)!;
  };
  return edges.map((e) => ({ ...e, source: edgeSourceState(e.provenance, get(e.provenance.note)) }));
}
