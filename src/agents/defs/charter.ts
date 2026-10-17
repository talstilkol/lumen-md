/**
 * charter — `ai.chart`. Turns CSV / table data into an ECharts option.
 * The validator checks the option's structure (typed series with data,
 * axes for cartesian charts); the parsed object is returned so the
 * caller serialises it exactly once.
 */

import type { AgentDefinition, AgentInput } from "../types";
import { registerAgent } from "../registry";
import { checkJson, echartsValidator } from "../tools/validate";
import { clip } from "./shared";

export interface CharterInput extends AgentInput {
  text: string;
}

export type EChartsOption = Record<string, unknown>;

export const charterAgent: AgentDefinition<CharterInput, EChartsOption> = registerAgent<CharterInput, EChartsOption>({
  id: "charter",
  language: "any",
  commandId: "ai.chart",
  description: "Turn tabular data into an ECharts option",
  system:
    "You are a data visualization assistant. Given raw CSV or Markdown-table data, output ONLY a valid ECharts " +
    "option as a JSON object: a `series` array where every series has a `type` (bar, line, pie, scatter…) and " +
    "`data`, plus `xAxis` and `yAxis` for bar/line/scatter charts, and a short `title`. Use the header row for " +
    "axis names and legends. No code fences, no explanation, no JavaScript functions.",
  user: (input) => clip(input.text, 12000),
  outputSchema: {
    type: "object",
    properties: { series: { type: "array", minItems: 1, items: { type: "object", properties: { type: { type: "string" }, data: { type: "array" } }, required: ["type", "data"] } } },
    required: ["series"],
  },
  parse: (text) => {
    const r = checkJson(text);
    if (!r.ok) throw new Error(r.error);
    return r.value as EChartsOption;
  },
  validators: [echartsValidator],
  tier: "small",
  temperature: 0.1,
  maxTokens: 1500,
  cache: true,
});
