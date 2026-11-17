/**
 * What a rule-based writing check returns (W13.W11, W13.W15, W13.W13).
 *
 * The fields are those of the shared Suggestion contract of W13.W1
 * (`src/agents/writing/suggestion.ts`: range, kind, message, rationale,
 * confidence, replacement, agentId, model), so a check here plugs into its
 * engine unchanged; until that lands, `stageWritingSuggestions` stages the
 * ones that carry a replacement in the review queue (agents/staging.ts),
 * where each is approved or rejected on its own with its diff. A check never
 * writes to the note.
 */
import type { ChangeProposal } from "../types";
import { rangeContext, textFingerprint } from "../staging";

export interface WritingSuggestion {
  /** Half-open [from, to) in the note's text (UTF-16). */
  range: { from: number; to: number };
  kind: string;
  /** One line for the card, in the UI language. */
  message: string;
  /** Why, in the UI language. */
  rationale: string;
  /** 0–1. */
  confidence: number;
  /** The proposed text for the range; null = a note only (nothing to replace). */
  replacement: string | null;
  agentId: string;
  /** "rules" for a rule engine; a model id otherwise. */
  model: string;
  /** Check-specific details (the lemma, the other occurrences, the source of a term…). */
  data?: Record<string, unknown>;
}

/** The review-queue proposal for one suggestion with a replacement, or null. */
export function toRangeProposal(s: WritingSuggestion, doc: string, path: string | null): ChangeProposal | null {
  if (s.replacement == null) return null;
  const before = doc.slice(s.range.from, s.range.to);
  if (before === s.replacement) return null;
  return {
    kind: "range",
    path,
    from: s.range.from,
    to: s.range.to,
    before,
    after: s.replacement,
    context: rangeContext(doc, s.range.from, s.range.to),
    basis: textFingerprint(doc),
    summary: s.message,
  } as ChangeProposal;
}
