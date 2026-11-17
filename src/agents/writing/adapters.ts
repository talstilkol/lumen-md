/**
 * The existing checkers in the suggestion contract (plan W13.W1): the
 * proofreader's located issues and the grammar checker's matches (the
 * Hebrew rules of W5.3, LanguageTool when configured) become
 * WritingSuggestions, so they show in the same panel with the same
 * accept / reject / edit and the same one-step undo.
 */
import { makeSuggestion, type SuggestionKind, type WritingSuggestion } from "./suggestion";

/** The common shape of LocatedIssue (proofreader) and GrammarMatch (ai/grammar). */
export interface IssueLike {
  offset: number;
  length: number;
  message: string;
  replacements: ReadonlyArray<string | { value: string }>;
  rule?: { id?: string; category?: string };
}

const KIND_OF: Record<string, SuggestionKind> = { TYPOS: "spelling", GRAMMAR: "grammar", STYLE: "clarity", PUNCTUATION: "grammar", TYPOGRAPHY: "grammar", HINT: "wordChoice", REDUNDANCY: "redundancy" };

export function suggestionsFromIssues(text: string, issues: readonly IssueLike[], o: { agentId: string; model: string; confidence?: number }): WritingSuggestion[] {
  const out: WritingSuggestion[] = [];
  for (const i of issues) {
    const from = i.offset;
    const to = i.offset + i.length;
    if (from < 0 || to > text.length || to <= from) continue;
    const reps = i.replacements.map((r) => (typeof r === "string" ? r : r.value)).filter((r) => r !== text.slice(from, to));
    try {
      out.push(
        makeSuggestion(text, {
          range: { from, to },
          kind: KIND_OF[i.rule?.category ?? ""] ?? "grammar",
          message: i.message || i.rule?.id || o.agentId,
          rationale: i.rule?.id ? `${o.agentId}: ${i.rule.id}` : o.agentId,
          confidence: o.confidence ?? (o.model === "rules" ? 0.8 : 0.6),
          replacement: reps[0] ?? null,
          alternatives: reps.length > 1 ? reps.slice(1, 4) : undefined,
          agentId: o.agentId,
          model: o.model,
          ruleId: i.rule?.id,
        }),
      );
    } catch {
      /* why: an issue whose range does not fit the text is dropped, never shown */
    }
  }
  return out;
}
