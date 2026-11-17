/**
 * W13.W7's small-model question, "does this paragraph have a topic
 * sentence?", as an agent the runtime runs: local executors only (no
 * "chat", which may be a cloud provider), no tools, temperature 0, no
 * retries, the caller's AbortSignal. The answer only decides whether the
 * critic comments; it never becomes text in the note.
 */
import type { AgentDefinition, AgentInput, ExecutorId, RunOptions, AgentRun } from "../../types";
import { registerAgent } from "../../registry";
import { clip } from "../../defs/shared";
import type { TopicJudge } from "./structureCritic";

/** Local executors only (research §W: agents get no external tools and no network). */
export const LOCAL_EXECUTORS: ExecutorId[] = ["ollama", "lmstudio", "webllm", "transformers"];

export interface TopicInput extends AgentInput {
  text: string;
  extra: { lang: "he" | "en" };
}

export interface TopicOutput {
  hasTopicSentence: boolean;
}

export const topicSentenceAgent: AgentDefinition<TopicInput, TopicOutput> = registerAgent<TopicInput, TopicOutput>({
  id: "topicSentence",
  commandId: "writing.structure",
  description: "Does a paragraph have a topic sentence (yes/no)",
  system: (input) =>
    (input.extra.lang === "he" ? "אתה עורך לשוני. " : "You are an editor. ") +
    "Decide whether the paragraph has a topic sentence: one sentence (usually the first) that states what the whole paragraph is about. " +
    'Output ONLY JSON: {"hasTopicSentence": true} or {"hasTopicSentence": false}.',
  user: (input) => clip(input.text, 4000),
  outputSchema: { type: "object", properties: { hasTopicSentence: { type: "boolean" } }, required: ["hasTopicSentence"] },
  executorPreference: LOCAL_EXECUTORS,
  loopbackOnly: true,
  tools: [],
  tier: "small",
  temperature: 0,
  maxRetries: 0,
  maxTokens: 20,
});

type Runner = (def: AgentDefinition<TopicInput, TopicOutput>, input: TopicInput, opts: RunOptions) => Promise<AgentRun<TopicOutput>>;

/** A judge that asks the runtime (`runAgent`); a failed run is "no answer", so the rule decides. */
export function runtimeTopicJudge(run: Runner): TopicJudge {
  return async (paragraph, { signal, lang }) => {
    const r = await run(topicSentenceAgent, { text: paragraph, extra: { lang } }, { signal });
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    return r.status === "ok" && r.output ? r.output.hasTopicSentence === true : null;
  };
}
