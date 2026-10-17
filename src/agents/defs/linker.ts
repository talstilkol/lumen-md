/**
 * linker — `tools.suggestLinks`. Finds up to 5 phrases in the open note
 * that should link to other notes. The catalogue of other notes (title +
 * first sentence) is injected; the validator keeps only suggestions whose
 * phrase is in the body verbatim and whose target is a real note.
 */

import type { AgentDefinition, AgentInput } from "../types";
import { registerAgent } from "../registry";
import { clip, fail, ok } from "./shared";

export interface LinkSuggestion {
  phrase: string;
  target: string;
  reason: string;
}

export interface LinkerInput extends AgentInput {
  text: string;
  extra: { catalog: string; titles: string[] };
}

export interface LinkerOutput {
  links: LinkSuggestion[];
}

/** Suggestions that point at a real note and quote the body verbatim; at most 5. */
export function filterLinks(links: unknown, body: string, titles: string[]): LinkSuggestion[] {
  if (!Array.isArray(links)) return [];
  const known = new Set(titles.map((t) => t.toLowerCase()));
  const out: LinkSuggestion[] = [];
  for (const l of links) {
    if (!l || typeof l !== "object") continue;
    const { phrase, target, reason } = l as Partial<LinkSuggestion>;
    if (typeof phrase !== "string" || typeof target !== "string" || phrase.length < 2 || !target) continue;
    if (!body.includes(phrase)) continue;
    const match = titles.find((t) => t.toLowerCase() === target.toLowerCase());
    if (!match && !known.has(target.toLowerCase())) continue;
    out.push({ phrase, target: match ?? target, reason: typeof reason === "string" ? reason : "" });
    if (out.length >= 5) break;
  }
  return out;
}

export const linkerAgent: AgentDefinition<LinkerInput, LinkerOutput> = registerAgent({
  id: "linker",
  language: "any",
  commandId: "tools.suggestLinks",
  description: "Suggest wiki-links from the open note to other notes",
  system:
    "You are a wiki-link suggestion assistant. The user shares the body of a markdown note and a list of OTHER notes " +
    "in their workspace (title — first sentence). Identify up to 5 places in the body where a [[Note Title]] link would " +
    'help the reader. Output ONLY a JSON object: {"links": [{"phrase": "literal text copied from the body", ' +
    '"target": "exact title of one of the listed notes", "reason": "at most 12 words"}]}. The phrase MUST appear ' +
    "verbatim in the body and the target MUST be one of the listed titles. Skip anything you are not confident about; " +
    'an empty list {"links": []} is a valid answer.',
  user: (input) => `Current note body:\n${clip(input.text, 5000)}\n\nOther notes:\n${input.extra.catalog}`,
  outputSchema: {
    type: "object",
    properties: {
      links: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          properties: { phrase: { type: "string", minLength: 2 }, target: { type: "string", minLength: 1 }, reason: { type: "string" } },
          required: ["phrase", "target"],
        },
      },
    },
    required: ["links"],
  },
  validators: [
    {
      name: "links",
      check: (out, input) => {
        if (!out.links.length) return ok; // nothing to link is an answer
        const kept = filterLinks(out.links, input.text ?? "", (input as LinkerInput).extra.titles);
        return kept.length ? ok : fail("no suggestion quotes the body verbatim with a listed title", "Copy phrases exactly from the body and use only listed titles.");
      },
    },
  ],
  tier: "small",
  temperature: 0.2,
  maxTokens: 500,
  cache: true,
});
