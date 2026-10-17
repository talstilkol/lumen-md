/**
 * committer — `git.commit`. One conventional-commit subject line from the
 * repository's change list. Light model; the validator trims it to one
 * line of at most 72 characters.
 */

import type { AgentDefinition, AgentInput } from "../types";
import { registerAgent } from "../registry";
import { fail, ok, stripFences } from "./shared";

export interface CommitterInput extends AgentInput {
  /** `STATE: path` lines, one per changed file (optionally with a diff summary). */
  text: string;
}

/** First non-empty line, without quotes/backticks, trimmed to 72 chars. */
export function cleanSubject(text: string): string {
  const first = stripFences(text)
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? "";
  return first.replace(/^["'`]+|["'`]+$/g, "").trim().slice(0, 72);
}

export const committerAgent: AgentDefinition<CommitterInput, string> = registerAgent({
  id: "committer",
  commandId: "git.commit",
  description: "Write a one-line conventional commit message",
  system:
    "You are a Git commit message generator. Based on the changed files (and diff summary when given), output ONLY " +
    "one concise commit subject line in conventional-commit format (feat:, fix:, docs:, chore:, refactor:, test:), " +
    "imperative mood, at most 72 characters, no trailing period, no quotes, no explanation.",
  user: (input) => `Changes:\n${input.text.slice(0, 6000)}`,
  parse: (text) => cleanSubject(text),
  validators: [
    {
      name: "subject",
      check: (out) => (out.length >= 8 && !/\n/.test(out) ? ok : fail("subject too short", "One line, at least a few words.")),
    },
  ],
  tier: "tiny",
  temperature: 0.2,
  maxTokens: 40,
  maxRetries: 1,
});
