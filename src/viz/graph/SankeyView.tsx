/**
 * A Sankey of relations (plans W12.V2, R12.8): ./flows.ts drawn by ECharts
 * in the frame of ../VizFrame.tsx. The alternative is a table of the bands
 * with a button on each that opens its claims; on the picture, the arrow
 * keys walk the bands and Enter opens one. Flows (the money-map rules)
 * carry the banner "documented in the notes only", amounts as written, and
 * a year control; the undated flows are always shown, as their own group.
 */

import { lazy, useMemo, useRef, useState } from "react";
import type { ECharts } from "echarts";
import { t } from "../../i18n";
import { VizFrame } from "../VizFrame";
import type { Dir } from "../bidi";
import { flowSankey, sankeyOption, type FlowInput, type SankeyData } from "../../views/graph/flows";

const EChart = lazy(() => import("../../plugins/EChart").then((m) => ({ default: m.EChart })));

interface Props {
  title: string;
  dir: Dir;
  locale?: string;
  /** Counted bands, or the flows to draw by the money-map rules. */
  data?: SankeyData;
  flows?: readonly FlowInput[];
  onBand?: (ids: readonly string[]) => void;
  height?: number;
  initial?: "picture" | "alternative";
}

export default function SankeyView({ title, dir, locale = "he", data: counted, flows, onBand, height = 420, initial }: Props) {
  const years = useMemo(() => [...new Set((flows ?? []).filter((f) => f.day).map((f) => Number(f.day!.slice(0, 4))))].sort((a, b) => a - b), [flows]);
  const [year, setYear] = useState<number | undefined>(undefined);
  const data = useMemo(() => counted ?? flowSankey(flows ?? [], { year }), [counted, flows, year]);
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const flowsMode = data.kind === "flows";
  const noAmount = t("viz.sankey.noAmount");
  const undated = t("viz.sankey.undated");
  const option = useMemo(() => sankeyOption(data, dir, { description: t("viz.summary", { kind: `${t("viz.kind.sankey")} — ${title}`, count: data.bands.length }), noAmount, undated }), [data, dir, title, noAmount, undated]);
  const chart = useRef<ECharts | null>(null);
  const arrow = dir === "rtl" ? "←" : "→";
  const points = data.bands.map((b) => ({ label: `${b.from} ${arrow} ${b.to}`, value: flowsMode ? `${b.amount ?? noAmount}${b.day ? ` · ${b.day}` : ` · ${undated}`}` : nf.format(b.value) }));

  return (
    <div className="lumen-viz-sankey">
      {flowsMode && (
        <p className="lumen-viz-note" role="note">
          {t("viz.sankey.banner")}
        </p>
      )}
      {flowsMode && years.length > 0 && (
        <label className="lumen-viz-note">
          {t("viz.sankey.year")}{" "}
          <select value={year ?? ""} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : undefined)} data-sankey-year="">
            <option value="">{t("viz.sankey.allYears")}</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      )}
      <VizFrame
        title={title}
        summary={t("viz.summary", { kind: t("viz.kind.sankey"), count: data.bands.length })}
        notes={flowsMode && data.undated ? [t("viz.sankey.undatedCount", { count: data.undated })] : []}
        dir={dir}
        kind="sankey"
        initial={initial}
        points={points}
        onPoint={(i) => {
          const c = chart.current;
          if (!c) return;
          if (i === null) c.dispatchAction({ type: "hideTip" });
          else c.dispatchAction({ type: "showTip", seriesIndex: 0, dataType: "edge", dataIndex: i });
        }}
        onActivate={(i) => onBand?.(data.bands[i].ids)}
        picture={<EChart option={option} height={height} onReady={(c) => (chart.current = c)} />}
        alternative={(id, hidden) => (
          <div className="lumen-viz-table-wrap" id={id} hidden={hidden}>
            <table className="lumen-viz-table" data-viz-table="">
              <caption>{t("viz.tableCaption", { title })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("viz.sankey.from")}</th>
                  <th scope="col">{t("viz.sankey.to")}</th>
                  <th scope="col">{flowsMode ? t("viz.sankey.amount") : t("viz.count")}</th>
                  {flowsMode && <th scope="col">{t("viz.date")}</th>}
                  {onBand && <th scope="col">{t("viz.sankey.claims")}</th>}
                </tr>
              </thead>
              <tbody>
                {data.bands.map((b, i) => (
                  <tr key={`${b.ids[0]}-${i}`} data-band={i}>
                    <th scope="row" dir="auto">
                      {b.from}
                    </th>
                    <td dir="auto">{b.to}</td>
                    <td data-value={flowsMode ? undefined : b.value}>
                      <bdi>{flowsMode ? (b.amount ?? noAmount) : nf.format(b.value)}</bdi>
                    </td>
                    {flowsMode && <td>{b.day ?? undated}</td>}
                    {onBand && (
                      <td>
                        <button type="button" onClick={() => onBand(b.ids)} data-band-open={i}>
                          {t("viz.sankey.open", { count: b.ids.length })}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      />
    </div>
  );
}
