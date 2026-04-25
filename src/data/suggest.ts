import type { DataColumn, DataSet } from "./csv";

export type ChartKind =
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "scatter"
  | "heatmap"
  | "radar";

export interface ChartSuggestion {
  kind: ChartKind;
  label: string;
  /** ECharts option object */
  option: Record<string, unknown>;
  score: number;
}

const PALETTE = [
  "#7c5cff",
  "#22d3ee",
  "#f472b6",
  "#facc15",
  "#34d399",
  "#fb923c",
  "#60a5fa",
  "#a78bfa",
  "#f87171",
  "#2dd4bf",
];

function baseOption(): Record<string, unknown> {
  return {
    color: PALETTE,
    grid: { left: 50, right: 24, top: 36, bottom: 40, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 6, textStyle: { color: "#9aa3b2" } },
    textStyle: { fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" },
  };
}

export function suggestCharts(ds: DataSet): ChartSuggestion[] {
  if (ds.rows.length === 0 || ds.columns.length === 0) return [];

  const nums = ds.columns.filter((c) => c.type === "number");
  const dates = ds.columns.filter((c) => c.type === "date");
  const cats = ds.columns.filter(
    (c) => c.type === "string" && c.distinct >= 1 && c.distinct <= 50,
  );

  const out: ChartSuggestion[] = [];

  // 1. date(s) + numeric(s) -> line chart
  if (dates.length >= 1 && nums.length >= 1) {
    out.push(buildLineChart(ds, dates[0], nums.slice(0, 4)));
  }

  // 2. category + numeric -> bar
  if (cats.length >= 1 && nums.length >= 1) {
    out.push(buildBarChart(ds, cats[0], nums.slice(0, 4)));

    // 2b. category + 1 numeric, ≤ 8 categories, sums positive -> pie
    if (nums.length >= 1) {
      const cat = cats[0];
      if (cat.distinct <= 8) {
        out.push(buildPieChart(ds, cat, nums[0]));
      }
    }
  }

  // 3. two numerics -> scatter
  if (nums.length >= 2) {
    out.push(
      buildScatter(ds, nums[0], nums[1], cats[0]),
    );
  }

  // 4. only numerics, no dates/cats -> bar of column means
  if (out.length === 0 && nums.length >= 1) {
    out.push(buildSummaryBar(ds, nums));
  }

  // 5. radar: 1 cat with up to 6 entries + 3+ numerics
  if (cats.length >= 1 && nums.length >= 3 && cats[0].distinct <= 6) {
    out.push(buildRadar(ds, cats[0], nums.slice(0, 6)));
  }

  // sort by descending score, dedupe by kind+x
  return out.sort((a, b) => b.score - a.score);
}

function buildLineChart(
  ds: DataSet,
  xCol: DataColumn,
  yCols: DataColumn[],
): ChartSuggestion {
  const sorted = [...ds.rows].sort((a, b) => {
    const av = a[xCol.key] as number | null;
    const bv = b[xCol.key] as number | null;
    return (av ?? 0) - (bv ?? 0);
  });
  const xs = sorted.map((r) =>
    xCol.type === "date"
      ? new Date(r[xCol.key] as number).toISOString().slice(0, 10)
      : (r[xCol.key] as string | number),
  );
  return {
    kind: "line",
    label:
      yCols.length > 1
        ? `${yCols.map((c) => c.name).join(", ")} over ${xCol.name}`
        : `${yCols[0].name} over ${xCol.name}`,
    score: 100,
    option: {
      ...baseOption(),
      xAxis: {
        type: "category",
        data: xs,
        boundaryGap: false,
        axisLabel: { color: "#9aa3b2" },
        axisLine: { lineStyle: { color: "#3a3f4b" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#9aa3b2" },
        splitLine: { lineStyle: { color: "#2a2f3a" } },
      },
      tooltip: { trigger: "axis" },
      series: yCols.map((c) => ({
        name: c.name,
        type: "line",
        smooth: true,
        showSymbol: false,
        areaStyle: yCols.length === 1 ? { opacity: 0.18 } : undefined,
        data: sorted.map((r) => r[c.key]),
      })),
    },
  };
}

function buildBarChart(
  ds: DataSet,
  catCol: DataColumn,
  numCols: DataColumn[],
): ChartSuggestion {
  // group rows by category; sum the metric(s)
  const buckets = new Map<string, Record<string, number>>();
  for (const r of ds.rows) {
    const k = String(r[catCol.key] ?? "—");
    if (!buckets.has(k)) buckets.set(k, {});
    const b = buckets.get(k)!;
    for (const c of numCols) {
      b[c.key] = (b[c.key] ?? 0) + ((r[c.key] as number | null) ?? 0);
    }
  }
  const labels = [...buckets.keys()];
  return {
    kind: "bar",
    label:
      numCols.length > 1
        ? `${numCols.map((c) => c.name).join(", ")} by ${catCol.name}`
        : `${numCols[0].name} by ${catCol.name}`,
    score: 95,
    option: {
      ...baseOption(),
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: "#9aa3b2", interval: 0, rotate: labels.length > 6 ? 30 : 0 },
        axisLine: { lineStyle: { color: "#3a3f4b" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#9aa3b2" },
        splitLine: { lineStyle: { color: "#2a2f3a" } },
      },
      series: numCols.map((c) => ({
        name: c.name,
        type: "bar",
        barMaxWidth: 36,
        data: labels.map((l) => buckets.get(l)![c.key] ?? 0),
        itemStyle: { borderRadius: [4, 4, 0, 0] },
      })),
    },
  };
}

function buildPieChart(
  ds: DataSet,
  catCol: DataColumn,
  numCol: DataColumn,
): ChartSuggestion {
  const buckets = new Map<string, number>();
  for (const r of ds.rows) {
    const k = String(r[catCol.key] ?? "—");
    buckets.set(
      k,
      (buckets.get(k) ?? 0) + ((r[numCol.key] as number | null) ?? 0),
    );
  }
  return {
    kind: "pie",
    label: `${numCol.name} share by ${catCol.name}`,
    score: 80,
    option: {
      ...baseOption(),
      tooltip: { trigger: "item" },
      legend: { orient: "vertical", left: 8, top: "middle", textStyle: { color: "#9aa3b2" } },
      series: [
        {
          name: numCol.name,
          type: "pie",
          radius: ["45%", "72%"],
          itemStyle: { borderRadius: 6, borderColor: "transparent", borderWidth: 2 },
          label: { color: "#9aa3b2" },
          data: [...buckets.entries()].map(([name, value]) => ({ name, value })),
        },
      ],
    },
  };
}

function buildScatter(
  ds: DataSet,
  xCol: DataColumn,
  yCol: DataColumn,
  byCol?: DataColumn,
): ChartSuggestion {
  if (byCol) {
    const groups = new Map<string, Array<[number, number]>>();
    for (const r of ds.rows) {
      const x = r[xCol.key] as number | null;
      const y = r[yCol.key] as number | null;
      if (x === null || y === null) continue;
      const k = String(r[byCol.key] ?? "—");
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push([x, y]);
    }
    return {
      kind: "scatter",
      label: `${yCol.name} vs ${xCol.name} by ${byCol.name}`,
      score: 70,
      option: {
        ...baseOption(),
        tooltip: { trigger: "item" },
        xAxis: {
          type: "value",
          name: xCol.name,
          nameTextStyle: { color: "#9aa3b2" },
          axisLabel: { color: "#9aa3b2" },
          splitLine: { lineStyle: { color: "#2a2f3a" } },
        },
        yAxis: {
          type: "value",
          name: yCol.name,
          nameTextStyle: { color: "#9aa3b2" },
          axisLabel: { color: "#9aa3b2" },
          splitLine: { lineStyle: { color: "#2a2f3a" } },
        },
        series: [...groups.entries()].map(([name, data]) => ({
          name,
          type: "scatter",
          symbolSize: 9,
          data,
        })),
      },
    };
  }
  const data = ds.rows
    .map((r) => [r[xCol.key], r[yCol.key]] as [unknown, unknown])
    .filter(([x, y]) => x !== null && y !== null);
  return {
    kind: "scatter",
    label: `${yCol.name} vs ${xCol.name}`,
    score: 70,
    option: {
      ...baseOption(),
      tooltip: { trigger: "item" },
      xAxis: {
        type: "value",
        name: xCol.name,
        nameTextStyle: { color: "#9aa3b2" },
        axisLabel: { color: "#9aa3b2" },
      },
      yAxis: {
        type: "value",
        name: yCol.name,
        nameTextStyle: { color: "#9aa3b2" },
        axisLabel: { color: "#9aa3b2" },
      },
      series: [{ type: "scatter", symbolSize: 9, data }],
    },
  };
}

function buildRadar(
  ds: DataSet,
  catCol: DataColumn,
  numCols: DataColumn[],
): ChartSuggestion {
  const indicator = numCols.map((c) => ({
    name: c.name,
    max: c.max ?? 100,
  }));
  // group: take mean per category
  const groups = new Map<string, Record<string, { sum: number; n: number }>>();
  for (const r of ds.rows) {
    const k = String(r[catCol.key] ?? "—");
    if (!groups.has(k)) groups.set(k, {});
    const g = groups.get(k)!;
    for (const c of numCols) {
      const v = r[c.key] as number | null;
      if (v === null) continue;
      const cur = g[c.key] ?? { sum: 0, n: 0 };
      cur.sum += v;
      cur.n += 1;
      g[c.key] = cur;
    }
  }
  return {
    kind: "radar",
    label: `${numCols.map((c) => c.name).join(", ")} per ${catCol.name}`,
    score: 50,
    option: {
      ...baseOption(),
      tooltip: {},
      legend: { top: 6, textStyle: { color: "#9aa3b2" } },
      radar: {
        indicator,
        splitLine: { lineStyle: { color: "#2a2f3a" } },
        axisName: { color: "#9aa3b2" },
      },
      series: [
        {
          type: "radar",
          areaStyle: { opacity: 0.18 },
          data: [...groups.entries()].map(([name, g]) => ({
            name,
            value: numCols.map((c) =>
              g[c.key] ? g[c.key].sum / g[c.key].n : 0,
            ),
          })),
        },
      ],
    },
  };
}

function buildSummaryBar(ds: DataSet, numCols: DataColumn[]): ChartSuggestion {
  const means = numCols.map((c) => {
    let sum = 0;
    let n = 0;
    for (const r of ds.rows) {
      const v = r[c.key] as number | null;
      if (v === null) continue;
      sum += v;
      n++;
    }
    return n ? sum / n : 0;
  });
  return {
    kind: "bar",
    label: `Average of numeric columns`,
    score: 30,
    option: {
      ...baseOption(),
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: numCols.map((c) => c.name),
        axisLabel: { color: "#9aa3b2" },
      },
      yAxis: { type: "value", axisLabel: { color: "#9aa3b2" } },
      series: [
        {
          type: "bar",
          barMaxWidth: 36,
          itemStyle: { borderRadius: [4, 4, 0, 0] },
          data: means,
        },
      ],
    },
  };
}
