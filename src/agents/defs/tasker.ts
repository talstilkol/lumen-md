/**
 * tasker — `ai.actionItems`. Turns meeting notes into a Markdown task
 * list. Text output; the validator requires at least one `- [ ]` item.
 */

import type { AgentDefinition, AgentInput } from "../types";
import { registerAgent } from "../registry";
import { clip, fail, ok, stripFences } from "./shared";

export interface TaskerInput extends AgentInput {
  text: string;
}

const TASK_LINE = /^\s*[-*]\s*\[[ xX]\]\s+\S/m;

export const taskerAgent: AgentDefinition<TaskerInput, string> = registerAgent({
  id: "tasker",
  commandId: "ai.actionItems",
  description: "Extract action items from notes as a task list",
  system:
    "You extract action items from meeting notes. Output ONLY a Markdown task list (`- [ ] item`), one item per " +
    "line, each with an owner in parentheses when identifiable and a due date when stated. No headings, no " +
    "preamble, no explanation. Keep the notes' language. If there are no action items, output exactly: - [ ] (none)",
  user: (input) => clip(input.text, 12000),
  parse: (text) => stripFences(text),
  validators: [{ name: "task-list", check: (out) => (TASK_LINE.test(out) ? ok : fail("no `- [ ]` task line in the answer", "Return Markdown task list lines only.")) }],
  tier: "small",
  temperature: 0.1,
  maxTokens: 800,
  cache: true,
});
