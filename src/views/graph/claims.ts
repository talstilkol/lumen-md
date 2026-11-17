/**
 * The claim card and "why is this edge here" (plan R12.8), for an edge of
 * the entity graph (src/entities/model.ts): every line the graph draws is a
 * claim — subject, predicate, object — taken from one paragraph of one note.
 *
 * The card grades it the NATO / Admiralty way, with two judgements that
 * never feed each other:
 *   - **A–F, the source's reliability**: from the source note's own
 *     `reliability:` (A–F) when the writer set one, else from its
 *     `source-class:` (court / official → A, primary / academic → B,
 *     media / archive → C, other → D), else F, "cannot be judged";
 *   - **1–6, the information's credibility**: from how many independent
 *     notes state the same claim and whether any rejects it — 1 confirmed
 *     by three or more and nothing against, 2 by two, 3 by one approved,
 *     4 something against it, 5 more against than for, 6 cannot be judged
 *     (only proposed by an extractor, or no quote).
 * The anchor is the quote with its note and paragraph; a claim without one
 * is flagged and can't be exported from the card.
 *
 * `explainEdge` is the "why": the rule that drew the line, the tool that
 * proposed it, its features, the evidence for and against, who confirmed
 * it, and the chain note → paragraph (hash) → quote → edge.
 *
 * The owner's IsraelConnect claim_card.js and edge_why.js were a design
 * reference only; this is a separate implementation. Pure.
 */

import type { Edge, Entity } from "../../entities/model";

export type Reliability = "A" | "B" | "C" | "D" | "E" | "F";
export type Credibility = 1 | 2 | 3 | 4 | 5 | 6;

export interface SourceMeta {
  /** The note's `reliability:` as written (A–F). */
  reliability?: string;
  /** The note's `source-class:`. */
  sourceClass?: string;
}

const CLASS_GRADE: Record<string, Reliability> = {
  court: "A",
  court_record: "A",
  official: "A",
  primary_official: "A",
  primary: "B",
  primary_organization: "B",
  academic: "B",
  media: "C",
  secondary_media_or_database: "C",
  archive: "C",
  other: "D",
};

export function reliabilityOf(meta: SourceMeta | undefined): Reliability {
  const own = meta?.reliability?.trim().toUpperCase();
  if (own && /^[A-F]$/.test(own)) return own as Reliability;
  const cls = meta?.sourceClass?.trim().toLowerCase();
  return (cls && CLASS_GRADE[cls]) || "F";
}

const sameClaim = (a: Edge, b: Edge) => a.subject === b.subject && a.predicate === b.predicate && a.object === b.object;

export interface ClaimGrade {
  reliability: Reliability;
  credibility: Credibility;
  /** Distinct notes stating the claim (not rejected) / rejecting it. */
  for: number;
  against: number;
  anchor: { note: string; anchor: string; quote: string } | null;
  /** Export only with an anchor. */
  exportable: boolean;
}

export function gradeClaim(edge: Edge, all: readonly Edge[], sourceOf: (note: string) => SourceMeta | undefined): ClaimGrade {
  const same = all.filter((e) => sameClaim(e, edge));
  const forNotes = new Set(same.filter((e) => e.status !== "rejected").map((e) => e.provenance.note));
  const againstNotes = new Set(same.filter((e) => e.status === "rejected").map((e) => e.provenance.note));
  const supporting = same.filter((e) => e.status !== "rejected");
  // The best (most reliable) supporting source grades the claim.
  const grades = supporting.map((e) => reliabilityOf(sourceOf(e.provenance.note))).sort();
  const reliability = grades[0] ?? reliabilityOf(sourceOf(edge.provenance.note));
  const approved = new Set(same.filter((e) => e.status === "approved").map((e) => e.provenance.note)).size;
  const hasQuote = !!edge.provenance.quote.trim();
  let credibility: Credibility;
  if (!hasQuote || (approved === 0 && againstNotes.size === 0)) credibility = 6;
  else if (againstNotes.size > forNotes.size) credibility = 5;
  else if (againstNotes.size > 0) credibility = 4;
  else if (approved >= 3) credibility = 1;
  else if (approved === 2) credibility = 2;
  else credibility = 3;
  const anchor = hasQuote && edge.provenance.anchor ? { note: edge.provenance.note, anchor: edge.provenance.anchor, quote: edge.provenance.quote } : null;
  return { reliability, credibility, for: forNotes.size, against: againstNotes.size, anchor, exportable: !!anchor };
}

export interface EdgeWhy {
  /** Which rule drew the line. */
  rule: { predicate: string; subject: string; object: string };
  tool: { extractor: string; model: string | null; date: string };
  features: { confidence: number; when: string | null; status: Edge["status"] };
  evidence: { for: number; against: number };
  /** Approved: the writer confirmed it; else nobody yet. */
  confirmed: boolean;
  /** Note → paragraph (hash) → quote → edge. */
  chain: Array<{ step: "note" | "paragraph" | "quote" | "edge"; value: string }>;
}

export function explainEdge(edge: Edge, all: readonly Edge[], entities: ReadonlyMap<string, Entity>): EdgeWhy {
  const same = all.filter((e) => sameClaim(e, edge));
  const name = (id: string) => entities.get(id)?.name ?? id;
  return {
    rule: { predicate: edge.predicate, subject: name(edge.subject), object: name(edge.object) },
    tool: { extractor: edge.provenance.extractor, model: edge.provenance.model, date: edge.provenance.date },
    features: { confidence: edge.confidence, when: edge.when ?? null, status: edge.status },
    evidence: { for: new Set(same.filter((e) => e.status !== "rejected").map((e) => e.provenance.note)).size, against: new Set(same.filter((e) => e.status === "rejected").map((e) => e.provenance.note)).size },
    confirmed: edge.status === "approved",
    chain: [
      { step: "note", value: edge.provenance.note },
      { step: "paragraph", value: `^${edge.provenance.anchor} (sha256 ${edge.provenance.paragraphHash.slice(0, 12)})` },
      { step: "quote", value: edge.provenance.quote },
      { step: "edge", value: `${name(edge.subject)} — ${edge.predicate} → ${name(edge.object)}` },
    ],
  };
}

/** The claim as text for export (quote, note and paragraph), or null without an anchor. */
export function exportClaim(edge: Edge, grade: ClaimGrade, entities: ReadonlyMap<string, Entity>): string | null {
  if (!grade.exportable || !grade.anchor) return null;
  const name = (id: string) => entities.get(id)?.name ?? id;
  return `${name(edge.subject)} — ${edge.predicate} → ${name(edge.object)} [${grade.reliability}${grade.credibility}]\n> ${grade.anchor.quote}\n[[${grade.anchor.note.replace(/\.md$/i, "")}#^${grade.anchor.anchor}]]`;
}
