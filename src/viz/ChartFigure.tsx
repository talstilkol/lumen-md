/**
 * A chart from rows (plan W12.V1): the six kinds of ./chartModel.ts drawn
 * with ECharts 6 (already a dependency, Apache-2.0, bundled — nothing from a
 * CDN), in the frame of ./VizFrame.tsx with its data table and keyboard.
 *
 * ECharts loads with the chart only (`lazy`); the table needs none of it, so
 * a chart that can't be drawn still shows its numbers.
 */

import { lazy, useCallback, useMemo, useRef } from "react";
import type { ECharts } from "echarts";
import { t } from "../i18n";
import { chartData, chartOption, chartPoints, chartTable, VIZ_CHART_KINDS, type ChartData, type ChartLabels, type ChartSpec, type VizRow } from "./chartModel";
import { DataTable } from "./DataTable";
import { VizFrame } from "./VizFrame";
import type { Dir } from "./bidi";

const EChart = lazy(() => import("../plugins/EChart").then((m) => ({ default: m.EChart })));

export interface ChartFigureProps {
  rows: readonly VizRow[];
  spec: ChartSpec;
  title: string;
  labels: ChartLabels;
  dir: Dir;
  locale?: string;
  height?: number;
  isDark?: boolean;
  initial?: "picture" | "alternative";
  /** Numbers already computed (W12.V5's Hebrew-month heatmap): drawn as they are, `rows` ignored. */
  data?: ChartData;
}

export function monthName(locale: string) {
  const f = new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" });
  return (day: string) => f.format(new Date(`${day}T00:00:00Z`));
}

export function weekdayNames(locale: string): string[] {
  const f = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2023, 0, 1 + i))));
}

export default function ChartFigure({ rows, spec, title, labels, dir, locale = "he", height = 320, isDark, initial, data: given }: ChartFigureProps) {
  const known = (VIZ_CHART_KINDS as readonly string[]).includes(spec.kind);
  const { data, skipped, truncated } = useMemo(
    () => (given ? { data: given, skipped: 0, truncated: 0 } : chartData(rows, known ? spec : { ...spec, kind: "bar" }, locale)),
    [given, rows, spec, known, locale],
  );
  const kindName = t(`viz.kind.${data.kind}`);
  const points = useMemo(() => chartPoints(data), [data]);
  const option = useMemo(
    () =>
      chartOption(data, {
        dir,
        labels,
        description: t("viz.summary", { kind: `${kindName} — ${title}`, count: points.length }),
        monthLabel: monthName(locale),
        weekdayNames: weekdayNames(locale),
      }),
    [data, dir, labels, kindName, title, points.length, locale],
  );
  const table = useMemo(() => chartTable(data, labels), [data, labels]);
  const chartRef = useRef<ECharts | null>(null);
  const last = useRef<{ seriesIndex: number; dataIndex: number } | null>(null);

  const onPoint = useCallback(
    (i: number | null) => {
      const c = chartRef.current;
      if (!c) return;
      if (last.current) c.dispatchAction({ type: "downplay", ...last.current });
      if (i === null) {
        c.dispatchAction({ type: "hideTip" });
        last.current = null;
        return;
      }
      const p = points[i];
      last.current = { seriesIndex: p.seriesIndex, dataIndex: p.dataIndex };
      c.dispatchAction({ type: "highlight", ...last.current });
      c.dispatchAction({ type: "showTip", ...last.current });
    },
    [points],
  );

  const notes: string[] = [];
  if (!known) notes.push(t("viz.unknownKind", { kind: spec.kind, kinds: VIZ_CHART_KINDS.join(", ") }));
  if (skipped) notes.push(t("viz.skipped", { count: skipped }));
  if (truncated) notes.push(t("viz.truncated", { count: truncated }));
  if (!points.length) notes.push(t("viz.empty", { field: labels.x }));

  return (
    <VizFrame
      title={title}
      summary={t("viz.summary", { kind: kindName, count: points.length })}
      dir={dir}
      kind={data.kind}
      notes={notes}
      initial={initial}
      points={points.map((p) => ({ series: p.series || undefined, label: p.label, value: p.value }))}
      onPoint={onPoint}
      picture={<EChart option={option} height={height} isDark={isDark} onReady={(c) => (chartRef.current = c)} />}
      alternative={(id, hidden) => <DataTable id={id} hidden={hidden} table={table} caption={t("viz.tableCaption", { title })} locale={locale} />}
    />
  );
}
