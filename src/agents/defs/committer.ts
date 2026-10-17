/**
 * committer — `git.commit`. One conventional-commit subject line from the
 * repository's change list. Light model; the parser takes the first
 * line that starts with a conventional type (skipping any preamble), and
 * the validator requires one.
 */

import type { AgentDefinition, AgentInput } from "../types";
import { registerAgent } from "../registry";
import { fail, ok, stripFences } from "./shared";

export interface CommitterInput extends AgentInput {
  /** `STATE: path` lines, one per changed file (optionally with a diff summary). */
  text: string;
}

export const CONVENTIONAL = /^(feat|fix|docs|chore|refactor|test|perf|style|build|ci|revert)(\([^)\s]+\))?!?: \S/;

/**
 * The subject line: the first line in conventional-commit form (else the
 * first non-empty line), without quotes/backticks or a trailing period,
 * trimmed to 72 chars.
 */
export function cleanSubject(text: string): string {
  const lines = stripFences(text)
    .split("\n")
    .map((l) => l.trim().replace(/^["'`]+|["'`]+$/g, "").trim())
    .filter((l) => l.length > 0);
  const subject = lines.find((l) => CONVENTIONAL.test(l)) ?? lines[0] ?? "";
  return subject.replace(/\.+$/, "").slice(0, 72).trim();
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
      check: (out) =>
        CONVENTIONAL.test(out) && out.length >= 8
          ? ok
          : fail("not a conventional-commit subject", "Answer with one line like `feat: add X` or `fix(scope): correct Y`, nothing else."),
    },
  ],
  tier: "tiny",
  temperature: 0.2,
  maxTokens: 40,
  maxRetries: 1,
});
