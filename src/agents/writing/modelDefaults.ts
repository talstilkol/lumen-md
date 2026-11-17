/**
 * Which model each writing agent uses (plan W13.W16): "no external tools"
 * means a local model whose licence lets us distribute and recommend it,
 * chosen by measurement and not by name.
 *
 * The table is models/writing-defaults.json: per agent, a rule engine
 * (lumen-md's own rules, Harper for English grammar — Apache-2.0 — or
 * nspell — MIT) or a local model; per note language, the model candidates
 * in preference order. A device gets the first candidate that fits its RAM
 * (OLLAMA_CATALOG `ramGB`) with an allowed licence (models/registry.json,
 * gate 0.10); once W13.W17 measures them on the Mac, the best measured
 * score that fits wins. A measured model must carry a pinned digest.
 *
 * The Hebrew Hspell dictionary is AGPL: never bundled and never a default;
 * only an optional external download the user starts (the W1.34 pattern).
 */
import table from "../../../models/writing-defaults.json";
import { OLLAMA_CATALOG, ollamaLicence, type ModelLicence } from "../../ai/modelCatalog";

export type WritingAgentKind = "llm" | "rules";

interface AgentRow {
  kind: WritingAgentKind;
  engine?: string;
  plan: string;
  external?: string[];
}

export interface WritingTable {
  tiers: number[];
  candidates: Record<"he" | "en", string[]>;
  agents: Record<string, AgentRow>;
  engines: Record<string, { license: string; registry: string | null }>;
  measured: Record<string, Record<string, number>>;
  digests: Record<string, string | null>;
}

export const WRITING_TABLE = table as unknown as WritingTable;

export const WRITING_AGENTS: readonly string[] = Object.keys(WRITING_TABLE.agents);
export const RAM_TIERS: readonly number[] = WRITING_TABLE.tiers;

export interface WritingChoice {
  agent: string;
  kind: WritingAgentKind;
  /** The model id (Ollama name) or the rule engine; "" when nothing fits. */
  model: string;
  licence: string;
  /** The measured score on the agent's eval (W13.W17), or null while unmeasured. */
  score: number | null;
  reason: "measured" | "first-fit" | "rules" | "none-fits";
}

const ramOf = (model: string) => OLLAMA_CATALOG.find((e) => e.name === model)?.ramGB ?? Infinity;

/** May a writing agent default to this model? Allowed licence only. */
export function defaultable(model: string): ModelLicence | null {
  const l = ollamaLicence(model);
  return l && l.class === "allowed" ? l : null;
}

/** The default for one agent on a device with `ramGB` (unknown = 8) for notes in `lang`. */
export function writingDefault(agent: string, ramGB: number | null | undefined, lang: "he" | "en", t: WritingTable = WRITING_TABLE): WritingChoice | null {
  const row = t.agents[agent];
  if (!row) return null;
  if (row.kind === "rules") {
    const engine = row.engine ?? "lumen-rules";
    return { agent, kind: "rules", model: engine, licence: t.engines[engine]?.license ?? "unknown", score: null, reason: "rules" };
  }
  const ram = ramGB ?? 8;
  const fits = t.candidates[lang].filter((m) => ramOf(m) <= ram && defaultable(m));
  const measured = t.measured[agent] ?? {};
  // A score counts only for a model whose digest is pinned: the number belongs to those weights.
  const scored = fits.filter((m) => typeof measured[m] === "number" && t.digests[m]).sort((a, b) => measured[b] - measured[a]);
  const pick = scored[0] ?? fits[0];
  if (!pick) return { agent, kind: "llm", model: "", licence: "", score: null, reason: "none-fits" };
  return { agent, kind: "llm", model: pick, licence: defaultable(pick)!.name, score: scored[0] ? measured[pick] : null, reason: scored[0] ? "measured" : "first-fit" };
}

/** The table for every writing agent: model (or engine), licence and score. */
export function writingModelTable(ramGB: number | null | undefined, lang: "he" | "en", t: WritingTable = WRITING_TABLE): WritingChoice[] {
  return Object.keys(t.agents).map((a) => writingDefault(a, ramGB, lang, t)!);
}

/** The table as Markdown: per agent, the default at each RAM tier, its licence and score. */
export function writingTableMarkdown(lang: "he" | "en", t: WritingTable = WRITING_TABLE): string {
  const rows = [`| agent (${lang}) | kind | ${t.tiers.map((x) => `${x} GB`).join(" | ")} | licence | score |`, `|---|---|${t.tiers.map(() => "---|").join("")}---|---|`];
  for (const a of Object.keys(t.agents)) {
    const picks = t.tiers.map((x) => writingDefault(a, x, lang, t)!);
    const top = picks[picks.length - 1];
    const licences = [...new Set(picks.map((p) => p.licence).filter(Boolean))].join(", ");
    rows.push(`| ${a} | ${top.kind} | ${picks.map((p) => p.model || "—").join(" | ")} | ${licences} | ${top.score ?? "unmeasured"} |`);
  }
  return rows.join("\n");
}

/** External, optional engines an agent may use but never ships or defaults to (Hspell: AGPL). */
export function externalOnly(agent: string): string[] {
  return WRITING_TABLE.agents[agent]?.external ?? [];
}
