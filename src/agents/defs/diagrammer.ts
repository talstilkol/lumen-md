/**
 * diagrammer — `ai.diagram`. Turns prose into one Mermaid diagram. The
 * validator compiles the diagram with the real Mermaid parser; a syntax
 * error goes back to the model for the retry.
 */

import type { AgentDefinition, AgentInput } from "../types";
import { registerAgent } from "../registry";
import { mermaidValidator, stripMermaidFence } from "../tools/validate";
import { clip } from "./shared";

export interface DiagrammerInput extends AgentInput {
  text: string;
}

export const diagrammerAgent: AgentDefinition<DiagrammerInput, string> = registerAgent<DiagrammerInput, string>({
  id: "diagrammer",
  commandId: "ai.diagram",
  description: "Convert prose into a Mermaid diagram",
  system:
    "You convert prose into a single Mermaid diagram. Choose the most fitting diagram type (flowchart, " +
    "sequenceDiagram, classDiagram, stateDiagram-v2, mindmap, gantt, …). Output ONLY the raw Mermaid " +
    "definition — no code fences, no prose, no explanation. Node labels in the text's language; quote labels " +
    'that contain punctuation (A["label (x)"]). Keep it valid Mermaid syntax.',
  user: (input) => clip(input.text, 8000),
  parse: (text) => stripMermaidFence(text),
  validators: [mermaidValidator],
  tier: "small",
  temperature: 0.2,
  maxTokens: 1200,
  cache: true,
});
