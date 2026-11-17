/**
 * The two real findings of the cloud fuzz run (W1.27, L4: 200 inputs per
 * decoder, seed 1), kept as regression inputs:
 *
 *  - frontmatter #6: 11 KB of nested `[` under `aliases:` hung the
 *    front-matter decoder (yaml 2.9.0). Past a few thousand levels the parser
 *    slows steeply, and 400 KB of `[` exhausts the heap inside the parser's
 *    regular-expression compiler: the tab dies. extractFrontmatter (and the
 *    Bases note reader) now refuse a block past 64 levels or 256 K chars in
 *    one linear pass (src/lib/yamlBounds.ts).
 *  - json-doctor #27 took 1.0–1.6 s. repairJson spliced every patch into
 *    the whole text, so its cost was patches × length: 80,000 missing commas
 *    took 20 s and 80,000 unquoted keys 71 s. One left-to-right pass now.
 *
 * Replay either with `node scripts/fuzz/run.mjs --target <t> --seed 1 --from <n> --runs 1`.
 */
import { describe, expect, it } from "vitest";
import { generate } from "../../scripts/fuzz/generators";
import { MAX_YAML_FLOW_DEPTH, parseFrontmatterYaml, yamlBoundsError, yamlFlowDepth } from "../lib/yamlBounds";
import { extractFrontmatter } from "../renderer/pipeline";
import { repairJson } from "../data/codeDoctor";

const time = (f: () => unknown): number => {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
};

describe("front matter: depth and size bounds (fuzz frontmatter s1#6)", () => {
  it("refuses the fuzz input #6 before parsing it", () => {
    const input = generate("yaml", 1, 6);
    expect(input.startsWith("aliases: [[[[")).toBe(true);
    expect(yamlFlowDepth(input)).toBeGreaterThan(3000);
    expect(yamlBoundsError(input)).toMatch(/nested deeper than 64/);
    expect(parseFrontmatterYaml(input)).toBeNull();
    expect(extractFrontmatter(`---\n${input}\n---\nbody\n`)).toBeNull();
  });

  it("a deep block costs a linear scan, not a parse", () => {
    const deep = `---\naliases: ${"[".repeat(120_000)}\n---\nbody\n`;
    // Unbounded, yaml 2.9.0 takes ~0.6 s here (and runs out of heap at 400 KB).
    expect(time(() => expect(extractFrontmatter(deep)).toBeNull())).toBeLessThan(150);
  });

  it("refuses an over-long block and keeps real front matter", () => {
    expect(yamlBoundsError(`a: "${"x".repeat(300_000)}"`)).toMatch(/longer than/);
    const nested = `t: ${"[".repeat(MAX_YAML_FLOW_DEPTH)}1${"]".repeat(MAX_YAML_FLOW_DEPTH)}`;
    expect(yamlBoundsError(nested)).toBeNull();
    expect(extractFrontmatter("---\ntitle: שלום\ntags: [a, [b, {c: 1}]]\n---\nbody\n")).toEqual({
      title: "שלום",
      tags: ["a", ["b", { c: 1 }]],
    });
  });

  it("still throws what YAML.parse throws for invalid YAML (callers catch it)", () => {
    expect(() => parseFrontmatterYaml("a: [1, 2")).toThrow();
  });
});

describe("json-doctor: linear repair (fuzz json-doctor s1#27)", () => {
  it("repairs the fuzz input #27 quickly", () => {
    const input = generate("json", 1, 27);
    expect(input.length).toBeGreaterThan(19_000);
    let out = "";
    expect(time(() => (out = repairJson(input).output))).toBeLessThan(400);
    expect(out.length).toBeGreaterThan(0);
  });

  it("80,000 missing commas and 80,000 unquoted keys repair in linear time", () => {
    const commas = `[${Array.from({ length: 80_000 }, (_, i) => i).join(" ")}]`;
    const keys = `{${Array.from({ length: 80_000 }, (_, i) => `k${i}:'v'`).join(",")}}`;
    let a = "";
    let b = "";
    // Splicing per patch: 20 s and 71 s on the cloud machine.
    expect(time(() => (a = repairJson(commas).output))).toBeLessThan(3000);
    expect(time(() => (b = repairJson(keys).output))).toBeLessThan(3000);
    expect(JSON.parse(a)).toHaveLength(80_000);
    expect(Object.keys(JSON.parse(b) as object)).toHaveLength(80_000);
  });

  it("gives the same text as before on mixed repairs", () => {
    const r = repairJson("{a: 'x', “b”: [1 2 3,], c: {d: 'y'}");
    expect(r.output).toBe('{"a": "x", "b": [1, 2, 3], "c": {"d": "y"}}');
    expect(JSON.parse(r.output)).toEqual({ a: "x", b: [1, 2, 3], c: { d: "y" } });
  });
});
