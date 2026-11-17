/**
 * W13.W17 / W13.W18 tooling (the owner's and the Mac's steps; the steps
 * themselves are not done here): the writing defaults move only on heldout
 * or public cards with a pinned digest, and the writing held-out set is
 * "ready" only when it is sealed and two annotators agree (kappa >= 0.6).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyCards } from "../../scripts/writing-defaults-update.mjs";
import { checkWritingSet } from "../../scripts/lib/heldoutCheck.mjs";
import { agreement, readLabels } from "../../scripts/writing-agreement.mjs";
import { writingDefault, type WritingTable } from "../agents/writing/modelDefaults";

const table = JSON.parse(readFileSync(join(__dirname, "../../models/writing-defaults.json"), "utf8")) as WritingTable;
const card = (tag: string, model: string, digest: string, value: number) => ({
  agent: "abstractWriter",
  card: { schema: 1, tag, model: { name: model, digest }, seed: 1, temperature: 0, dataset: { name: "writing-he", version: "1", license: "CC-BY-4.0" }, n: 300, metrics: { preference: { value, ci95: [value - 0.05, value + 0.05], method: "bootstrap" } } },
});
const SHA = (c: string) => `sha256:${c.repeat(64)}`;

describe("W13.W17 defaults from the Mac's numbers", () => {
  it("heldout cards with a digest move the default; dev cards and unpinned weights do not", () => {
    const r = applyCards(table, [
      { file: "a.json", report: card("heldout", "gemma4:e2b", SHA("a"), 0.82) },
      { file: "b.json", report: card("heldout", "gemma4:e4b", SHA("b"), 0.71) },
      { file: "c.json", report: card("dev", "qwen3:8b", SHA("c"), 0.99) },
      { file: "d.json", report: card("heldout", "qwen3:4b", "n/a", 0.99) },
      { file: "e.json", report: { ...card("heldout", "gemma4:e2b", SHA("a"), 0.9), agent: "repetition" } },
    ]);
    expect(r.applied).toHaveLength(2);
    expect(r.skipped.map((s) => s.split(":")[0])).toEqual(["c.json", "d.json", "e.json"]);
    const t = r.table as WritingTable;
    expect(writingDefault("abstractWriter", 8, "he", t)).toMatchObject({ model: "gemma4:e2b", score: 0.82, reason: "measured" });
    // The committed table is not changed by a dry run.
    expect(table.measured).toEqual({});
  });
});

describe("W13.W18 the writing held-out set", () => {
  it("absent today: the check says what the owner must do", () => {
    const m = JSON.parse(readFileSync(join(__dirname, "../../eval/heldout/manifest.json"), "utf8"));
    const r = checkWritingSet(m, "writing");
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toContain("W13.W18");
  });

  it("ready only when sealed, 2 annotators, ≥ 300 items, kappa ≥ 0.6, not the rule authors", () => {
    const sealed = { version: 1, n: 300, digest: "x".repeat(64), builtAt: "2026-12-01T00:00:00Z" };
    const good = { sets: [{ id: "writing-he", sealed, agreement: { annotators: 2, items: 300, kappa: 0.71, ruleAuthors: false } }] };
    expect(checkWritingSet(good).ok).toBe(true);
    expect(checkWritingSet({ sets: [{ id: "writing-he", sealed, agreement: { annotators: 2, items: 300, kappa: 0.52, ruleAuthors: false } }] }).ok).toBe(false);
    expect(checkWritingSet({ sets: [{ id: "writing-he", agreement: good.sets[0].agreement }] }).lines[0]).toContain("not sealed");
    expect(checkWritingSet({ sets: [{ id: "writing-he", sealed, agreement: { annotators: 2, items: 300, kappa: 0.8 } }] }).ok).toBe(false);
  });

  it("Cohen's kappa between two annotators' label files", () => {
    const a = readLabels(['{"id":"1","label":"ok"}', '{"id":"2","label":"bad"}', '{"id":"3","label":"ok"}', '{"id":"4","label":"bad"}'].join("\n"));
    const b = readLabels(['{"id":"1","label":"ok"}', '{"id":"2","label":"bad"}', '{"id":"3","label":"bad"}', '{"id":"4","label":"bad"}', '{"id":"5","label":"ok"}'].join("\n"));
    const r = agreement(a, b);
    expect(r.items).toBe(4);
    expect(r.kappa).toBe(0.5);
    expect(agreement(a, a).kappa).toBe(1);
    expect(() => agreement(a, new Map())).toThrow();
  });
});
