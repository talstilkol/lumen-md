/**
 * Stage 2 of the improvement agent: a small local model reads what went
 * wrong (the task, the failure, what was already tried) and proposes up
 * to three concrete suggestions in plain language, which the suggestions
 * panel shows next to the deterministic ones. It runs only after the
 * retries are exhausted, on the tiny tier, and never on itself.
 */

import { setModelCritic, type Failure, type Verdict } from "./critic";
import { pickExecutor } from "./executors";
import { checkJson } from "./tools/validate";
import type { Suggestion } from "./types";

const SYSTEM =
  "You help a user whose AI command failed in a local-first markdown editor. Given the failure, propose at most 3 " +
  "short, concrete things THE USER can do (rephrase or shorten the input, select a smaller part, pick a larger local " +
  'model, check that Ollama is running…). Output ONLY JSON: {"diagnosis": "one sentence", "suggestions": ' +
  '[{"title": "imperative, ≤ 8 words", "detail": "one sentence"}]}. No suggestion may send data to the cloud.';

export async function modelReview(f: Failure, stage1: Verdict): Promise<Verdict | null> {
  if (f.agentId === "critic") return null;
  const { executor } = await pickExecutor();
  if (!executor) return null;
  const facts = {
    agent: f.agentId,
    failure: f.kind,
    reason: (f.reason ?? "").slice(0, 400),
    validator: f.label,
    attempts: f.attempt,
    tier: f.tier,
    inputChars: f.inputChars,
    alreadySuggested: stage1.suggestions.map((s) => s.id),
  };
  const res = await executor.chat({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify(facts) },
    ],
    tier: "tiny",
    temperature: 0,
    maxTokens: 300,
    signal: f.signal,
    schema: executor.supportsSchema() ? { type: "object", properties: { diagnosis: { type: "string" }, suggestions: { type: "array" } }, required: ["suggestions"] } : undefined,
  });
  if (f.signal?.aborted) return null;
  const j = checkJson(res.content);
  if (!j.ok) return null;
  const v = j.value as { diagnosis?: unknown; suggestions?: unknown };
  const list = Array.isArray(v.suggestions) ? v.suggestions : [];
  const suggestions: Suggestion[] = list
    .filter((x): x is { title: string; detail?: string } => !!x && typeof (x as { title?: unknown }).title === "string")
    .slice(0, 3)
    .map((x, i) => ({ id: `model-${i}`, title: x.title.slice(0, 80), detail: typeof x.detail === "string" ? x.detail.slice(0, 240) : undefined, raw: true }));
  if (!suggestions.length) return null;
  return { diagnosis: stage1.diagnosis, suggestions: [...stage1.suggestions, ...suggestions] };
}

/** Install the model critic (called once at app start; tests leave it off). */
export function installModelCritic(): void {
  setModelCritic(async (f, v) => {
    try {
      return await modelReview(f, v);
    } catch {
      return null;
    }
  });
}
