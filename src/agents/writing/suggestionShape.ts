/**
 * The suggestion shape the wave-13 checkers of lane L5 (W13.W6–W10) emit.
 *
 * It is the W13.W1 contract as its plan entry states it —
 * `{range, kind, message, rationale, confidence, replacement, agentId, model}` —
 * written down here because W13.W1 (`src/agents/writing/suggestion.ts`) is
 * being built in parallel. It is structural on purpose: once W1 lands, its
 * `Suggestion` type accepts these objects unchanged, and this file becomes a
 * re-export.
 *
 * Rules every checker here keeps (W1's static ban, asserted in each test):
 * - a checker returns suggestions; it never writes a file;
 * - `replacement` is null for a comment (W7, W8 and most of W6 are comments);
 * - `rationale` always says why, in the language of the text.
 */

export interface SuggestionRange {
  /** Offset of the first character, in the note's text. */
  from: number;
  /** Offset after the last character. */
  to: number;
}

export interface WritingSuggestion {
  range: SuggestionRange;
  /** What the checker found ("fact-conflict", "heading-skip", "unsupported-claim" …). */
  kind: string;
  /** One short line for the underline's tooltip. */
  message: string;
  /** Why: the evidence, both sources, the rule. Never empty. */
  rationale: string;
  /** 0..1. */
  confidence: number;
  /** The text to put in `range` on accept; null = a comment only (no rewrite). */
  replacement: string | null;
  agentId: string;
  /** The model that took part, or "rules" when none did. */
  model: string;
  /** Vault path of the note `range` is in (vault-wide checkers). */
  path?: string;
  /** Paragraph links (`path#^anchor`) the suggestion rests on: W6 gives two. */
  links?: string[];
}

export const RULES_MODEL = "rules";

/** Clamp to 0..1 with two decimals. */
export const conf = (x: number): number => Math.round(Math.max(0, Math.min(1, x)) * 100) / 100;
