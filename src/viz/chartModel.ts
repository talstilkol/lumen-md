/**
 * Charts from Bases and query results (plan W12.V1): bar, line, pie,
 * scatter, heatmap and a calendar heatmap.
 *
 * One model, three readers. `chartData` turns rows into the numbers to
 * draw; `chartOption` turns those numbers into an ECharts 6 option, and
 * `chartTable` into the data table that stands in for the chart. Both read
 * the same `ChartData`, so the table holds exactly what the chart shows —
 * nothing recomputed, nothing rounded on one side only. `chartPoints` is the
 * keyboard order over the same numbers.
 *
 * Right to left: the category axis is inverted (the first category on the
 * right), the value axis and the legend sit on the right, and every label
 * that reaches the canvas is an FSI … PDI isolate (./bidi.ts), as the
 * ECharts aria docs leave direction to the page.
 *
 * The calendar heatmap is drawn on a cartesian grid (weeks × weekdays), not
 * with ECharts' `calendar` coordinate: that one is Gregorian only and has no
 * way to run its weeks right to left. The Hebrew month view (W12.V5) uses
 * the same grid with Hebrew months.
 *
 * Pure: no DOM, no ECharts import. Dates are UTC days, as in Bases.
 */

import { isolate, type Dir } from "./bidi";

export type VizChartKind = "bar" | "line" | "pie" | "scatter" | "heatmap" | "calendar";
export const VIZ_CHART_KINDS: readonly VizChartKind[] = ["bar", "line", "pie", "scatter", "heatmap", "calendar"];
export type VizAgg = "count" | "sum" | "avg" | "min" | "max";
export const VIZ_AGGS: readonly VizAgg[] = ["count", "sum", "avg", "min", "max"];

/** A cell as charts see it: plain values only (the Bases and query adapters convert theirs). */
export type VizCell = string | number | boolean | Date | null | VizCell[];
export type VizRow = Record<string, VizCell>;

export interface ChartSpec {
  kind: VizChartKind;
  /** Category (bar, line, pie, heatmap columns), number (scatter) or date (calendar). */
  x: string;
  /** The measure; absent: the count of rows. */
  y?: string;
  /** Bar, line, scatter: one series per value. Heatmap: the row category. */
  series?: string;
  /** How rows of one category combine; default `count` without `y`, `sum` with. */
  agg?: VizAgg;
  /** Scatter: the point's name (default `file.name`). */
  label?: string;
}

export interface CategoryData {
  kind: "bar" | "line" | "pie";
  categories: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
}
export interface ScatterData {
  kind: "scatter";
  series: Array<{ name: string; points: Array<{ x: number; y: number; label: string }> }>;
}
export interface HeatmapData {
  kind: "heatmap";
  xs: string[];
  ys: string[];
  /** [x index, y index, value]; a pair with no rows has no cell. */
  cells: Array<[number, number, number]>;
  min: number;
  max: number;
}
export interface CalendarData {
  kind: "calendar";
  /** ISO days with a value, ascending. */
  days: Array<{ day: string; value: number }>;
  /** The first day of the first week shown, and the number of weeks. */
  start: string;
  weeks: number;
  firstDay: number;
  min: number;
  max: number;
}
export type ChartData = CategoryData | ScatterData | HeatmapData | CalendarData;

/** No value in the cell (for categories: the "—" bucket). */
export const NONE = "—";
/** At most this many categories / series / heatmap rows; the rest are left out, and `chartData` says how many. */
export const MAX_CATEGORIES = 200;
export const MAX_SERIES = 12;
/** A calendar spans at most this many weeks (three years): a stray date doesn't make a 300-year grid. */
export const MAX_WEEKS = 157;

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dayNum = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const dayOf = (n: number) => isoDay(new Date(n * DAY_MS));

/** A cell as a number, or null: numbers, numeric text ("1,234.5", "12%"), booleans as 0/1. */
export function cellNumber(v: VizCell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const s = v.replace(/[,\s ]/g, "").replace(/%$/, "");
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A cell as an ISO day, or null: a Date, or text that starts with YYYY-MM-DD. */
export function cellDay(v: VizCell): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : isoDay(v);
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 ? isoDay(d) : null;
  }
  return null;
}

/** The categories of a cell: a list counts in each of its values (a note with two tags is in both bars). */
export function cellCategories(v: VizCell): string[] {
  if (Array.isArray(v)) {
    const out = [...new Set(v.flatMap(cellCategories))];
    return out.length ? out : [NONE];
  }
  if (v === null || v === "") return [NONE];
  if (v instanceof Date) return [cellDay(v) ?? NONE];
  return [String(v)];
}

interface Acc {
  n: number;
  sum: number;
  min: number;
  max: number;
}
const newAcc = (): Acc => ({ n: 0, sum: 0, min: Infinity, max: -Infinity });
function add(a: Acc, v: number) {
  a.n += 1;
  a.sum += v;
  if (v < a.min) a.min = v;
  if (v > a.max) a.max = v;
}
function result(a: Acc | undefined, agg: VizAgg): number | null {
  if (!a || a.n === 0) return null;
  switch (agg) {
    case "count":
      return a.n;
    case "sum":
      return a.sum;
    case "avg":
      return a.sum / a.n;
    case "min":
      return a.min;
    case "max":
      return a.max;
  }
}

/** The number a row adds: 1 for a count, else its measure (null: the row has no number and is skipped). */
function measure(row: VizRow, spec: ChartSpec, agg: VizAgg): number | null {
  if (agg === "count" || !spec.y) return 1;
  return cellNumber(row[spec.y] ?? null);
}

const aggOf = (spec: ChartSpec): VizAgg => (!spec.y ? "count" : (spec.agg ?? "sum"));

/** Categories in reading order: all ISO days → by date; all numbers → numerically; else by locale, "—" last. */
export function orderCategories(keys: Iterable<string>, locale = "he"): string[] {
  const list = [...keys];
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const real = list.filter((k) => k !== NONE);
  const tail = list.length > real.length ? [NONE] : [];
  if (real.every((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))) return [...real.sort(), ...tail];
  if (real.every((k) => cellNumber(k) !== null)) return [...real.sort((a, b) => cellNumber(a)! - cellNumber(b)!), ...tail];
  return [...real.sort(collator.compare), ...tail];
}

export interface ChartDataResult {
  data: ChartData;
  /** Rows that had no usable x (or y) and are not in the chart. */
  skipped: number;
  /** Categories / series / weeks left out over the caps. */
  truncated: number;
}

export function chartData(rows: readonly VizRow[], spec: ChartSpec, locale = "he"): ChartDataResult {
  const agg = aggOf(spec);
  let skipped = 0;
  let truncated = 0;
  if (spec.kind === "scatter") {
    const bySeries = new Map<string, Array<{ x: number; y: number; label: string }>>();
    for (const r of rows) {
      const x = cellNumber(r[spec.x] ?? null);
      const y = spec.y ? cellNumber(r[spec.y] ?? null) : null;
      if (x === null || y === null) {
        skipped++;
        continue;
      }
      const s = spec.series ? cellCategories(r[spec.series] ?? null)[0] : "";
      const label = String(r[spec.label ?? "file.name"] ?? "");
      if (!bySeries.has(s)) bySeries.set(s, []);
      bySeries.get(s)!.push({ x, y, label });
    }
    let names = orderCategories(bySeries.keys(), locale);
    if (names.length > MAX_SERIES) {
      truncated += names.length - MAX_SERIES;
      names = names.slice(0, MAX_SERIES);
    }
    return { data: { kind: "scatter", series: names.map((name) => ({ name, points: bySeries.get(name)! })) }, skipped, truncated };
  }
  if (spec.kind === "calendar") {
    const accs = new Map<string, Acc>();
    for (const r of rows) {
      const day = cellDay(r[spec.x] ?? null);
      const m = day ? measure(r, spec, agg) : null;
      if (!day || m === null) {
        skipped++;
        continue;
      }
      if (!accs.has(day)) accs.set(day, newAcc());
      add(accs.get(day)!, m);
    }
    let days = [...accs.keys()].sort().map((day) => ({ day, value: result(accs.get(day), agg)! }));
    const firstDay = 0;
    if (days.length) {
      // Keep the latest MAX_WEEKS weeks.
      const last = dayNum(days[days.length - 1].day);
      const lastWeekEnd = last + ((firstDay + 6 - weekday(last)) % 7 + 7) % 7;
      const earliest = lastWeekEnd - MAX_WEEKS * 7 + 1;
      const kept = days.filter((d) => dayNum(d.day) >= earliest);
      truncated += days.length - kept.length;
      days = kept;
    }
    const first = days.length ? dayNum(days[0].day) : 0;
    const start = first - ((weekday(first) - firstDay + 7) % 7);
    const end = days.length ? dayNum(days[days.length - 1].day) : start;
    const weeks = days.length ? Math.floor((end - start) / 7) + 1 : 0;
    const values = days.map((d) => d.value);
    return {
      data: { kind: "calendar", days, start: dayOf(start), weeks, firstDay, min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 0 },
      skipped,
      truncated,
    };
  }
  if (spec.kind === "heatmap") {
    const accs = new Map<string, Acc>();
    const xs = new Set<string>();
    const ys = new Set<string>();
    for (const r of rows) {
      const m = measure(r, spec, agg);
      if (m === null) {
        skipped++;
        continue;
      }
      for (const x of cellCategories(r[spec.x] ?? null))
        for (const y of cellCategories(spec.series ? (r[spec.series] ?? null) : null)) {
          xs.add(x);
          ys.add(y);
          const k = `${x}\u0000${y}`;
          if (!accs.has(k)) accs.set(k, newAcc());
          add(accs.get(k)!, m);
        }
    }
    let xl = orderCategories(xs, locale);
    let yl = orderCategories(ys, locale);
    if (xl.length > MAX_CATEGORIES) {
      truncated += xl.length - MAX_CATEGORIES;
      xl = xl.slice(0, MAX_CATEGORIES);
    }
    if (yl.length > MAX_CATEGORIES) {
      truncated += yl.length - MAX_CATEGORIES;
      yl = yl.slice(0, MAX_CATEGORIES);
    }
    const cells: Array<[number, number, number]> = [];
    xl.forEach((x, xi) =>
      yl.forEach((y, yi) => {
        const v = result(accs.get(`${x}\u0000${y}`), agg);
        if (v !== null) cells.push([xi, yi, v]);
      }),
    );
    const values = cells.map((c) => c[2]);
    return { data: { kind: "heatmap", xs: xl, ys: yl, cells, min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 0 }, skipped, truncated };
  }
  // bar, line, pie
  const accs = new Map<string, Map<string, Acc>>();
  const cats = new Set<string>();
  const seriesNames = new Set<string>();
  for (const r of rows) {
    const m = measure(r, spec, agg);
    if (m === null) {
      skipped++;
      continue;
    }
    const xv = r[spec.x] ?? null;
    const keys = spec.kind === "line" && cellDay(xv as VizCell) ? [cellDay(xv as VizCell)!] : cellCategories(xv);
    const ss = spec.kind !== "pie" && spec.series ? cellCategories(r[spec.series] ?? null) : [""];
    for (const k of keys)
      for (const s of ss) {
        cats.add(k);
        seriesNames.add(s);
        if (!accs.has(s)) accs.set(s, new Map());
        const bucket = accs.get(s)!;
        if (!bucket.has(k)) bucket.set(k, newAcc());
        add(bucket.get(k)!, m);
      }
  }
  let categories = orderCategories(cats, locale);
  if (categories.length > MAX_CATEGORIES) {
    truncated += categories.length - MAX_CATEGORIES;
    categories = categories.slice(0, MAX_CATEGORIES);
  }
  let names = orderCategories(seriesNames, locale);
  if (names.length > MAX_SERIES) {
    truncated += names.length - MAX_SERIES;
    names = names.slice(0, MAX_SERIES);
  }
  const series = names.map((name) => ({ name, values: categories.map((c) => result(accs.get(name)?.get(c), agg)) }));
  return { data: { kind: spec.kind, categories, series }, skipped, truncated };
}

/** 0 = Sunday … 6 = Saturday, for a day number (days since 1970-01-01, a Thursday). */
const weekday = (n: number) => (((n + 4) % 7) + 7) % 7;

/** The week column and weekday row of a calendar day. */
export function calendarCell(data: Pick<CalendarData, "start" | "firstDay">, day: string): [number, number] {
  const n = dayNum(day);
  const s = dayNum(data.start);
  return [Math.floor((n - s) / 7), (weekday(n) - data.firstDay + 7) % 7];
}

/** The first day of each week column of a calendar. */
export function calendarWeeks(data: Pick<CalendarData, "start" | "weeks">): string[] {
  const s = dayNum(data.start);
  return Array.from({ length: data.weeks }, (_, i) => dayOf(s + i * 7));
}

// ── The table ──────────────────────────────────────────────────────────

export interface ChartTable {
  columns: string[];
  /** Text cells are labels; numbers stay numbers (the view formats them). null: no value. */
  rows: Array<Array<string | number | null>>;
}

export interface ChartLabels {
  x: string;
  y: string;
  series?: string;
  /** Scatter: the point's name column. */
  label?: string;
  /** Calendar: the date column. */
  day?: string;
}

/** The data table of a chart: exactly the numbers `chartOption` draws. */
export function chartTable(data: ChartData, labels: ChartLabels): ChartTable {
  switch (data.kind) {
    case "bar":
    case "line":
    case "pie": {
      const one = data.series.length === 1 && data.series[0].name === "";
      return {
        columns: [labels.x, ...(one ? [labels.y] : data.series.map((s) => s.name))],
        rows: data.categories.map((c, i) => [c, ...data.series.map((s) => s.values[i])]),
      };
    }
    case "scatter": {
      const named = !(data.series.length === 1 && data.series[0].name === "");
      return {
        columns: [...(named ? [labels.series ?? ""] : []), labels.label ?? "", labels.x, labels.y],
        rows: data.series.flatMap((s) => s.points.map((p) => [...(named ? [s.name] : []), p.label, p.x, p.y])),
      };
    }
    case "heatmap": {
      const at = new Map(data.cells.map(([x, y, v]) => [`${x},${y}`, v]));
      return {
        columns: [labels.series ?? "", ...data.xs],
        rows: data.ys.map((y, yi) => [y, ...data.xs.map((_, xi) => at.get(`${xi},${yi}`) ?? null)]),
      };
    }
    case "calendar":
      return { columns: [labels.day ?? labels.x, labels.y], rows: data.days.map((d) => [d.day, d.value]) };
  }
}

// ── Keyboard order ─────────────────────────────────────────────────────

export interface ChartPoint {
  seriesIndex: number;
  dataIndex: number;
  series: string;
  label: string;
  value: string;
}

const show = (n: number | null) => (n === null ? NONE : String(Number(n.toPrecision(6))));

/** Every drawn point in reading order: by category, then series (what the arrow keys walk through). */
export function chartPoints(data: ChartData): ChartPoint[] {
  switch (data.kind) {
    case "bar":
    case "line":
    case "pie":
      return data.categories.flatMap((c, i) =>
        data.series.map((s, si) => ({ seriesIndex: si, dataIndex: i, series: s.name, label: c, value: show(s.values[i]) })).filter((p) => p.value !== NONE),
      );
    case "scatter":
      return data.series.flatMap((s, si) => s.points.map((p, i) => ({ seriesIndex: si, dataIndex: i, series: s.name, label: p.label, value: `${show(p.x)}, ${show(p.y)}` })));
    case "heatmap":
      return data.cells.map(([x, y, v], i) => ({ seriesIndex: 0, dataIndex: i, series: data.ys[y], label: data.xs[x], value: show(v) }));
    case "calendar":
      return data.days.map((d, i) => ({ seriesIndex: 0, dataIndex: i, series: "", label: d.day, value: show(d.value) }));
  }
}

// ── The ECharts option ─────────────────────────────────────────────────

export const VIZ_PALETTE = ["#7c5cff", "#0e9fb5", "#d9467e", "#b58900", "#1f9d6a", "#d4691c", "#3b82f6", "#8b5cf6", "#dc2626", "#0d9488", "#6b7280", "#a16207"];

export interface OptionContext {
  dir: Dir;
  /** Text the chart's aria description starts with (title and kind, already translated). */
  description: string;
  labels: ChartLabels;
  /** Calendar: month names of the axis (default: the ISO month). */
  monthLabel?: (day: string) => string;
  /** Calendar: weekday names, Sunday first. */
  weekdayNames?: readonly string[];
}

/** The ECharts 6 option for a chart. Labels are isolated, and RTL mirrors the axes and the legend. */
export function chartOption(data: ChartData, ctx: OptionContext): Record<string, unknown> {
  const rtl = ctx.dir === "rtl";
  const side = rtl ? "right" : "left";
  const other = rtl ? "left" : "right";
  const base: Record<string, unknown> = {
    color: VIZ_PALETTE,
    animation: false,
    aria: { enabled: true, decal: { show: true }, label: { enabled: true, description: ctx.description } },
    textStyle: { fontFamily: "inherit" },
    tooltip: { trigger: data.kind === "bar" || data.kind === "line" ? "axis" : "item", confine: true, extraCssText: rtl ? "direction: rtl; text-align: right;" : "" },
  };
  const legend = (names: string[]) => (names.length > 1 || (names.length === 1 && names[0] !== "") ? { legend: { type: "scroll", top: 4, [side]: 8, data: names.map(isolate) } } : {});
  const grid = { grid: { top: 36, bottom: 32, left: 16, right: 16, containLabel: true } };
  switch (data.kind) {
    case "bar":
    case "line":
      return {
        ...base,
        ...legend(data.series.map((s) => s.name)),
        ...grid,
        xAxis: { type: "category", inverse: rtl, name: isolate(ctx.labels.x), nameLocation: "middle", nameGap: 26, data: data.categories.map(isolate) },
        yAxis: { type: "value", position: side, name: isolate(ctx.labels.y) },
        series: data.series.map((s) => ({ type: data.kind, name: isolate(s.name || ctx.labels.y), data: s.values, ...(data.kind === "line" ? { connectNulls: false, showSymbol: true } : {}) })),
      };
    case "pie":
      return {
        ...base,
        legend: { type: "scroll", orient: "vertical", top: 4, [side]: 8, data: data.categories.map(isolate) },
        series: [
          {
            type: "pie",
            name: isolate(ctx.labels.y),
            radius: ["0%", "68%"],
            center: [rtl ? "40%" : "60%", "55%"],
            label: { formatter: "{b}" },
            data: data.categories.map((c, i) => ({ name: isolate(c), value: data.series[0]?.values[i] ?? null })).filter((d) => d.value !== null),
          },
        ],
      };
    case "scatter":
      return {
        ...base,
        ...legend(data.series.map((s) => s.name)),
        ...grid,
        xAxis: { type: "value", inverse: rtl, name: isolate(ctx.labels.x), nameLocation: "middle", nameGap: 26, scale: true },
        yAxis: { type: "value", position: side, name: isolate(ctx.labels.y), scale: true },
        series: data.series.map((s) => ({ type: "scatter", name: isolate(s.name || ctx.labels.y), data: s.points.map((p) => ({ name: isolate(p.label), value: [p.x, p.y] })) })),
      };
    case "heatmap":
      return {
        ...base,
        ...grid,
        xAxis: { type: "category", inverse: rtl, data: data.xs.map(isolate), splitArea: { show: true } },
        yAxis: { type: "category", position: side, data: data.ys.map(isolate), splitArea: { show: true } },
        visualMap: { min: data.min, max: data.max, calculable: true, orient: "vertical", [other]: 4, bottom: 32 },
        series: [{ type: "heatmap", name: isolate(ctx.labels.y), data: data.cells, label: { show: data.xs.length * data.ys.length <= 120 } }],
      };
    case "calendar": {
      const weeks = calendarWeeks(data);
      const month = ctx.monthLabel ?? ((d: string) => d.slice(0, 7));
      const names = ctx.weekdayNames ?? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return {
        ...base,
        ...grid,
        xAxis: {
          type: "category",
          inverse: rtl,
          data: weeks,
          splitLine: { show: false },
          axisTick: { show: false },
          // A month's name over the week its first day falls in.
          axisLabel: { interval: 0, formatter: (w: string) => (weekHasFirst(w) ? isolate(month(firstOfMonthIn(w))) : "") },
        },
        yAxis: { type: "category", position: side, inverse: true, data: Array.from({ length: 7 }, (_, i) => isolate(names[(i + data.firstDay) % 7])) },
        visualMap: { min: data.min, max: data.max, calculable: true, orient: "horizontal", [other]: 8, top: 0 },
        series: [{ type: "heatmap", name: isolate(ctx.labels.y), data: data.days.map((d) => [...calendarCell(data, d.day), d.value]) }],
      };
    }
  }
}

function weekHasFirst(weekStart: string): boolean {
  const s = dayNum(weekStart);
  for (let i = 0; i < 7; i++) if (dayOf(s + i).endsWith("-01")) return true;
  return false;
}
function firstOfMonthIn(weekStart: string): string {
  const s = dayNum(weekStart);
  for (let i = 0; i < 7; i++) if (dayOf(s + i).endsWith("-01")) return dayOf(s + i);
  return weekStart;
}

/**
 * The numbers an option draws, read back out of it — the test of "the table
 * holds exactly the chart's data" compares these with `chartTable`.
 */
export function optionNumbers(option: Record<string, unknown>): number[] {
  const out: number[] = [];
  const series = (option.series as Array<{ type: string; data: unknown[] }>) ?? [];
  for (const s of series)
    for (const d of s.data) {
      if (typeof d === "number") out.push(d);
      // A heatmap cell is [x, y, value]: the value is the number drawn.
      else if (Array.isArray(d)) out.push(d[d.length - 1] as number);
      else if (d && typeof d === "object" && "value" in d) {
        const v = (d as { value: unknown }).value;
        if (Array.isArray(v)) out.push(...(v as number[]));
        else if (typeof v === "number") out.push(v);
      }
    }
  return out;
}
