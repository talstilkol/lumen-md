/**
 * A tree or sunburst (plan W12.V3) in the frame of ./VizFrame.tsx; its
 * alternative is an ARIA tree (./AriaTree.tsx) over the same nodes, and the
 * arrow keys on the picture walk the nodes depth first.
 */

import { lazy, useCallback, useMemo, useRef } from "react";
import type { ECharts } from "echarts";
import { t } from "../i18n";
import { VizFrame } from "./VizFrame";
import { AriaTree } from "./AriaTree";
import { flatten, treeOption, type TreeChartKind, type VizTreeNode } from "./treeModel";
import type { Dir } from "./bidi";

const EChart = lazy(() => import("../plugins/EChart").then((m) => ({ default: m.EChart })));

interface Props {
  root: VizTreeNode;
  kind: TreeChartKind;
  title: string;
  dir: Dir;
  locale?: string;
  onActivate?: (n: VizTreeNode) => void;
  height?: number;
  initial?: "picture" | "alternative";
}

export default function TreeFigure({ root, kind, title, dir, locale = "he", onActivate, height = 420, initial }: Props) {
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const flat = useMemo(() => flatten(root), [root]);
  const kindName = t(`viz.kind.${kind}`);
  const option = useMemo(() => treeOption(root, kind, dir, t("viz.summary", { kind: `${kindName} — ${title}`, count: flat.length })), [root, kind, dir, kindName, title, flat.length]);
  const chartRef = useRef<ECharts | null>(null);
  const onPoint = useCallback((i: number | null) => {
    const c = chartRef.current;
    if (!c) return;
    if (i === null) c.dispatchAction({ type: "hideTip" });
    else c.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: i });
  }, []);
  return (
    <VizFrame
      title={title}
      summary={t("viz.summary", { kind: kindName, count: flat.length })}
      dir={dir}
      kind={kind}
      initial={initial}
      points={flat.map((f) => ({ label: f.node.name, value: nf.format(f.node.value) }))}
      onPoint={onPoint}
      showAlternativeLabel={t("viz.showTree")}
      picture={<EChart option={option} height={height} onReady={(c) => (chartRef.current = c)} />}
      alternative={(id, hidden) => <AriaTree id={id} hidden={hidden} root={root} dir={dir} label={t("viz.treeLabel", { title })} valueText={(n) => `(${nf.format(n.value)})`} onActivate={onActivate} />}
    />
  );
}
