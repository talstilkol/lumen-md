/**
 * tagger — `tools.autoTag`. Proposes 3–7 tags for a document, preferring
 * the vocabulary already used in the workspace. One shot, JSON output
 * checked against the schema; tags are normalised afterwards (Unicode
 * letters allowed, so Hebrew tags survive).
 */

import type { AgentDefinition, AgentInput } from "../types";
import { registerAgent } from "../registry";
import { clip, fail, ok, scriptOf } from "./shared";

export interface TaggerInput extends AgentInput {
  text: string;
  extra: { existing: string[] };
}

export interface TaggerOutput {
  tags: string[];
}

/** lowercase, kebab-case, Unicode letters/digits only, deduped, at most 7. */
export function normalizeTags(raw: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const t = String(r)
      .trim()
      .toLowerCase()
      .replace(/^#+/, "")
      .replace(/[\s_/]+/g, "-")
      .replace(/[^\p{L}\p{N}-]/gu, "")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "");
    if (t.length > 1 && t.length < 40 && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
    if (out.length >= 7) break;
  }
  return out;
}

export const taggerAgent: AgentDefinition<TaggerInput, TaggerOutput> = registerAgent({
  id: "tagger",
  commandId: "tools.autoTag",
  description: "Suggest tags for the open document from the workspace vocabulary",
  system: (input) =>
    "You are a tag-suggestion assistant. The user shares a markdown document and the tags they already use " +
    "across their notes. Suggest 3 to 7 concise lowercase kebab-case tags that capture the document's topics. " +
    "Prefer tags from the existing pool when they fit. Write tags in the document's own language" +
    (scriptOf(input.text) === "hebrew" ? " (Hebrew)" : "") +
    '. Output ONLY a JSON object of the form {"tags": ["tag-one", "tag-two"]}.',
  user: (input) =>
    `Existing tags (most used first):\n${input.extra.existing.slice(0, 80).join(", ") || "(none yet)"}\n\nDocument:\n${clip(input.text, 6000)}`,
  outputSchema: {
    type: "object",
    properties: { tags: { type: "array", items: { type: "string", minLength: 1, maxLength: 60 }, minItems: 1, maxItems: 10 } },
    required: ["tags"],
  },
  validators: [
    {
      name: "tags",
      check: (out) => (normalizeTags(out.tags).length ? ok : fail("no usable tags", "Return at least one short tag.")),
    },
  ],
  tier: "small",
  temperature: 0.2,
  maxTokens: 200,
  cache: true,
});
