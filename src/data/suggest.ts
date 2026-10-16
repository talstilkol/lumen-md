/**
 * Chart-suggestion engine for tabular blocks (csv / tsv / json-table / data).
 *
 * Two pure stages:
 *
 *   1. `profileColumns(ds)` — classify every column semantically on top of
 *      the parser's storage type: time (dates, years, quarters, month
 *      names, clock times), numeric / percent / currency (including
 *      "12%", "$1,200", "(300)", "1 234" strings the CSV parser leaves as
 *      text), latitude / longitude, row ids, categorical (with
 *      cardinality) and free text.
 *   2. `suggestCharts(ds)` — score every chart that fits the profile and
 *      return them ranked, each with an i18n'ed label + reason the UI
 *      shows as alternatives:
 *
 *        map          lat + lon columns
 *        line         time axis × numeric (multi-series by measure or by
 *                     a small category)
 *        pie          one measure over ≤ 6 non-negative slices; preferred
 *                     when the slices add up to ~100 or are percentages
 *        stackedBar   ≥ 2 comparable measures over ≤ 20 categories
 *        bar          categorical × numeric (≤ 20 categories; top-20 when
 *                     there are 21–50)
 *        scatter      two numeric measures (boosted when correlated)
 *        histogram    one measure with many rows
 *        radar        ≥ 3 measures for ≤ 6 items
 *        summary bar  fallback: averages of numeric columns
 *
 * The return shape (`kind`, `label`, `option`, `score`) is unchanged for
 * existing callers; `id`, `reason` and the optional `map` spec are new.
 */

import type { DataColumn, DataSet } from "./csv";
import { t } from "../i18n";

export type ChartKind =
  | "bar"
  | "stackedBar"
  | "line"
  | "area"
  | "pie"
  | "scatter"
  | "histogram"
  | "map"
  | "heatmap"
  | "radar";

export interface MapMarkerSpec {
  lat: number;
  lng: number;
  label?: string;
}

export interface ChartSuggestion {
  /** Stable id (kind + columns) — unique within one result list. */
  id: string;
  kind: ChartKind;
  label: string;
  /** Why this chart fits the data (localised, one sentence). */
  reason: string;
  /** ECharts option object (for `map`, a lon/lat scatter fallback). */
  option: Record<string, unknown>;
  score: number;
  /** For `map`: markers for the Leaflet map block. */
  map?: { markers: MapMarkerSpec[] };
}

// ── Column profiling ───────────────────────────────────────────────────

export type SemanticType =
  | "time"
  | "numeric"
  | "percent"
  | "currency"
  | "latitude"
  | "longitude"
  | "id"
  | "categorical"
  | "text"
  | "empty";

export type TimeFormat = "date" | "year" | "quarter" | "month" | "clock";

export interface ColumnProfile {
  key: string;
  name: string;
  semantic: SemanticType;
  /** Distinct non-null values. */
  distinct: number;
  /** Non-null cells. */
  filled: number;
  timeFormat?: TimeFormat;
  min?: number;
  max?: number;
  sum?: number;
  /** All non-null numeric values are ≥ 0. */
  nonNegative?: boolean;
}

/** Numeric-ish semantic types that can be plotted as a measure. */
const MEASURE_TYPES: ReadonlySet<SemanticType> = new Set(["numeric", "percent", "currency"]);

const PERCENT_RE = /^[-+]?\d[\d,]*(\.\d+)?\s?%$/;
const CURRENCY_RE = /^\(?[-+]?\s?(?:[$€£¥₪₹]|USD|EUR|GBP|ILS)\s?\d[\d,]*(\.\d+)?\)?$|^\(?[-+]?\d[\d,]*(\.\d+)?\s?(?:[$€£¥₪₹]|USD|EUR|GBP|ILS)\)?$/i;
const GROUPED_NUM_RE = /^\(?[-+]?\d{1,3}([,  ]\d{3})+(\.\d+)?\)?$/;
const PLAIN_NUM_RE = /^\(?[-+]?\d+(\.\d+)?(e[+-]?\d+)?\)?$/i;
const QUARTER_RE = /^(?:(\d{4})\s*[-/ ]?\s*Q([1-4])|Q([1-4])\s*[-/ ]?\s*(\d{4}))$/i;
const CLOCK_RE = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];
const LAT_NAME_RE = /^(lat|latitude)$|[_\s-](lat|latitude)$/i;
const LON_NAME_RE = /^(lon|lng|long|longitude)$|[_\s-](lon|lng|long|longitude)$/i;
const ID_NAME_RE = /^(id|#|idx|index|row|rownum|row_?id|no\.?)$|[_\s-]id$/i;
const YEAR_NAME_RE = /^(year|yr|fy|fiscal[_\s]?year|שנה|سنة|jahr|année|annee|年|год)$/i;

function nonNull(values: unknown[]): unknown[] {
  return values.filter((v) => v !== null && v !== undefined && v !== "");
}

/** Parse "12%", "$1,200", "(300)", "1 234.5", "€ 9" → number (or null). */
export function parseLooseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/(?:[$€£¥₪₹]|USD|EUR|GBP|ILS)/gi, "").replace(/%$/, "").trim();
  if (!GROUPED_NUM_RE.test(s) && !PLAIN_NUM_RE.test(s)) return null;
  const n = Number(s.replace(/[,  ]/g, ""));
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

/** Sort key for ordinal time strings (quarters, months, clock times). */
function timeKey(raw: unknown, fmt: TimeFormat): number | null {
  if (fmt === "date" || fmt === "year") return typeof raw === "number" ? raw : null;
  const s = String(raw).trim();
  if (fmt === "quarter") {
    const m = QUARTER_RE.exec(s);
    if (!m) return null;
    const year = Number(m[1] ?? m[4]);
    const q = Number(m[2] ?? m[3]);
    return year * 4 + (q - 1);
  }
  if (fmt === "month") {
    const i = MONTHS.indexOf(s.slice(0, 3).toLowerCase());
    return i === -1 ? null : i;
  }
  const m = CLOCK_RE.exec(s);
  if (!m) return null;
  const [h, mi, se] = s.split(":").map(Number);
  return h * 3600 + mi * 60 + (se ?? 0);
}

function isMonthName(s: string): boolean {
  const lower = s.toLowerCase();
  return MONTHS.some((m) => lower === m || (lower.startsWith(m) && /^[a-z]+\.?$/.test(lower) && lower.length <= 9));
}

function share(values: unknown[], pred: (s: string) => boolean): number {
  if (values.length === 0) return 0;
  let n = 0;
  for (const v of values) if (pred(String(v).trim())) n++;
  return n / values.length;
}

function numericStats(nums: number[]) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const n of nums) {
    if (n < min) min = n;
    if (n > max) max = n;
    sum += n;
  }
  return { min, max, sum, nonNegative: min >= 0 };
}

function profileOne(col: DataColumn, rows: DataSet["rows"]): ColumnProfile {
  const values = nonNull(rows.map((r) => r[col.key]));
  const base = { key: col.key, name: col.name, distinct: col.distinct, filled: values.length };
  if (values.length === 0) return { ...base, semantic: "empty" };

  if (col.type === "date") {
    return { ...base, semantic: "time", timeFormat: "date", min: col.minDate, max: col.maxDate };
  }

  if (col.type === "number") {
    const nums = values as number[];
    const stats = numericStats(nums);
    const integers = nums.every((n) => Number.isInteger(n));
    if (LAT_NAME_RE.test(col.name) && stats.min >= -90 && stats.max <= 90) {
      return { ...base, ...stats, semantic: "latitude" };
    }
    if (LON_NAME_RE.test(col.name) && stats.min >= -180 && stats.max <= 180) {
      return { ...base, ...stats, semantic: "longitude" };
    }
    // Years: integers in 1800–2100 that are either named like a year or
    // form a strictly monotonic, unique sequence (1999, 2000, 2001…).
    const monotonic =
      nums.length >= 3 &&
      (nums.every((n, i) => i === 0 || n > nums[i - 1]) || nums.every((n, i) => i === 0 || n < nums[i - 1]));
    if (integers && stats.min >= 1800 && stats.max <= 2100 && (YEAR_NAME_RE.test(col.name) || monotonic)) {
      return { ...base, ...stats, semantic: "time", timeFormat: "year" };
    }
    if (integers && ID_NAME_RE.test(col.name) && col.distinct === values.length) {
      return { ...base, ...stats, semantic: "id" };
    }
    return { ...base, ...stats, semantic: "numeric" };
  }

  if (col.type === "boolean") return { ...base, semantic: "categorical" };

  // String column — look for numbers the CSV parser left as text.
  if (share(values, (s) => PERCENT_RE.test(s)) >= 0.9) {
    const nums = values.map(parseLooseNumber).filter((n): n is number => n !== null);
    return { ...base, ...numericStats(nums), semantic: "percent" };
  }
  if (share(values, (s) => CURRENCY_RE.test(s)) >= 0.9) {
    const nums = values.map(parseLooseNumber).filter((n): n is number => n !== null);
    return { ...base, ...numericStats(nums), semantic: "currency" };
  }
  if (share(values, (s) => GROUPED_NUM_RE.test(s) || PLAIN_NUM_RE.test(s)) >= 0.9) {
    const nums = values.map(parseLooseNumber).filter((n): n is number => n !== null);
    return { ...base, ...numericStats(nums), semantic: "numeric" };
  }
  for (const [fmt, pred] of [
    ["quarter", (s: string) => QUARTER_RE.test(s)],
    ["month", isMonthName],
    ["clock", (s: string) => CLOCK_RE.test(s)],
  ] as const) {
    if (share(values, pred) >= 0.9) return { ...base, semantic: "time", timeFormat: fmt };
  }
  return { ...base, semantic: col.distinct <= 50 ? "categorical" : "text" };
}

export function profileColumns(ds: DataSet): ColumnProfile[] {
  return ds.columns.map((c) => profileOne(c, ds.rows));
}

// ── Helpers ────────────────────────────────────────────────────────────

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

const AXIS_LABEL = { color: "#9aa3b2" };
const AXIS_LINE = { lineStyle: { color: "#3a3f4b" } };
const SPLIT_LINE = { lineStyle: { color: "#2a2f3a" } };

function baseOption(): Record<string, unknown> {
  return {
    color: PALETTE,
    grid: { left: 50, right: 24, top: 36, bottom: 40, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 6, textStyle: { color: "#9aa3b2" } },
    textStyle: { fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" },
  };
}

function num(row: Record<string, unknown>, p: ColumnProfile): number | null {
  return parseLooseNumber(row[p.key]);
}

function catKey(row: Record<string, unknown>, p: ColumnProfile): string {
  const v = row[p.key];
  return v === null || v === undefined || v === "" ? "—" : String(v);
}

function fmtNum(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e6 || abs < 1e-3) return n.toExponential(2);
  return String(Number(n.toPrecision(4)));
}

function names(ps: ColumnProfile[]): string {
  return ps.map((p) => p.name).join(", ");
}

/** Percentages are averaged when a category repeats; everything else sums. */
function aggregate(
  rows: DataSet["rows"],
  keyOf: (r: Record<string, unknown>) => string,
  measures: ColumnProfile[],
): Map<string, number[]> {
  const acc = new Map<string, { sum: number[]; n: number[] }>();
  for (const r of rows) {
    const k = keyOf(r);
    let a = acc.get(k);
    if (!a) {
      a = { sum: measures.map(() => 0), n: measures.map(() => 0) };
      acc.set(k, a);
    }
    measures.forEach((m, i) => {
      const v = num(r, m);
      if (v === null) return;
      a!.sum[i] += v;
      a!.n[i] += 1;
    });
  }
  const out = new Map<string, number[]>();
  for (const [k, a] of acc) {
    out.set(
      k,
      measures.map((m, i) => (m.semantic === "percent" && a.n[i] > 0 ? a.sum[i] / a.n[i] : a.sum[i])),
    );
  }
  return out;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

function pairs(rows: DataSet["rows"], x: ColumnProfile, y: ColumnProfile): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const r of rows) {
    const a = num(r, x);
    const b = num(r, y);
    if (a !== null && b !== null) out.push([a, b]);
  }
  return out;
}

// ── Builders ───────────────────────────────────────────────────────────

function timeLabel(raw: unknown, p: ColumnProfile): string {
  if (p.timeFormat === "date" && typeof raw === "number") {
    const iso = new Date(raw).toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
  }
  return String(raw);
}

function buildLine(
  ds: DataSet,
  x: ColumnProfile,
  ys: ColumnProfile[],
  by?: ColumnProfile,
): ChartSuggestion {
  // Order the axis by the time key, aggregating duplicate timestamps.
  const keyed = new Map<string, number>();
  for (const r of ds.rows) {
    const raw = r[x.key];
    if (raw === null || raw === undefined || raw === "") continue;
    const k = timeKey(raw, x.timeFormat ?? "date");
    if (k === null) continue;
    keyed.set(timeLabel(raw, x), k);
  }
  const labels = [...keyed.entries()].sort((a, b) => a[1] - b[1]).map(([l]) => l);
  const xKey = (r: Record<string, unknown>) => timeLabel(r[x.key], x);

  let series: Array<Record<string, unknown>>;
  if (by) {
    const groups = new Map<string, DataSet["rows"]>();
    for (const r of ds.rows) {
      const g = catKey(r, by);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(r);
    }
    series = [...groups.entries()].map(([g, rows]) => {
      const agg = aggregate(rows, xKey, ys);
      return {
        name: g,
        type: "line",
        smooth: true,
        showSymbol: labels.length <= 24,
        connectNulls: true,
        data: labels.map((l) => agg.get(l)?.[0] ?? null),
      };
    });
  } else {
    const agg = aggregate(ds.rows, xKey, ys);
    series = ys.map((y, i) => ({
      name: y.name,
      type: "line",
      smooth: true,
      showSymbol: labels.length <= 24,
      areaStyle: ys.length === 1 ? { opacity: 0.18 } : undefined,
      data: labels.map((l) => agg.get(l)?.[i] ?? null),
    }));
  }

  return {
    id: `line:${x.key}:${ys.map((y) => y.key).join("+")}${by ? `:by:${by.key}` : ""}`,
    kind: "line",
    label: by
      ? t("chart.label.lineBy", { y: ys[0].name, x: x.name, by: by.name })
      : t("chart.label.line", { y: names(ys), x: x.name }),
    reason: by
      ? t("chart.reason.lineBy", { x: x.name, n: labels.length, by: by.name, k: series.length })
      : t("chart.reason.line", { x: x.name, n: labels.length }),
    score: 100,
    option: {
      ...baseOption(),
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: labels, boundaryGap: false, axisLabel: AXIS_LABEL, axisLine: AXIS_LINE },
      yAxis: { type: "value", axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
      series,
    },
  };
}

function topCategories(ds: DataSet, cat: ColumnProfile, measure: ColumnProfile, limit: number) {
  const agg = aggregate(ds.rows, (r) => catKey(r, cat), [measure]);
  return [...agg.entries()]
    .sort((a, b) => b[1][0] - a[1][0])
    .slice(0, limit)
    .map(([k]) => k);
}

function buildBar(
  ds: DataSet,
  cat: ColumnProfile,
  measures: ColumnProfile[],
  opts: { stacked?: boolean; top?: number; score: number; reason: string },
): ChartSuggestion {
  const agg = aggregate(ds.rows, (r) => catKey(r, cat), measures);
  const labels = opts.top ? topCategories(ds, cat, measures[0], opts.top) : [...agg.keys()];
  const kind: ChartKind = opts.stacked ? "stackedBar" : "bar";
  const label = opts.stacked
    ? t("chart.label.stackedBar", { y: names(measures), x: cat.name })
    : opts.top
      ? t("chart.label.barTop", { n: opts.top, x: cat.name, y: measures[0].name })
      : t("chart.label.bar", { y: names(measures), x: cat.name });
  return {
    id: `${kind}:${cat.key}:${measures.map((m) => m.key).join("+")}${opts.top ? `:top${opts.top}` : ""}`,
    kind,
    label,
    reason: opts.reason,
    score: opts.score,
    option: {
      ...baseOption(),
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { ...AXIS_LABEL, interval: 0, rotate: labels.length > 6 ? 30 : 0 },
        axisLine: AXIS_LINE,
      },
      yAxis: { type: "value", axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
      series: measures.map((m, i) => ({
        name: m.name,
        type: "bar",
        barMaxWidth: 36,
        ...(opts.stacked ? { stack: "total", emphasis: { focus: "series" } } : {}),
        data: labels.map((l) => agg.get(l)?.[i] ?? 0),
        itemStyle: opts.stacked && i < measures.length - 1 ? undefined : { borderRadius: [4, 4, 0, 0] },
      })),
    },
  };
}

function buildPie(ds: DataSet, cat: ColumnProfile, m: ColumnProfile, score: number, reason: string): ChartSuggestion {
  const agg = aggregate(ds.rows, (r) => catKey(r, cat), [m]);
  return {
    id: `pie:${cat.key}:${m.key}`,
    kind: "pie",
    label: t("chart.label.pie", { y: m.name, x: cat.name }),
    reason,
    score,
    option: {
      ...baseOption(),
      tooltip: { trigger: "item" },
      legend: { orient: "vertical", left: 8, top: "middle", textStyle: { color: "#9aa3b2" } },
      series: [
        {
          name: m.name,
          type: "pie",
          radius: ["45%", "72%"],
          itemStyle: { borderRadius: 6, borderColor: "transparent", borderWidth: 2 },
          label: { color: "#9aa3b2" },
          data: [...agg.entries()].map(([name, v]) => ({ name, value: v[0] })),
        },
      ],
    },
  };
}

function valueAxis(name: string) {
  return { type: "value", name, nameTextStyle: AXIS_LABEL, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE, scale: true };
}

function buildScatter(
  ds: DataSet,
  x: ColumnProfile,
  y: ColumnProfile,
  by: ColumnProfile | undefined,
  score: number,
  reason: string,
): ChartSuggestion {
  let series: Array<Record<string, unknown>>;
  if (by) {
    const groups = new Map<string, Array<[number, number]>>();
    for (const r of ds.rows) {
      const a = num(r, x);
      const b = num(r, y);
      if (a === null || b === null) continue;
      const k = catKey(r, by);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push([a, b]);
    }
    series = [...groups.entries()].map(([name, data]) => ({ name, type: "scatter", symbolSize: 9, data }));
  } else {
    series = [{ type: "scatter", symbolSize: 9, data: pairs(ds.rows, x, y) }];
  }
  return {
    id: `scatter:${x.key}:${y.key}${by ? `:by:${by.key}` : ""}`,
    kind: "scatter",
    label: by
      ? t("chart.label.scatterBy", { y: y.name, x: x.name, by: by.name })
      : t("chart.label.scatter", { y: y.name, x: x.name }),
    reason,
    score,
    option: { ...baseOption(), tooltip: { trigger: "item" }, xAxis: valueAxis(x.name), yAxis: valueAxis(y.name), series },
  };
}

/** Sturges' rule, clamped to 5–30 bins. */
export function histogramBins(values: number[]): Array<{ from: number; to: number; count: number }> {
  if (values.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) return [{ from: min, to: max, count: values.length }];
  const k = Math.max(5, Math.min(30, Math.ceil(Math.log2(values.length) + 1)));
  const width = (max - min) / k;
  const bins = Array.from({ length: k }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  for (const v of values) {
    const i = Math.min(k - 1, Math.floor((v - min) / width));
    bins[i].count++;
  }
  return bins;
}

function buildHistogram(ds: DataSet, m: ColumnProfile, score: number): ChartSuggestion {
  const values = ds.rows.map((r) => num(r, m)).filter((v): v is number => v !== null);
  const bins = histogramBins(values);
  return {
    id: `histogram:${m.key}`,
    kind: "histogram",
    label: t("chart.label.histogram", { x: m.name }),
    reason: t("chart.reason.histogram", { n: values.length, x: m.name, k: bins.length }),
    score,
    option: {
      ...baseOption(),
      legend: { show: false },
      xAxis: {
        type: "category",
        name: m.name,
        nameTextStyle: AXIS_LABEL,
        data: bins.map((b) => `${fmtNum(b.from)}–${fmtNum(b.to)}`),
        axisLabel: { ...AXIS_LABEL, rotate: bins.length > 8 ? 30 : 0 },
        axisLine: AXIS_LINE,
      },
      yAxis: { type: "value", minInterval: 1, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
      series: [{ name: m.name, type: "bar", barCategoryGap: "4%", data: bins.map((b) => b.count) }],
    },
  };
}

const MAX_MAP_MARKERS = 500;

function buildMap(ds: DataSet, lat: ColumnProfile, lon: ColumnProfile, labelCol?: ColumnProfile): ChartSuggestion {
  const markers: MapMarkerSpec[] = [];
  for (const r of ds.rows) {
    const a = num(r, lat);
    const b = num(r, lon);
    if (a === null || b === null) continue;
    markers.push(labelCol ? { lat: a, lng: b, label: catKey(r, labelCol) } : { lat: a, lng: b });
    if (markers.length >= MAX_MAP_MARKERS) break;
  }
  return {
    id: `map:${lat.key}:${lon.key}`,
    kind: "map",
    label: t("chart.label.map", { n: markers.length }),
    reason: t("chart.reason.map", { lat: lat.name, lon: lon.name }),
    score: 105,
    map: { markers },
    option: {
      ...baseOption(),
      tooltip: { trigger: "item" },
      xAxis: { ...valueAxis(lon.name), min: -180, max: 180, scale: false },
      yAxis: { ...valueAxis(lat.name), min: -90, max: 90, scale: false },
      series: [{ type: "scatter", symbolSize: 8, data: markers.map((m) => [m.lng, m.lat, m.label ?? ""]) }],
    },
  };
}

function buildRadar(ds: DataSet, cat: ColumnProfile, measures: ColumnProfile[]): ChartSuggestion {
  const groups = new Map<string, { sum: number[]; n: number[] }>();
  for (const r of ds.rows) {
    const k = catKey(r, cat);
    if (!groups.has(k)) groups.set(k, { sum: measures.map(() => 0), n: measures.map(() => 0) });
    const g = groups.get(k)!;
    measures.forEach((m, i) => {
      const v = num(r, m);
      if (v === null) return;
      g.sum[i] += v;
      g.n[i] += 1;
    });
  }
  return {
    id: `radar:${cat.key}:${measures.map((m) => m.key).join("+")}`,
    kind: "radar",
    label: t("chart.label.radar", { y: names(measures), x: cat.name }),
    reason: t("chart.reason.radar", { k: measures.length, n: groups.size }),
    score: 50,
    option: {
      ...baseOption(),
      tooltip: {},
      radar: {
        indicator: measures.map((m) => ({ name: m.name, max: m.max ?? 100 })),
        splitLine: SPLIT_LINE,
        axisName: AXIS_LABEL,
      },
      series: [
        {
          type: "radar",
          areaStyle: { opacity: 0.18 },
          data: [...groups.entries()].map(([name, g]) => ({
            name,
            value: measures.map((_, i) => (g.n[i] ? g.sum[i] / g.n[i] : 0)),
          })),
        },
      ],
    },
  };
}

function buildSummary(ds: DataSet, measures: ColumnProfile[]): ChartSuggestion {
  const means = measures.map((m) => {
    const vs = ds.rows.map((r) => num(r, m)).filter((v): v is number => v !== null);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
  });
  return {
    id: "summary",
    kind: "bar",
    label: t("chart.label.summary"),
    reason: t("chart.reason.summary"),
    score: 30,
    option: {
      ...baseOption(),
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: measures.map((m) => m.name), axisLabel: AXIS_LABEL },
      yAxis: { type: "value", axisLabel: AXIS_LABEL },
      series: [{ type: "bar", barMaxWidth: 36, itemStyle: { borderRadius: [4, 4, 0, 0] }, data: means }],
    },
  };
}

// ── Ranking ────────────────────────────────────────────────────────────

/** Thresholds, exported so tests and docs stay in sync with the code. */
export const SUGGEST_LIMITS = {
  barMaxCategories: 20,
  barTopMaxCategories: 50,
  pieMaxSlices: 6,
  lineByMaxSeries: 8,
  histogramMinRows: 20,
  histogramMinDistinct: 8,
  radarMaxItems: 6,
  strongCorrelation: 0.6,
} as const;

/** Two measures are "comparable" (worth stacking) when they share a unit/scale. */
function comparable(ms: ColumnProfile[]): boolean {
  const units = new Set(ms.map((m) => m.semantic));
  if (units.size > 1) return false;
  const maxes = ms.map((m) => Math.max(Math.abs(m.max ?? 0), Math.abs(m.min ?? 0)) || 1);
  return Math.max(...maxes) / Math.min(...maxes) <= 10;
}

export function suggestCharts(ds: DataSet): ChartSuggestion[] {
  if (ds.rows.length === 0 || ds.columns.length === 0) return [];
  const profiles = profileColumns(ds);
  const rowCount = ds.rows.length;

  const measures = profiles.filter((p) => MEASURE_TYPES.has(p.semantic));
  const times = profiles.filter((p) => p.semantic === "time" && p.distinct >= 2);
  const cats = profiles.filter((p) => p.semantic === "categorical" && p.distinct >= 1);
  const lat = profiles.find((p) => p.semantic === "latitude");
  const lon = profiles.find((p) => p.semantic === "longitude");
  const L = SUGGEST_LIMITS;

  const out: ChartSuggestion[] = [];

  // Map: lat/lon pair.
  if (lat && lon) {
    const labelCol = cats[0] ?? profiles.find((p) => p.semantic === "text");
    out.push(buildMap(ds, lat, lon, labelCol));
  }

  // Line: time axis × measures (or one measure split by a small category).
  if (times.length >= 1 && measures.length >= 1) {
    const x = times[0];
    const by = cats.find((c) => c.distinct >= 2 && c.distinct <= L.lineByMaxSeries);
    if (measures.length === 1 && by) out.push(buildLine(ds, x, measures, by));
    else out.push(buildLine(ds, x, measures.slice(0, 4)));
  }

  // Categorical comparisons.
  const cat = cats.find((c) => c.distinct >= 2) ?? cats[0];
  if (cat && measures.length >= 1) {
    const first = measures[0];
    if (cat.distinct <= L.barMaxCategories) {
      const ms = measures.slice(0, 4);
      const stackable = ms.length >= 2 && ms.every((m) => m.nonNegative) && comparable(ms);
      out.push(
        buildBar(ds, cat, ms, {
          score: stackable ? 89 : 90,
          reason:
            ms.length > 1
              ? t("chart.reason.barGrouped", { n: cat.distinct, k: ms.length })
              : t("chart.reason.bar", { n: cat.distinct, y: first.name }),
        }),
      );
      if (ms.length >= 2 && ms.every((m) => m.nonNegative)) {
        out.push(
          buildBar(ds, cat, ms, {
            stacked: true,
            score: stackable ? 91 : 62,
            reason: stackable
              ? t("chart.reason.stackedBar", { k: ms.length })
              : t("chart.reason.stackedBarMixed", { k: ms.length }),
          }),
        );
      }
    } else if (cat.distinct <= L.barTopMaxCategories) {
      out.push(
        buildBar(ds, cat, [first], {
          top: L.barMaxCategories,
          score: 60,
          reason: t("chart.reason.barTop", { total: cat.distinct, n: L.barMaxCategories }),
        }),
      );
    }

    // Pie: single measure, few non-negative slices.
    if (cat.distinct >= 2 && cat.distinct <= L.pieMaxSlices && first.nonNegative) {
      const agg = aggregate(ds.rows, (r) => catKey(r, cat), [first]);
      const total = [...agg.values()].reduce((a, v) => a + v[0], 0);
      if (total > 0) {
        const sumsTo100 = Math.abs(total - 100) <= 1.5 || Math.abs(total - 1) <= 0.015;
        const single = measures.length === 1;
        let score: number;
        let reason: string;
        if (sumsTo100) {
          score = single ? 92 : 80;
          reason = t("chart.reason.pieSum", { n: agg.size, total: fmtNum(total) });
        } else if (first.semantic === "percent") {
          score = single ? 86 : 76;
          reason = t("chart.reason.piePercent", { y: first.name, n: agg.size });
        } else {
          score = single ? 72 : 58;
          reason = t("chart.reason.pie", { n: agg.size });
        }
        out.push(buildPie(ds, cat, first, score, reason));
      }
    }

    // Radar: ≥ 3 measures for a handful of items.
    if (cat.distinct <= L.radarMaxItems && measures.length >= 3) {
      out.push(buildRadar(ds, cat, measures.slice(0, 6)));
    }
  }

  // Scatter: two measures.
  if (measures.length >= 2) {
    const [x, y] = measures;
    const ps = pairs(ds.rows, x, y);
    const r = pearson(ps.map((p) => p[0]), ps.map((p) => p[1]));
    const strong = Math.abs(r) >= L.strongCorrelation && ps.length >= 4;
    const noAxis = times.length === 0 && !cat;
    const by = cats.find((c) => c.distinct >= 2 && c.distinct <= 10);
    out.push(
      buildScatter(
        ds,
        x,
        y,
        by,
        (strong ? 84 : 70) + (noAxis ? 10 : 0),
        strong
          ? t("chart.reason.scatterCorr", { x: x.name, y: y.name, r: r.toFixed(2) })
          : t("chart.reason.scatter", { x: x.name, y: y.name }),
      ),
    );
  }

  // Histogram: distribution of a single measure with enough rows.
  if (measures.length >= 1 && rowCount >= L.histogramMinRows) {
    const m = measures[0];
    if (m.distinct >= L.histogramMinDistinct) {
      const noAxis = times.length === 0 && !cat;
      out.push(buildHistogram(ds, m, noAxis ? (measures.length === 1 ? 82 : 74) : 55));
    }
  }

  // Fallback: no axis at all → compare averages.
  if (out.length === 0 && measures.length >= 1) out.push(buildSummary(ds, measures));

  const seen = new Set<string>();
  return out
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    .sort((a, b) => b.score - a.score);
}
