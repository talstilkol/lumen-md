/**
 * Tests for the chart-suggestion engine. The engine inspects a parsed DataSet
 * and proposes ECharts options ranked by score; we verify it picks the right
 * shape for each common column-mix and degrades sensibly when nothing fits.
 */

import { describe, it, expect } from "vitest";
import { parseCSV } from "../data/csv";
import { suggestCharts } from "../data/suggest";

describe("suggestCharts", () => {
  it("returns no suggestions for an empty DataSet", () => {
    const ds = parseCSV("a\n");
    expect(suggestCharts(ds)).toEqual([]);
  });

  it("suggests a line chart when there is a date column + a numeric column", () => {
    const csv =
      "date,sales\n2026-01-01,10\n2026-02-01,20\n2026-03-01,15\n2026-04-01,30";
    const ds = parseCSV(csv);
    const charts = suggestCharts(ds);
    expect(charts.length).toBeGreaterThan(0);
    expect(charts[0].kind).toBe("line");
    // line chart label mentions both axes
    expect(charts[0].label).toMatch(/sales/);
    expect(charts[0].label).toMatch(/date/);
  });

  it("suggests bar + pie when a small categorical column meets a numeric column", () => {
    const csv = "team,points\nA,10\nB,15\nC,20\nD,5";
    const ds = parseCSV(csv);
    const kinds = suggestCharts(ds).map((c) => c.kind);
    expect(kinds).toContain("bar");
    expect(kinds).toContain("pie");
  });

  it("does NOT suggest a pie chart when the category cardinality is high", () => {
    // 12 distinct categories — over the 8-cap for pies.
    const rows = Array.from({ length: 12 }, (_, i) => `cat${i},${i + 1}`).join(
      "\n",
    );
    const ds = parseCSV(`label,n\n${rows}`);
    const kinds = suggestCharts(ds).map((c) => c.kind);
    expect(kinds).toContain("bar");
    expect(kinds).not.toContain("pie");
  });

  it("suggests a scatter when there are two numeric columns", () => {
    const csv = "x,y\n1,2\n2,4\n3,6\n4,8";
    const ds = parseCSV(csv);
    const kinds = suggestCharts(ds).map((c) => c.kind);
    expect(kinds).toContain("scatter");
  });

  it("falls back to a summary bar when only numerics exist with no x-axis cues", () => {
    // Only one numeric → no scatter possible, no cat/date → summary bar.
    const csv = "value\n10\n20\n30";
    const ds = parseCSV(csv);
    const charts = suggestCharts(ds);
    expect(charts.some((c) => c.kind === "bar")).toBe(true);
  });

  it("suggests radar when a small category meets ≥3 numerics", () => {
    const csv =
      "team,speed,power,stamina\nA,80,70,90\nB,60,90,75\nC,75,80,85";
    const ds = parseCSV(csv);
    const kinds = suggestCharts(ds).map((c) => c.kind);
    expect(kinds).toContain("radar");
  });

  it("returns suggestions sorted by descending score", () => {
    const csv = "team,points\nA,10\nB,15\nC,20";
    const ds = parseCSV(csv);
    const scores = suggestCharts(ds).map((c) => c.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  it("each suggestion has an ECharts-compatible option object", () => {
    const csv = "team,points\nA,10\nB,15\nC,20";
    const ds = parseCSV(csv);
    for (const c of suggestCharts(ds)) {
      // every ECharts option must declare a series array.
      expect(c.option).toHaveProperty("series");
      expect(Array.isArray((c.option as { series: unknown[] }).series)).toBe(
        true,
      );
    }
  });
});
