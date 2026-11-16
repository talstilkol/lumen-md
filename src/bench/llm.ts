/**
 * The LLM engines' shared step (plan 7.8, W10.E34): the translator agent's
 * own prompt (its system text, user text, parse, temperature and token cap)
 * sent through the app's executor with the model pinned. The runtime's
 * agent loop is not used here, on purpose: it picks its own model for the
 * agent's tier (a pinned tiny model is replaced by a "small" one, and a
 * model without native tools by a function-calling one), so its numbers
 * would belong to another registry entry. The executor's answer names the
 * model that ran; a different one is an error, never a number. The request
 * still goes through the runtime as a module's own local request
 * (runLocalRequest, plan 5.5.3): in the trace, no tools, never the cloud.
 */
import { translatorAgent } from "../agents/defs";
import { runLocalRequest } from "../agents/runtime";
import type { Executor } from "../agents/types";

/** A stuck model fails its item instead of hanging the whole bench (T55: every run carries a cancel signal). */
const ITEM_TIMEOUT_MS = 120_000;

export async function translateWith(executor: Executor, model: string, text: string): Promise<string> {
  const input = { text, extra: { targetLanguage: "English" } };
  const system = typeof translatorAgent.system === "function" ? translatorAgent.system(input) : translatorAgent.system;
  const r = await runLocalRequest(executor, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: translatorAgent.user(input) },
    ],
    model,
    temperature: translatorAgent.temperature,
    maxTokens: typeof translatorAgent.maxTokens === "function" ? translatorAgent.maxTokens(input) : translatorAgent.maxTokens,
    think: false,
    signal: AbortSignal.timeout(ITEM_TIMEOUT_MS),
  }, { agentId: "bench-translator" });
  if (r.model !== model && !r.model.startsWith(`${model}-`) && !r.model.startsWith(`${model}:`)) throw new Error(`asked for ${model}, ${executor.id} answered with ${r.model}`);
  return String(translatorAgent.parse ? translatorAgent.parse(r.content, input) : r.content.trim());
}
