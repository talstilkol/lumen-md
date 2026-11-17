/**
 * A ```query or ```dataview block drawn as a chart (plan W12.V1): `chart:`
 * names the kind, `chart-x:` / `chart-y:` / `chart-series:` the columns.
 * Query rows offer `name`, `folder`, `tags`, `modified` (a day) and `path`;
 * a Dataview TABLE offers its own headers. Loaded by QueryBlock with a
 * dynamic import only.
 */

import { useMemo } from "react";
import { DateValue, show, type DvResult, type Value } from "../search/dataview";
import type { QueryChart, QueryRow } from "../search/embeddedQuery";
import { t } from "../i18n";
import ChartFigure from "./ChartFigure";
import { VIZ_AGGS, type ChartSpec, type VizAgg, type VizCell, type VizChartKind, type VizRow } from "./chartModel";
import type { Dir } from "./bidi";

export function queryVizRows(rows: readonly QueryRow[]): VizRow[] {
  return rows.map((r) => ({
    "file.name": r.name,
    name: r.name,
    path: r.path,
    folder: r.folder || "/",
    tags: r.tags,
    modified: r.modified ? new Date(r.modified) : null,
  }));
}

function dvCell(v: Value): VizCell {
  if (v === null || typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  if (v instanceof DateValue) return new Date(v.ms);
  if (Array.isArray(v)) return v.map(dvCell);
  return show(v);
}

export function dataviewVizRows(result: DvResult): VizRow[] {
  const withId = result.rows.length > 0 && result.headers.length > result.rows[0].cells.length;
  const headers = withId ? result.headers.slice(1) : result.headers;
  return result.rows.map((r) => {
    const row: VizRow = { "file.name": r.name, name: r.name, path: r.path };
    headers.forEach((h, i) => (row[h] = dvCell(r.cells[i] ?? null)));
    return row;
  });
}

export function queryChartSpec(c: QueryChart, fallbackX: string): ChartSpec {
  const agg = (VIZ_AGGS as readonly string[]).includes((c.aggregate ?? "").toLowerCase()) ? (c.aggregate!.toLowerCase() as VizAgg) : undefined;
  return { kind: c.kind as VizChartKind, x: c.x ?? fallbackX, y: c.y, series: c.series, agg };
}

interface Props {
  chart: QueryChart;
  title: string;
  dir: Dir;
  locale?: string;
  rows?: readonly QueryRow[];
  dataview?: DvResult;
}

export default function QueryChartView({ chart, title, dir, locale, rows, dataview }: Props) {
  const vizRows = useMemo(() => (dataview ? dataviewVizRows(dataview) : queryVizRows(rows ?? [])), [rows, dataview]);
  const firstHeader = dataview ? (dataview.headers.length > (dataview.rows[0]?.cells.length ?? 0) ? dataview.headers[1] : dataview.headers[0]) : undefined;
  const spec = useMemo(() => queryChartSpec(chart, firstHeader ?? (chart.kind === "calendar" ? "modified" : "folder")), [chart, firstHeader]);
  const labels = useMemo(() => ({ x: spec.x, y: spec.y ?? t("viz.count"), series: spec.series, label: t("viz.point.name"), day: t("viz.date") }), [spec]);
  return <ChartFigure rows={vizRows} spec={spec} title={title} labels={labels} dir={dir} locale={locale} />;
}
