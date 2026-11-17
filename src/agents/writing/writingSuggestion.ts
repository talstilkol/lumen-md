/**
 * What a rule-based writing check returns (W13.W11, W13.W15, W13.W13):
 * W13.W1's `CheckerFinding` (src/agents/writing/suggestion.ts), with the
 * check-specific details in `data`. A fix reaches the note only as a W1
 * suggestion through the one review path (src/agents/writingReview.ts:
 * `stageFinding`), where each is approved or rejected on its own with its
 * diff. A check never writes to the note.
 */
import type { CheckerFinding } from "./suggestion";

export type WritingSuggestion = CheckerFinding;
