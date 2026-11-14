// @vitest-environment node
/**
 * Plan W11.I12 — the default per RAM tier from measured results
 * (scripts/lib/modelSelect.mjs). Every card below is SYNTHETIC: invented
 * numbers that exercise the rule, not results of any model.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { measurements, selectDefaults, composite } from "../../scripts/lib/modelSelect.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { build, OUT } from "../../scripts/models-select.mjs";
import { measuredDefault } from "../ai/defaultSelection";
import { recommendOllamaModel } from "../ai/modelCatalog";

const ROOT = resolve(__dirname, "..", "..");
const ci = (v: number) => ({ value: v, ci95: [Math.max(0, v - 0.02), Math.min(1, v + 0.02)], method: "bootstrap" });
/** A SYNTHETIC card. */
const card = (model: string, dataset: string, metrics: Record<string, number>, tag = "public") => ({
  file: `synthetic/${model}-${dataset}.json`,
  report: {
    date: "2026-11-20",
    card: {
      schema: 1,
      tag,
      model: { name: model, digest: "sha256:synthetic" },
      seed: 1,
      temperature: 0,
      dataset: { name: dataset, version: "synthetic", license: "synthetic", source: "https://example.org/synthetic" },
      n: 100,
      metrics: Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, dataset === "lumen-perf" ? { value: v, ci95: [v * 0.9, v * 1.1], method: "bootstrap" } : ci(v)])),
    },
  },
});
/** Every input for one model (SYNTHETIC). */
const model = (name: string, m: { heq: number; aleph: number; nikud: number; simple: number; multiple: number; tokS: number; ram: number }, tag = "public") => [
  card(name, "heq-test", { f1: m.heq }, tag),
  card(name, "alephbench", { macro: m.aleph, nikud: m.nikud }, tag),
  card(name, "bfcl-v4", { ast_simple: m.simple, ast_multiple: m.multiple }, tag),
  card(name, "lumen-perf", { tok_s: m.tokS, peak_ram_gb: m.ram }),
];
const incumbent = model("qwen2.5:7b", { heq: 0.6, aleph: 0.5, nikud: 0.7, simple: 0.85, multiple: 0.8, tokS: 20, ram: 6.5 });
const pick = (inputs: unknown[]) => selectDefaults(measurements(inputs).byModel);

describe("the selection rule (SYNTHETIC cards)", () => {
  it("with no measurement, qwen2.5:7b stays the 8 GB default and the 4 GB tier has none", () => {
    const s = pick([]);
    expect(s[8].model).toBe("qwen2.5:7b");
    expect(s[8].reason).toMatch(/no measured results/);
    expect(s[4].model).toBeNull();
  });

  it("switches at ≥ +5 AlephBench points with ≤ 3 nikud points lost, and says why with the numbers", () => {
    const s = pick([...incumbent, ...model("gemma4:e4b", { heq: 0.62, aleph: 0.56, nikud: 0.68, simple: 0.9, multiple: 0.82, tokS: 18, ram: 7.5 })]);
    expect(s[8]).toMatchObject({ model: "gemma4:e4b", replaces: "qwen2.5:7b" });
    expect(s[8].reason).toMatch(/AlephBench \+6\.0 points, nikud −2\.0 points/);
    expect(s[8].numbers).toMatchObject({ alephMacro: 0.56, nikud: 0.68, peakRamGB: 7.5 });
    expect(s[8].incumbent.alephMacro).toBe(0.5);
  });

  it("keeps the default at +4 AlephBench points, or at −4 nikud points, even with a higher composite", () => {
    const small = pick([...incumbent, ...model("qwen3.5:4b", { heq: 0.7, aleph: 0.54, nikud: 0.7, simple: 0.95, multiple: 0.9, tokS: 40, ram: 4.5 })]);
    expect(small[8].model).toBe("qwen2.5:7b");
    expect(small[8].rejected.find((r: { model: string }) => r.model === "qwen3.5:4b").reason).toMatch(/AlephBench \+4\.0 < \+5/);
    const nikud = pick([...incumbent, ...model("gemma4:e4b", { heq: 0.7, aleph: 0.6, nikud: 0.66, simple: 0.95, multiple: 0.9, tokS: 40, ram: 7 })]);
    expect(nikud[8].model).toBe("qwen2.5:7b");
    expect(nikud[8].rejected[0].reason).toMatch(/nikud −4\.0 > 3 points/);
  });

  it("never picks a model above the tier's RAM; a tier without a default takes the best composite that fits", () => {
    const s = pick([...incumbent, ...model("big:9b", { heq: 0.9, aleph: 0.9, nikud: 0.9, simple: 0.99, multiple: 0.99, tokS: 30, ram: 9 }), ...model("gemma4:e2b", { heq: 0.5, aleph: 0.45, nikud: 0.6, simple: 0.8, multiple: 0.7, tokS: 35, ram: 3.8 })]);
    expect(s[8].model).toBe("qwen2.5:7b");
    expect(s[8].rejected.some((r: { model: string; reason: string }) => r.model === "big:9b" && /peak RAM 9 GB > 8 GB/.test(r.reason))).toBe(true);
    expect(s[4]).toMatchObject({ model: "gemma4:e2b" });
    expect(s[4].reason).toMatch(/best composite that fits 4 GB/);
  });

  it("dev-tagged quality, a toolRepair BFCL run and incomplete cards pick nothing", () => {
    const dev = model("gemma4:e4b", { heq: 0.9, aleph: 0.9, nikud: 0.9, simple: 0.99, multiple: 0.99, tokS: 30, ram: 7 }, "dev");
    const m = measurements([...incumbent, ...dev]);
    expect(m.ignored.filter((x: { reason: string }) => /dev card/.test(x.reason))).toHaveLength(3);
    expect(selectDefaults(m.byModel)[8].model).toBe("qwen2.5:7b");
    const repaired = card("qwen2.5:7b", "bfcl-v4", { ast_simple: 0.99, ast_multiple: 0.99 });
    (repaired.report as Record<string, unknown>).repair = true;
    const broken = card("qwen2.5:7b", "heq-test", { f1: 0.99 });
    delete (broken.report.card as Record<string, unknown>).seed;
    const m2 = measurements([...incumbent, repaired, broken]);
    expect(m2.ignored.map((x: { reason: string }) => x.reason)).toEqual(["toolRepair run: the default is picked on the raw score", "incomplete card: card.seed: missing (an integer)"]);
    expect(m2.byModel.get("qwen2.5:7b").heq).toBe(0.6);
  });

  it("the composite weighs HeQ, AlephBench, BFCL and speed", () => {
    expect(composite({ heq: 1, aleph: 1, bfclSimple: 1, bfclMultiple: 1, tokS: 60 })).toBe(1);
    expect(composite({ heq: 0, aleph: 0, bfclSimple: 0, bfclMultiple: 0, tokS: 15 })).toBe(0.075);
  });
});

describe("the committed selection and the app", () => {
  it("models/default-selection.json is what the committed cards give (models:select --check)", () => {
    expect(JSON.parse(readFileSync(join(ROOT, OUT), "utf8"))).toEqual(JSON.parse(JSON.stringify(build({ root: ROOT }))));
  });

  it("the app suggests the measured default of its tier, never above the device's memory", () => {
    expect(measuredDefault(8)?.model).toBe("qwen2.5:7b");
    expect(measuredDefault(null)?.model).toBe("qwen2.5:7b");
    expect(measuredDefault(6)).toBeNull();
    expect(measuredDefault(2)).toBeNull();
    expect(recommendOllamaModel({ hebrew: false, ramGB: 8 }).name).toBe("qwen2.5:7b");
    expect(recommendOllamaModel({ hebrew: false, ramGB: 4 }).ramGB).toBeLessThanOrEqual(4);
  });
});
