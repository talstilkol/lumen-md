/**
 * Tag suggestions on this device (plan W10.C21, wiring W7.14): the open
 * note's tags from `generateStructured` — Chrome's built-in model, Ollama or
 * web-llm, whichever is there — with JSON checked against the schema, so
 * there is no free-text answer to pick apart.
 *
 * `suggestTags` (agents/commands) asks here first. When no local engine
 * gives an answer (none installed, or none matched the schema), it falls
 * back to the tagger agent on the provider the user chose, as before.
 */
import { generateStructured, type GenerateOptions, type StructuredEngineId } from "../ai/structured";
import { clip, scriptOf } from "../agents/defs/shared";
import { normalizeTags } from "../agents/defs/tagger";

export const TAGS_SCHEMA = {
  type: "object",
  properties: { tags: { type: "array", items: { type: "string", minLength: 2, maxLength: 40 }, minItems: 1, maxItems: 7 } },
  required: ["tags"],
  additionalProperties: false,
} as const;

export interface LocalTags {
  tags: string[];
  engine: StructuredEngineId;
}

/** The system prompt: the note's language, and the vocabulary already in use. */
export function tagPrompt(text: string, existing: readonly string[]): { system: string; prompt: string } {
  const hebrew = scriptOf(text) === "hebrew";
  const system =
    "Suggest 3 to 7 short lowercase kebab-case tags for the user's note. Prefer tags from the list of tags already in use when they fit. " +
    `Write tags in the note's own language${hebrew ? " (Hebrew)" : ""}. Answer with JSON only.`;
  const pool = existing.length ? `Tags already in use: ${existing.slice(0, 80).join(", ")}\n\n` : "";
  return { system, prompt: `${pool}Note:\n${clip(text, 4000)}` };
}

/**
 * Tags for `text` from a local structured engine. A short task: the built-in
 * model goes first when its Hebrew eval passed the gate (ai/structured/gate).
 * Throws StructuredOutputError when no local engine answered.
 */
export async function suggestTagsLocal(text: string, existing: readonly string[] = [], opts: GenerateOptions & { signal?: AbortSignal } = {}): Promise<LocalTags> {
  const { system, prompt } = tagPrompt(text, existing);
  const { signal, ...gen } = opts;
  const r = await generateStructured<{ tags: string[] }>({ system, prompt, schema: TAGS_SCHEMA as unknown as Record<string, unknown>, temperature: 0, signal }, { task: "short", ...gen });
  return { tags: normalizeTags(r.value.tags), engine: r.engine };
}
