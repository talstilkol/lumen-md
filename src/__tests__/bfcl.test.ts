// @vitest-environment node
/**
 * Plan W11.I15 — the BFCL v4 harness (src/agents/eval/bfcl.ts) on BFCL's own
 * vendored data (eval/public/bfcl-v4, Apache-2.0). No model runs here: the
 * engines below are the harness's self-tests, labelled as such. The real
 * runs are `npm run eval:bfcl` on a machine with Ollama (W11.M4).
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  astCheck,
  CATEGORIES,
  CLASS_DOCS,
  FILES,
  METRIC,
  oracleEngine,
  parseJsonl,
  parsePyCall,
  runBfcl,
  scoresByCategory,
  simpleFunctionChecker,
  standardizeString,
  type BfclAnswer,
  type BfclData,
  type BfclEngine,
  type BfclEntry,
  type BfclFunction,
} from "../agents/eval/bfcl";
// @ts-expect-error — plain .mjs module without type declarations
import { makeCard, validateCard } from "../../scripts/lib/evalCard.mjs";

const DIR = resolve(__dirname, "..", "..", "eval/public/bfcl-v4");
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as { commit: string; license: string; source: string; files: { path: string; sha256: string; lines: number }[] };
const read = (p: string) => readFileSync(join(DIR, p), "utf8");

function load(): BfclData {
  const entries = Object.values(FILES).flatMap((f) => parseJsonl<BfclEntry>(read(`data/${f}`)));
  const answers = new Map(Object.values(FILES).flatMap((f) => parseJsonl<BfclAnswer>(read(`possible_answer/${f}`))).map((a) => [a.id, a]));
  const classDocs = Object.fromEntries(Object.entries(CLASS_DOCS).map(([c, f]) => [c, parseJsonl<BfclFunction>(read(`multi_turn_func_doc/${f}`))]));
  return { entries, answers, classDocs };
}
const data = load();

describe("the vendored BFCL v4 data", () => {
  it("every file matches its pinned sha256, and the licence is Apache-2.0", () => {
    expect(manifest.license).toBe("Apache-2.0");
    expect(read("LICENSE")).toMatch(/Apache License\s+Version 2\.0/);
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.files).toHaveLength(16);
    for (const f of manifest.files) expect(createHash("sha256").update(readFileSync(join(DIR, f.path))).digest("hex"), f.path).toBe(f.sha256);
  });

  it("holds the four categories at BFCL's sizes, each entry with its answer", () => {
    const n = (c: string) => data.entries.filter((e) => e.id.startsWith(c)).length;
    expect([n("simple_python"), n("multiple_"), n("parallel_"), n("multi_turn_base")]).toEqual([400, 200, 200, 200]);
    for (const e of data.entries) expect(data.answers.has(e.id), e.id).toBe(true);
  });
});

describe("the AST checker (a port of ast_checker.py)", () => {
  const fd: BfclFunction = {
    name: "calculate_triangle_area",
    description: "",
    parameters: { type: "dict", properties: { base: { type: "integer" }, height: { type: "integer" }, unit: { type: "string" }, ratio: { type: "float" }, tags: { type: "array", items: { type: "string" } } }, required: ["base", "height"] },
  };
  const possible = { calculate_triangle_area: { base: [10], height: [5], unit: ["units", ""], ratio: [0.5, ""], tags: [["a b", "c"], ""] } };
  const check = (args: Record<string, unknown>) => simpleFunctionChecker(fd, { calculate_triangle_area: args }, possible);

  it("accepts the answer, optional parameters left out, and int for a float", () => {
    expect(check({ base: 10, height: 5 }).valid).toBe(true);
    expect(check({ base: 10, height: 5, unit: "Units" }).valid).toBe(true);
    expect(check({ base: 10, height: 5, ratio: 0.5 }).valid).toBe(true);
    expect(simpleFunctionChecker({ ...fd, parameters: { ...fd.parameters, properties: { ...fd.parameters.properties, ratio: { type: "float" } } } }, { calculate_triangle_area: { base: 10, height: 5, ratio: 1 } }, { calculate_triangle_area: { ...possible.calculate_triangle_area, ratio: [1.0] } }).valid).toBe(true);
  });

  it("refuses what BFCL refuses", () => {
    expect(check({ base: 10 }).errorType).toBe("simple_function_checker:missing_required");
    expect(check({ base: 10, height: 5, colour: "red" }).errorType).toBe("simple_function_checker:unexpected_param");
    expect(check({ base: "10", height: 5 }).errorType).toBe("type_error:simple");
    expect(check({ base: 11, height: 5 }).errorType).toBe("value_error:others");
    expect(check({ base: 10, height: 5, unit: "cm" }).errorType).toBe("value_error:string");
    expect(check({ base: 10, height: 5, tags: ["c", "a b"] }).errorType).toBe("value_error:list/tuple");
    expect(simpleFunctionChecker(fd, { other: {} }, possible).errorType).toBe("simple_function_checker:wrong_func_name");
  });

  it("standardizes strings the way BFCL does", () => {
    expect(standardizeString("April 1, 2024")).toBe(standardizeString("april 1 2024"));
    expect(check({ base: 10, height: 5, tags: ["A-B", "c"] }).valid).toBe(true);
  });

  it("parallel matches in any order, and counts calls", () => {
    const e = data.entries.find((x) => x.id === "parallel_0") as BfclEntry;
    const gt = (data.answers.get("parallel_0") as BfclAnswer).ground_truth as never;
    const a = { "spotify.play": { artist: "Taylor Swift", duration: 20 } };
    const b = { "spotify.play": { artist: "Maroon 5", duration: 15 } };
    expect(astCheck("parallel", e.function as BfclFunction[], [b, a], gt).valid).toBe(true);
    expect(astCheck("parallel", e.function as BfclFunction[], [a], gt).errorType).toBe("parallel_function_checker:wrong_count");
    expect(astCheck("parallel", e.function as BfclFunction[], [a, a], gt).errorType).toBe("parallel_function_checker_no_order:cannot_find_match");
  });

  it("parses the multi-turn ground truth's Python calls", () => {
    expect(parsePyCall("mv(source='final_report.pdf', destination='temp')")).toEqual({ name: "mv", args: [], kwargs: { source: "final_report.pdf", destination: "temp" } });
    expect(parsePyCall("sort('final_report.pdf')")).toEqual({ name: "sort", args: ["final_report.pdf"], kwargs: {} });
    expect(parsePyCall("f(a=True, b=None, c=[1, -2.5, 'x'], d={'k': (1, 2)})").kwargs).toEqual({ a: true, b: null, c: [1, -2.5, "x"], d: { k: [1, 2] } });
    const all = data.entries.filter((e) => e.id.startsWith("multi_turn")).flatMap((e) => ((data.answers.get(e.id) as BfclAnswer).ground_truth as string[][]).flat());
    expect(all.length).toBeGreaterThan(500);
    for (const s of all) expect(() => parsePyCall(s), s).not.toThrow();
  });
});

describe("the runner", () => {
  it("BFCL's own answers score 100 % in every category (the port agrees with the ground truth)", async () => {
    const rows = await runBfcl(data, oracleEngine(data), { repair: false });
    const bad = rows.filter((r) => !r.valid);
    expect(bad.map((r) => `${r.id} ${r.errorType} ${r.error}`)).toEqual([]);
    const s = scoresByCategory(rows);
    expect(CATEGORIES.map((c) => s[c]?.length)).toEqual([400, 200, 200, 200]);
  }, 120_000);

  it("reports the repair layer's share separately: sloppy calls fail raw and pass repaired", async () => {
    const sub: BfclData = { ...data, entries: data.entries.filter((e) => /^(simple_python|multiple)_\d$/.test(e.id)) };
    // The slips toolRepair exists for: numbers as strings, the tool name in another case.
    const sloppy = oracleEngine(sub, (c) => ({ name: c.name.toUpperCase(), args: Object.fromEntries(Object.entries(c.args).map(([k, v]) => [k, typeof v === "number" ? String(v) : v])) }));
    const raw = await runBfcl(sub, sloppy, { repair: false });
    const fixed = await runBfcl(sub, sloppy, { repair: true });
    expect(raw.filter((r) => r.valid)).toHaveLength(0);
    expect(fixed.filter((r) => r.valid)).toHaveLength(20);
    expect(fixed.every((r) => r.repaired)).toBe(true);
  });

  it("a wrong engine is scored wrong, and a multi-turn turn needs the same ordered calls", async () => {
    const mute: BfclEngine = { id: "mute", step: async () => [] };
    const sub: BfclData = { ...data, entries: data.entries.filter((e) => /^(simple_python_0|multi_turn_base_0)$/.test(e.id)) };
    const rows = await runBfcl(sub, mute, { repair: true });
    expect(rows.map((r) => [r.id, r.valid, r.errorType])).toEqual([
      ["simple_python_0", false, "simple_function_checker:wrong_count"],
      ["multi_turn_base_0", false, "multi_turn:turn_mismatch"],
    ]);
    const reversed = oracleEngine(sub);
    const flipped: BfclEngine = { id: "flipped", step: async (m, t, ctx) => (await reversed.step(m, t, ctx)).reverse() };
    expect((await runBfcl({ ...sub, entries: sub.entries.slice(1) }, flipped, { repair: false }))[0].valid).toBe(false);
  });

  it("offers dotted names as underscores when asked, and maps them back", async () => {
    const sub: BfclData = { ...data, entries: data.entries.filter((e) => e.id === "simple_python_1") };
    const seen: string[] = [];
    const inner = oracleEngine(sub);
    const spy: BfclEngine = { id: "spy", step: async (m, t, ctx) => (seen.push(...t.map((x) => x.name)), inner.step(m, t, ctx)) };
    const rows = await runBfcl(sub, spy, { repair: false, underscoreToDot: true });
    expect(seen).toEqual(["math_factorial"]);
    expect(rows[0].valid).toBe(true);
  });

  it("a run becomes a complete public eval card with a bootstrap interval per category (W11.I18)", async () => {
    const sub: BfclData = { ...data, entries: data.entries.filter((e) => /_[0-9]$/.test(e.id)) };
    const rows = await runBfcl(sub, oracleEngine(sub), { repair: false });
    const scores = Object.fromEntries(Object.entries(scoresByCategory(rows)).map(([c, xs]) => [METRIC[c as keyof typeof METRIC], xs]));
    const card = makeCard({ tag: "public", model: { name: "oracle (self-test)", digest: "none:self-test" }, seed: 1, temperature: 0, dataset: { name: "bfcl-v4", version: manifest.commit, license: manifest.license, source: manifest.source }, scores });
    expect(validateCard(card)).toEqual([]);
    expect(Object.keys(card.metrics).sort()).toEqual(["ast_multiple", "ast_parallel", "ast_simple", "multi_turn_calls"]);
    expect(card.metrics.ast_simple.value).toBe(1);
  });
});
