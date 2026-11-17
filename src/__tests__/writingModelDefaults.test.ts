/**
 * Plan W13.W16 — models for the writing agents: every candidate and engine
 * has an allowed licence in the registry (gate 0.10), Hspell (AGPL) is never
 * bundled nor a default, each agent has a default per RAM tier with its
 * licence and score, and a measured score counts only with a pinned digest.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OLLAMA_CATALOG } from "../ai/modelCatalog";
import { RAM_TIERS, WRITING_AGENTS, WRITING_TABLE, defaultable, externalOnly, writingDefault, writingModelTable, writingTableMarkdown, type WritingTable } from "../agents/writing/modelDefaults";

const registry = JSON.parse(readFileSync(join(__dirname, "../../models/registry.json"), "utf8")) as { models: Array<{ id: string; class: string; license: string; delivery?: string }> };
const entry = (id: string) => registry.models.find((m) => m.id === id);

describe("W13.W16 licences", () => {
  it("every model candidate is in the registry and the catalog with an allowed licence", () => {
    const all = [...new Set([...WRITING_TABLE.candidates.he, ...WRITING_TABLE.candidates.en])];
    expect(all).toEqual(expect.arrayContaining(["gemma4:e2b", "gemma4:e4b", "hf.co/dicta-il/DictaLM-3.0-1.7B-Thinking-GGUF", "qwen3:4b", "qwen3:8b"]));
    for (const m of all) {
      expect(entry(m)?.class, m).toBe("allowed");
      expect(entry(m)?.license, m).toBe("Apache-2.0");
      expect(OLLAMA_CATALOG.some((e) => e.name === m), m).toBe(true);
      expect(defaultable(m)?.class, m).toBe("allowed");
    }
  });

  it("the rule engines are registered with allowed licences: Harper Apache-2.0, nspell MIT", () => {
    for (const [name, e] of Object.entries(WRITING_TABLE.engines)) {
      if (!e.registry) continue;
      expect(entry(e.registry)?.class, name).toBe("allowed");
      expect(entry(e.registry)?.license, name).toBe(e.license);
    }
    expect(entry("harper")?.license).toBe("Apache-2.0");
    expect(entry("nspell")?.license).toBe("MIT");
  });

  it("Hspell (AGPL) is external only: forbidden, never bundled, never a candidate or an engine", () => {
    const h = entry("hspell-he-dictionary")!;
    expect(h.class).toBe("forbidden");
    expect(h.delivery).not.toBe("bundled");
    expect(externalOnly("spelling")).toEqual(["hspell-he-dictionary"]);
    const flat = JSON.stringify({ c: WRITING_TABLE.candidates, e: WRITING_TABLE.engines });
    expect(flat).not.toMatch(/hspell/i);
    for (const a of WRITING_AGENTS) for (const t of RAM_TIERS) for (const l of ["he", "en"] as const) expect(writingDefault(a, t, l)!.model).not.toMatch(/hspell/i);
  });

  it("a conditional licence (Gemma 3, Llama) can never be a default", () => {
    expect(defaultable("gemma3:4b")).toBeNull();
    expect(defaultable("llama3.1:8b")).toBeNull();
    const bad: WritingTable = { ...WRITING_TABLE, candidates: { he: ["gemma3:4b", "qwen3:4b"], en: ["llama3.2:3b"] } };
    expect(writingDefault("abstractWriter", 8, "he", bad)?.model).toBe("qwen3:4b");
    expect(writingDefault("abstractWriter", 8, "en", bad)?.reason).toBe("none-fits");
  });
});

describe("W13.W16 defaults per RAM", () => {
  it("a table per agent: model, licence, score — for every tier and both languages", () => {
    expect(WRITING_AGENTS.length).toBeGreaterThanOrEqual(12);
    for (const l of ["he", "en"] as const)
      for (const t of RAM_TIERS) {
        const rows = writingModelTable(t, l);
        expect(rows).toHaveLength(WRITING_AGENTS.length);
        for (const r of rows) {
          expect(r.model, `${r.agent} ${t} ${l}`).toBeTruthy();
          expect(r.licence, `${r.agent} ${t} ${l}`).toBeTruthy();
          expect(r.score === null || typeof r.score === "number").toBe(true);
        }
      }
    const md = writingTableMarkdown("he");
    expect(md.split("\n")).toHaveLength(WRITING_AGENTS.length + 2);
    expect(md).toContain("| abstractWriter | llm |");
    expect(md).toContain("| grammarEn | rules | harper |");
  });

  it("the default fits the device: DictaLM 1.7B on 4 GB for Hebrew, Gemma 4 E4B on 16 GB, never above the RAM", () => {
    expect(writingDefault("abstractWriter", 4, "he")?.model).toBe("hf.co/dicta-il/DictaLM-3.0-1.7B-Thinking-GGUF");
    expect(writingDefault("abstractWriter", 8, "he")?.model).toBe("gemma4:e4b");
    expect(writingDefault("abstractWriter", 32, "he")?.model).toBe("gemma4:26b");
    expect(writingDefault("abstractWriter", 4, "en")?.model).toBe("qwen3:4b");
    expect(writingDefault("abstractWriter", 16, "en")?.model).toBe("qwen3:14b");
    for (const a of WRITING_AGENTS)
      for (const t of RAM_TIERS)
        for (const l of ["he", "en"] as const) {
          const c = writingDefault(a, t, l)!;
          if (c.kind === "llm") expect(OLLAMA_CATALOG.find((e) => e.name === c.model)!.ramGB).toBeLessThanOrEqual(t);
        }
    // Unknown memory counts as 8 GB.
    expect(writingDefault("explainChange", null, "he")).toEqual(writingDefault("explainChange", 8, "he"));
  });

  it("rule agents need no model", () => {
    expect(writingDefault("repetition", 4, "he")).toMatchObject({ kind: "rules", model: "lumen-rules", reason: "rules" });
    expect(writingDefault("grammarEn", 4, "en")).toMatchObject({ kind: "rules", model: "harper", licence: "Apache-2.0" });
    expect(writingDefault("nope", 8, "he")).toBeNull();
  });

  it("a measured score picks the default — but only for weights with a pinned digest", () => {
    const measured: WritingTable = { ...WRITING_TABLE, measured: { abstractWriter: { "gemma4:e2b": 0.81, "gemma4:e4b": 0.74 } } };
    // Not pinned yet: the measurement is ignored, the first fit stays.
    expect(writingDefault("abstractWriter", 8, "he", measured)).toMatchObject({ model: "gemma4:e4b", reason: "first-fit", score: null });
    const pinned: WritingTable = { ...measured, digests: { ...measured.digests, "gemma4:e2b": "sha256:" + "a".repeat(64), "gemma4:e4b": "sha256:" + "b".repeat(64) } };
    expect(writingDefault("abstractWriter", 8, "he", pinned)).toMatchObject({ model: "gemma4:e2b", reason: "measured", score: 0.81 });
  });

  it("every candidate has a digest slot, and no score is committed without one", () => {
    const all = [...new Set([...WRITING_TABLE.candidates.he, ...WRITING_TABLE.candidates.en])];
    for (const m of all) expect(m in WRITING_TABLE.digests, m).toBe(true);
    for (const [agent, scores] of Object.entries(WRITING_TABLE.measured)) for (const m of Object.keys(scores)) expect(WRITING_TABLE.digests[m], `${agent}/${m}`).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("W13.W16 in the app (F13: modelDefaults was reachable from tests only)", () => {
  it("the 'needs a model' error names this agent's default for the device and the note's language", async () => {
    const { suggestedModel } = await import("../commands/domains/writingActions");
    const pick = writingDefault("styleCoach", null, "he")!;
    expect(pick.kind).toBe("llm");
    const said = await suggestedModel("styleCoach", "he");
    expect(said).toContain(pick.model);
    expect(said).toContain(`ollama pull ${pick.model}`);
    // A rule engine needs no model: nothing to suggest.
    expect(await suggestedModel("readability", "en")).toBe("");
    expect(await suggestedModel("noSuchAgent", "en")).toBe("");
  });
});
