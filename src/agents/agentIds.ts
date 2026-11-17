/**
 * The agents of the eval suite (plan 7.3: every one has at least five cases
 * in src/agents/eval/fixtures.ts and moreCases.ts; a test keeps the two
 * equal). The suggestion report (W13.A4) and the model cards (W13.A5) list
 * each of them, used or not. Kept apart from the eval cases so the UI does
 * not load them.
 */
export const EVAL_AGENTS = [
  "builder-spec",
  "charter",
  "committer",
  "diagrammer",
  "formulator",
  "linker",
  "outliner",
  "proofreader",
  "researcher",
  "stylist",
  "tagger",
  "tasker",
  "templater",
  "translator",
  "writer",
] as const;

export type EvalAgent = (typeof EVAL_AGENTS)[number];
