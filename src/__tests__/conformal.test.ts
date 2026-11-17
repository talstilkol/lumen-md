/**
 * R12.15: split-conformal approval thresholds per proposal kind, and Wilson
 * ranges on every rate an eval reports.
 */
import { describe, expect, it } from "vitest";
import { compareRates, conformalThreshold, decide, formatRate, mondrianThresholds, rateText, wilson, type GoldItem } from "../agents/eval/conformal";
import { formatEvalHtml, formatEvalReport } from "../agents/eval/score";

/** mulberry32: seeded, so the coverage check is the same on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("Wilson intervals (tasker's evals.js)", () => {
  it("gives the textbook ranges and never a bare number", () => {
    expect(wilson(9, 10)).toEqual({ p: 0.9, lo: 0.596, hi: 0.982, n: 10 });
    expect(wilson(0, 0)).toEqual({ p: null, lo: null, hi: null, n: 0 });
    expect(wilson(20, 20).hi).toBe(1);
    expect(formatRate(wilson(9, 10))).toBe("0.90 (95% 0.60–0.98, n=10)");
    // Rounded once from the exact interval: 0.0945… is 0.09, not 0.095 → 0.10.
    expect(rateText(1, 2)).toBe("0.50 (95% 0.09–0.91, n=2)");
  });
});

describe("split-conformal thresholds", () => {
  it("is the ⌈(n+1)(1−α)⌉-th smallest negative; too few negatives → no threshold", () => {
    const neg = Array.from({ length: 19 }, (_, i) => i / 100);
    expect(conformalThreshold(neg, 0.1)).toBe(0.17);
    expect(conformalThreshold(neg.slice(0, 5), 0.1)).toBeNull();
    expect(() => conformalThreshold(neg, 0)).toThrow();
  });

  it("per kind (Mondrian), and the threshold moves when the gold moves", () => {
    const gold: GoldItem[] = [
      ...Array.from({ length: 19 }, (_, i) => ({ kind: "tag", score: 0.3 + i / 100, approved: false })),
      ...Array.from({ length: 10 }, (_, i) => ({ kind: "tag", score: 0.4 + i / 20, approved: true })),
      ...Array.from({ length: 4 }, () => ({ kind: "merge", score: 0.2, approved: false })),
    ];
    const t1 = mondrianThresholds(gold, 0.1);
    expect(t1.map((t) => [t.kind, t.threshold])).toEqual([
      ["merge", null],
      ["tag", 0.47],
    ]);
    expect(t1[1].autoRate).toMatchObject({ n: 10, p: 0.8 });
    const t2 = mondrianThresholds([...gold, { kind: "tag", score: 0.9, approved: false }, { kind: "tag", score: 0.95, approved: false }], 0.1);
    expect(t2[1].threshold).toBeGreaterThan(t1[1].threshold!);
    expect(decide("tag", 0.6, t1)).toBe("auto");
    expect(decide("tag", 0.45, t1)).toBe("review");
    expect(decide("merge", 0.99, t1)).toBe("review");
    expect(decide("unknown", 0.99, t1)).toBe("review");
  });

  it("keeps its promise: on exchangeable negatives at most α slip through, on average", () => {
    const rand = rng(7);
    const alpha = 0.1;
    let slipped = 0;
    let tests = 0;
    for (let trial = 0; trial < 300; trial++) {
      const cal = Array.from({ length: 49 }, () => rand());
      const t = conformalThreshold(cal, alpha)!;
      for (let j = 0; j < 20; j++) {
        tests++;
        if (rand() > t) slipped++;
      }
    }
    expect(slipped / tests).toBeLessThanOrEqual(alpha + 0.01);
    expect(slipped / tests).toBeGreaterThan(alpha - 0.04);
  });
});

describe("comparing configurations (tasker's compare rule)", () => {
  it("decides only with enough runs, and gives the difference as a range", () => {
    expect(compareRates({ ok: 9, n: 10 }, { ok: 8, n: 10 }).decision).toBe("insufficient");
    const c = compareRates({ ok: 19, n: 20 }, { ok: 18, n: 20 });
    expect(c.decision).toBe("enforce");
    expect(c.diff![0]).toBeLessThan(0);
    expect(c.diff![1]).toBeGreaterThan(0);
    expect(compareRates({ ok: 10, n: 20 }, { ok: 19, n: 20 }).decision).toBe("advise");
  });
});

describe("eval reports carry a range on every rate", () => {
  const results = [
    { id: "a", agent: "tagger", status: "ok" as const, executor: "ollama" as const, model: "m", attempts: 1, ms: 1200, checks: [] },
    { id: "b", agent: "tasker", status: "failed" as const, executor: "ollama" as const, model: "m", attempts: 3, ms: 800, checks: [], error: "x" },
  ];
  const meta = { model: "qwen2.5:7b", url: "http://localhost:11434", date: "2026-11-15" };
  it("Markdown and HTML", () => {
    expect(formatEvalReport(results, meta)).toContain("**1/2 passed** · pass rate 0.50 (95% 0.09–0.91, n=2)");
    const html = formatEvalHtml(results, meta);
    expect(html).toContain("pass rate 0.50 (95% 0.09–0.91, n=2)");
    expect(html).toContain("<td>tagger</td><td>1/1</td><td>1.00 (95% 0.21–1.00, n=1)</td>");
  });
});
