/**
 * Table-driven tests for the column profiler + ranked chart suggestions.
 */

import { describe, it, expect } from "vitest";
import { parseCSV, parseJSONTable } from "../data/csv";
import {
  SUGGEST_LIMITS,
  histogramBins,
  parseLooseNumber,
  profileColumns,
  suggestCharts,
  type ChartKind,
  type SemanticType,
} from "../data/suggest";

const csv = (header: string, rows: string[]) => parseCSV([header, ...rows].join("\n"));
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
/** Deterministic pseudo-random in [0,1). */
const rand = (i: number) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

describe("parseLooseNumber", () => {
  it.each<[unknown, number | null]>([
    ["12%", 12],
    ["-3.5 %", -3.5],
    ["$1,200", 1200],
    ["€ 9.99", 9.99],
    ["1 234", 1234],
    ["(300)", -300],
    ["($1,000.50)", -1000.5],
    ["1,200.5 USD", 1200.5],
    ["42", 42],
    [7, 7],
    ["abc", null],
    ["", null],
    ["1,23", null],
    [null, null],
    [Number.NaN, null],
  ])("%s → %s", (input, expected) => {
    expect(parseLooseNumber(input)).toBe(expected);
  });
});

describe("profileColumns", () => {
  const cases: Array<[string, string, string[], Record<string, SemanticType>]> = [
    ["ISO dates", "date,v", ["2024-01-01,1", "2024-02-01,2", "2024-03-01,3"], { date: "time", v: "numeric" }],
    ["named year", "year,v", ["2020,1", "2021,2", "2020,3"], { year: "time", v: "numeric" }],
    ["monotonic unnamed year", "fy_label,v", ["2019,1", "2020,2", "2021,3"], { fy_label: "time" }],
    ["quarters", "q,v", ["Q1 2024,1", "Q2 2024,2", "2024-Q3,3"], { q: "time" }],
    ["month names", "m,v", ["Jan,1", "Feb,2", "March,3"], { m: "time" }],
    ["clock times", "t,v", ["09:00,1", "09:30,2", "10:00,3"], { t: "time" }],
    ["percent strings", "region,share", ["A,50%", "B,30%", "C,20%"], { region: "categorical", share: "percent" }],
    ["currency strings", "item,price", ['A,"$1,200"', "B,$300", "C,$45.50"], { price: "currency" }],
    ["grouped numbers", "city,pop", ['A,"1,200,000"', 'B,"850,000"', 'C,"2,100"'], { pop: "numeric" }],
    ["lat/lon", "name,lat,lon", ["A,32.08,34.78", "B,31.77,35.21"], { name: "categorical", lat: "latitude", lon: "longitude" }],
    ["latitude/longitude", "latitude,longitude", ["10,20", "11,21"], { latitude: "latitude", longitude: "longitude" }],
    ["lat name but out of range", "lat,v", ["120,1", "130,2"], { lat: "numeric" }],
    ["row id", "id,v", ["1,5", "2,6", "3,7"], { id: "id", v: "numeric" }],
    ["booleans", "flag,v", ["true,1", "false,2"], { flag: "categorical" }],
  ];

  it.each(cases)("%s", (_name, header, rows, expected) => {
    const profiles = profileColumns(csv(header, rows));
    for (const [key, sem] of Object.entries(expected)) {
      expect(profiles.find((p) => p.key === key)?.semantic, key).toBe(sem);
    }
  });

  it("high-cardinality strings are free text", () => {
    const ds = csv("note,v", range(60).map((i) => `note ${i} here,${i}`));
    expect(profileColumns(ds)[0].semantic).toBe("text");
  });

  it("records non-negativity and sums", () => {
    const p = profileColumns(csv("c,v", ["a,1", "b,2", "c,-3"]))[1];
    expect(p).toMatchObject({ min: -3, max: 2, sum: 0, nonNegative: false });
  });
});

type Case = {
  name: string;
  ds: ReturnType<typeof parseCSV>;
  top: ChartKind;
  includes?: ChartKind[];
  excludes?: ChartKind[];
};

const salesByRegion = csv("region,q1,q2,q3", ["North,10,12,9", "South,8,7,11", "East,14,13,15", "West,6,9,8"]);

const cases: Case[] = [
  {
    name: "time series → line",
    ds: csv("date,sales", ["2026-01-01,10", "2026-02-01,20", "2026-03-01,15", "2026-04-01,30"]),
    top: "line",
    excludes: ["pie", "histogram"],
  },
  {
    name: "years as numbers → line, not scatter",
    ds: csv("year,revenue", ["2019,10", "2020,12", "2021,15", "2022,18"]),
    top: "line",
    excludes: ["scatter"],
  },
  {
    name: "quarters → line",
    ds: csv("quarter,revenue", ["Q1 2024,5", "Q2 2024,7", "Q3 2024,6", "Q4 2024,9"]),
    top: "line",
  },
  {
    name: "parts of a whole summing to 100 → pie first",
    ds: csv("browser,share", ["Chrome,64", "Safari,19", "Edge,5", "Firefox,3", "Other,9"]),
    top: "pie",
    includes: ["bar"],
  },
  {
    name: "fractions summing to 1 → pie first",
    ds: csv("segment,fraction", ["A,0.5", "B,0.3", "C,0.2"]),
    top: "pie",
  },
  {
    name: "percent strings → pie",
    ds: csv("channel,share", ["Email,40%", "Search,35%", "Social,25%"]),
    top: "pie",
  },
  {
    name: "categories not adding up → bar first, pie as alternative",
    ds: csv("team,points", ["A,10", "B,15", "C,20", "D,5"]),
    top: "bar",
    includes: ["pie"],
  },
  {
    name: "more than 6 categories → no pie",
    ds: csv("label,n", range(8).map((i) => `c${i},${i + 1}`)),
    top: "bar",
    excludes: ["pie"],
  },
  {
    name: "negative values → no pie",
    ds: csv("account,delta", ["A,10", "B,-5", "C,3"]),
    top: "bar",
    excludes: ["pie"],
  },
  {
    name: "multiple comparable measures → stacked bar first",
    ds: salesByRegion,
    top: "stackedBar",
    includes: ["bar", "radar", "scatter"],
  },
  {
    name: "measures on very different scales → grouped bar, stacked demoted",
    ds: csv("city,population,area", ["A,1000000,50", "B,2500000,120", "C,800000,30"]),
    top: "bar",
  },
  {
    name: "21–50 categories → top-20 bar",
    ds: csv("product,sold", range(30).map((i) => `p${i},${(i * 7) % 31}`)),
    top: "bar",
    excludes: ["pie", "stackedBar"],
  },
  {
    name: "two correlated measures → scatter",
    ds: csv("height,weight", range(12).map((i) => `${150 + i * 3},${50 + i * 2.5 + (i % 3)}`)),
    top: "scatter",
  },
  {
    name: "single measure with many rows → histogram",
    ds: csv("latency_ms", range(120).map((i) => String(Math.round(100 + rand(i) * 400)))),
    top: "histogram",
    excludes: ["scatter", "line"],
  },
  {
    name: "lat/lon → map first",
    ds: csv("city,lat,lng", ["Tel Aviv,32.0853,34.7818", "Haifa,32.794,34.9896", "Eilat,29.5577,34.9519"]),
    top: "map",
  },
  {
    name: "currency strings by category → bar",
    ds: csv("item,price", ['Laptop,"$1,200"', "Mouse,$25", "Desk,$300"]),
    top: "bar",
  },
  {
    name: "only one numeric, few rows → summary bar fallback",
    ds: csv("value", ["10", "20", "30"]),
    top: "bar",
  },
];

describe("suggestCharts — ranking", () => {
  it.each(cases)("$name", ({ ds, top, includes = [], excludes = [] }) => {
    const out = suggestCharts(ds);
    const kinds = out.map((s) => s.kind);
    expect(kinds[0], JSON.stringify(out.map((s) => [s.kind, s.score]))).toBe(top);
    for (const k of includes) expect(kinds).toContain(k);
    for (const k of excludes) expect(kinds).not.toContain(k);
  });
});

describe("suggestCharts — shape & invariants", () => {
  const all = cases.map((c) => suggestCharts(c.ds));

  it("every suggestion has a unique id, label, reason and ECharts series", () => {
    for (const list of all) {
      const ids = list.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of list) {
        expect(s.label).toBeTruthy();
        expect(s.reason).toBeTruthy();
        expect(s.reason).not.toMatch(/^chart\.reason\./);
        expect(s.label).not.toMatch(/\{\w+\}/);
        expect(Array.isArray((s.option as { series: unknown[] }).series)).toBe(true);
      }
    }
  });

  it("lists are sorted by descending score", () => {
    for (const list of all) {
      for (let i = 1; i < list.length; i++) expect(list[i - 1].score).toBeGreaterThanOrEqual(list[i].score);
    }
  });

  it("empty input → no suggestions", () => {
    expect(suggestCharts(parseCSV("a\n"))).toEqual([]);
    expect(suggestCharts(parseJSONTable("[]"))).toEqual([]);
  });

  it("text-only table → no suggestions", () => {
    expect(suggestCharts(csv("name,city", ["a,x", "b,y"]))).toEqual([]);
  });
});

describe("suggestCharts — chart contents", () => {
  it("line chart is ordered chronologically even when rows are not", () => {
    const ds = csv("date,v", ["2024-03-01,3", "2024-01-01,1", "2024-02-01,2"]);
    const line = suggestCharts(ds).find((s) => s.kind === "line")!;
    const x = (line.option.xAxis as { data: string[] }).data;
    expect(x).toEqual(["2024-01-01", "2024-02-01", "2024-03-01"]);
    expect((line.option.series as Array<{ data: number[] }>)[0].data).toEqual([1, 2, 3]);
  });

  it("quarters are ordered by year then quarter", () => {
    const ds = csv("q,v", ["Q1 2025,4", "Q3 2024,2", "Q4 2024,3", "Q2 2024,1"]);
    const line = suggestCharts(ds).find((s) => s.kind === "line")!;
    expect((line.option.xAxis as { data: string[] }).data).toEqual(["Q2 2024", "Q3 2024", "Q4 2024", "Q1 2025"]);
  });

  it("time × one measure × small category → one line per category", () => {
    const ds = csv("month,city,temp", ["Jan,TLV,18", "Feb,TLV,19", "Jan,JLM,11", "Feb,JLM,12"]);
    const line = suggestCharts(ds)[0];
    expect(line.kind).toBe("line");
    const series = line.option.series as Array<{ name: string; data: number[] }>;
    expect(series.map((s) => s.name).sort()).toEqual(["JLM", "TLV"]);
    expect(series.find((s) => s.name === "TLV")!.data).toEqual([18, 19]);
  });

  it("stacked bar series share a stack", () => {
    const stacked = suggestCharts(salesByRegion).find((s) => s.kind === "stackedBar")!;
    const series = stacked.option.series as Array<{ stack?: string }>;
    expect(series).toHaveLength(3);
    expect(series.every((s) => s.stack === "total")).toBe(true);
  });

  it("percent values are averaged (not summed) when categories repeat", () => {
    const ds = csv("region,rate", ["A,10%", "A,20%", "B,30%"]);
    const bar = suggestCharts(ds).find((s) => s.kind === "bar")!;
    expect((bar.option.series as Array<{ data: number[] }>)[0].data).toEqual([15, 30]);
  });

  it("top-N bar keeps the N largest categories", () => {
    const ds = csv("p,v", range(30).map((i) => `p${i},${i}`));
    const bar = suggestCharts(ds).find((s) => s.kind === "bar")!;
    const labels = (bar.option.xAxis as { data: string[] }).data;
    expect(labels).toHaveLength(SUGGEST_LIMITS.barMaxCategories);
    expect(labels[0]).toBe("p29");
    expect(labels).not.toContain("p0");
  });

  it("map suggestion carries markers with labels", () => {
    const ds = csv("city,lat,lng", ["Tel Aviv,32.0853,34.7818", "Haifa,32.794,34.9896"]);
    const map = suggestCharts(ds)[0];
    expect(map.map?.markers).toEqual([
      { lat: 32.0853, lng: 34.7818, label: "Tel Aviv" },
      { lat: 32.794, lng: 34.9896, label: "Haifa" },
    ]);
  });

  it("strong correlation is mentioned in the reason", () => {
    const ds = csv("x,y", range(10).map((i) => `${i},${i * 2}`));
    const sc = suggestCharts(ds).find((s) => s.kind === "scatter")!;
    expect(sc.reason).toMatch(/r = 1\.00/);
  });

  it("works on JSON tables too", () => {
    const ds = parseJSONTable(JSON.stringify([
      { day: "2024-01-01", visits: 10 },
      { day: "2024-01-02", visits: 14 },
      { day: "2024-01-03", visits: 9 },
    ]));
    expect(suggestCharts(ds)[0].kind).toBe("line");
  });
});

describe("histogramBins", () => {
  it("uses Sturges' rule clamped to 5..30 and counts every value", () => {
    const values = range(100).map((i) => i);
    const bins = histogramBins(values);
    expect(bins).toHaveLength(8); // ceil(log2(100) + 1)
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(100);
  });
  it("handles a constant column", () => {
    expect(histogramBins([5, 5, 5])).toEqual([{ from: 5, to: 5, count: 3 }]);
  });
  it("handles empty input", () => {
    expect(histogramBins([])).toEqual([]);
  });
});
