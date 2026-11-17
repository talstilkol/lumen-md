/**
 * The suggestion shape the wave-13 checkers of lane L5 (W13.W6–W10) emit:
 * W13.W1's `CheckerFinding` (src/agents/writing/suggestion.ts) — W1's
 * fields with the checker's own finding kind, the note's path and the
 * paragraph links. It reaches the user only as a W1 suggestion, through
 * the one review path (src/agents/writingReview.ts: `fromFinding`, then the
 * review panel).
 *
 * Rules every checker here keeps (W1's static checks, one helper for every
 * writing agent: src/__tests__/helpers/writingStatic.ts):
 * - a checker returns suggestions; it never writes a file;
 * - `replacement` is null for a comment (W7, W8 and most of W6 are comments);
 * - `rationale` always says why, in the language of the text.
 */
import type { CheckerFinding, TextRange } from "./suggestion";

export type SuggestionRange = TextRange;
export type WritingSuggestion = CheckerFinding;

export const RULES_MODEL = "rules";

/** Clamp to 0..1 with two decimals. */
export const conf = (x: number): number => Math.round(Math.max(0, Math.min(1, x)) * 100) / 100;
