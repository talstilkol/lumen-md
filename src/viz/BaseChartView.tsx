/**
 * The `chart` view of a `.base` (plan W12.V1): the view's rows, as Bases
 * computed them (filters, formulas, relations, rollups), drawn by
 * ./ChartFigure.tsx. Loaded by BasesBlock with a dynamic import only.
 */

import { useMemo } from "react";
import { propertyLabel, type BaseModel, type BaseResult } from "../views/bases/base";
import { isTagged, toText, type BValue } from "../views/bases/values";
import { t } from "../i18n";
import ChartFigure from "./ChartFigure";
import { VIZ_AGGS, type ChartSpec, type VizAgg, type VizCell, type VizChartKind, type VizRow } from "./chartModel";
import type { Dir } from "./bidi";

/** A Bases value as a chart cell: links by their name, files by theirs, the rest as text. */
export function vizCell(v: BValue): VizCell {
  if (v === null || typeof v === "boolean" || typeof v === "number" || typeof v === "string" || v instanceof Date) return v;
  if (Array.isArray(v)) return v.map(vizCell);
  if (isTagged(v)) {
    if (v.$ === "link") return v.display ?? v.path.split("/").pop()!.replace(/\.md$/i, "");
    if (v.$ === "file") return v.file.basename;
  }
  return toText(v);
}

/** The rows of a Bases result as chart rows, with `file.name` for the point names. */
export function baseVizRows(result: BaseResult): VizRow[] {
  return result.rows.map((r) => {
    const row: VizRow = { "file.name": r.file.basename };
    for (const [id, v] of Object.entries(r.cells)) row[id] = vizCell(v);
    return row;
  });
}

export function baseChartSpec(result: BaseResult): ChartSpec {
  const c = result.view.chart ?? { kind: "bar" };
  const agg = (VIZ_AGGS as readonly string[]).includes(c.aggregate ?? "") ? (c.aggregate as VizAgg) : undefined;
  return { kind: c.kind as VizChartKind, x: c.x ?? "file.folder", y: c.y, series: c.series, agg };
}

export default function BaseChartView({ base, result, dir, locale }: { base: BaseModel; result: BaseResult; dir: Dir; locale?: string }) {
  const rows = useMemo(() => baseVizRows(result), [result]);
  const spec = useMemo(() => baseChartSpec(result), [result]);
  const labels = useMemo(
    () => ({
      x: propertyLabel(base, spec.x),
      y: spec.y ? propertyLabel(base, spec.y) : t("viz.count"),
      series: spec.series ? propertyLabel(base, spec.series) : undefined,
      label: t("viz.point.name"),
      day: t("viz.date"),
    }),
    [base, spec],
  );
  return <ChartFigure rows={rows} spec={spec} title={result.view.name} labels={labels} dir={dir} locale={locale} />;
}
