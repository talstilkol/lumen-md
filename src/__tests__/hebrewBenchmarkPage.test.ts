/**
 * W11.H13 — the public page "Hebrew in notes, measured": numbers only from
 * eval/results, each with its reproduction command; competitors only with a
 * source and a date, else "not tested". The results below are SYNTHETIC
 * (made up here to exercise the renderer); the committed page has none yet.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pageProblems, renderBenchmarkPage, ROWS, type CompetitorData } from "../eval/public/page";
import type { PublicResult } from "../eval/public/gate";
// @ts-expect-error — plain .mjs helper without types
import { renderCompare } from "../../scripts/lib/launch.mjs";

const comp = JSON.parse(readFileSync("launch/hebrew-benchmark.json", "utf8")) as CompetitorData;
const result = (task: string, metrics: Record<string, number>, over: Partial<PublicResult> = {}): PublicResult => ({
  schema: 1,
  task,
  dataset: { id: "x", revision: "r", split: "test" },
  model: { id: "ivrit-ai/zipformer2-66m-streaming-he", revision: "ee769a2a" },
  engine: "onnxruntime-web wasm",
  normalizer: "ivrit-leaderboard",
  n: 10,
  metrics,
  date: "2026-12-01T10:00:00.000Z",
  command: `npm run eval:public -- run ${task} --engine e.mjs --model m --rev r`,
  synthetic: false,
  ...over,
});

describe("the committed page", () => {
  it("is what the generator makes from the committed results (none yet) and claims (none yet)", () => {
    // W13.H6: and the recorded RTL test's ledger (launch/rtl-benchmark.json).
    const rtl = JSON.parse(readFileSync("launch/rtl-benchmark.json", "utf8"));
    expect(readFileSync("docs/src/content/docs/project/hebrew-benchmark.md", "utf8")).toBe(renderBenchmarkPage([], comp, "en", rtl));
    expect(readFileSync("docs/src/content/docs/he/project/hebrew-benchmark.md", "utf8")).toBe(renderBenchmarkPage([], comp, "he", rtl));
  });
  it("has no number at all today: every Lumen cell is 'not measured yet', every competitor 'not tested'", () => {
    const md = renderBenchmarkPage([], comp, "en");
    const rows = md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Benchmark"));
    expect(rows).toHaveLength(ROWS.length);
    for (const r of rows) {
      expect(r).toContain("not measured yet");
      expect(r.match(/not tested/g)).toHaveLength(3);
      // No digit in the value cells (the benchmark's name may have one: "eval-d1").
      for (const cell of r.split("|").slice(2, -1)) expect(cell).not.toMatch(/\d/);
    }
    expect(comp.claims).toEqual([]);
  });
  it("the comparison page links to it, in both languages", () => {
    const data = JSON.parse(readFileSync("launch/comparison.json", "utf8"));
    expect(renderCompare(data, "en")).toContain("](/project/hebrew-benchmark/)");
    expect(renderCompare(data, "he")).toContain("](/he/project/hebrew-benchmark/)");
    expect(readFileSync("docs/src/content/docs/project/compare.md", "utf8")).toBe(renderCompare(data, "en"));
  });
});

describe("with results (synthetic)", () => {
  const results = [
    result("asr-ivrit-eval-whatsapp", { wer: 0.091, cer: 0.04 }),
    result("asr-ivrit-eval-whatsapp", { wer: 0.12, cer: 0.05 }, { model: { id: "onnx-community/whisper-small", revision: "x" }, date: "2026-12-02T00:00:00Z" }),
    result("unicode-bidi", { characterTest: 0.99953 }, { model: { id: "lumen-md/bidi", revision: "table-abc" } }),
    result("nikud-nakdimon-test", { wor: 0.9 }, { synthetic: true }),
  ];
  const md = renderBenchmarkPage(results, comp, "en");
  it("every number carries a footnote with its reproduction command; the best engine per row is shown", () => {
    expect(md).toContain("| Dictation WER — ivrit.ai eval-whatsapp (lower is better) | 9.1% (ivrit-ai/zipformer2-66m-streaming-he, 2026-12-01) [");
    expect(md).toContain("99.95% (lumen-md/bidi, 2026-12-01)");
    const notes = md.split("### Reproduce")[1];
    expect(notes).toContain("`npm run eval:public -- run asr-ivrit-eval-whatsapp --engine e.mjs --model m --rev r`");
    expect(notes).toContain("`npm run eval:public -- run unicode-bidi --engine e.mjs --model m --rev r`");
  });
  it("a synthetic result never reaches the page", () => {
    expect(md).toMatch(/Niqqud word accuracy[^\n]*not measured yet/);
  });
  it("a competitor gets a number only with a source and a date", () => {
    const withClaim: CompetitorData = { ...comp, claims: [{ product: "obsidian", row: "bidi", value: 0.97, source: "https://example.org/run-log", date: "2026-12-03", version: "1.14.2" }] };
    expect(renderBenchmarkPage([], withClaim, "en")).toContain("97.00% (<https://example.org/run-log>, 2026-12-03, 1.14.2)");
    expect(pageProblems([], withClaim)).toEqual([]);
    const bad: CompetitorData = { ...comp, claims: [{ product: "notion", row: "bidi", value: 0.5, source: "", date: "" } as never] };
    expect(pageProblems([], bad)).toEqual(["notion / bidi: a claim without a source", "notion / bidi: a claim without a date"]);
    expect(pageProblems([result("unicode-bidi", { characterTest: 1 }, { command: "" })], comp)).toEqual(["unicode-bidi / ivrit-ai/zipformer2-66m-streaming-he: a number without a reproduction command"]);
  });
  it("renders in Hebrew with Hebrew labels", () => {
    const he = renderBenchmarkPage(results, comp, "he");
    expect(he).toContain("title: עברית בפתקים, במדידה");
    expect(he).toContain("לא נבדק");
    expect(he).toContain("### שחזור");
  });
});
