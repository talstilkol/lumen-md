/**
 * The knowledge graph (plan W1.10): every note of the vault, sized for
 * 10,000 notes and 50,000 links. The graph comes from the vault index, the
 * layout runs in a worker and draws as it settles, nodes and links are drawn
 * with WebGL (./graph/GraphCanvas.tsx). Filters by tag, folder or property,
 * colour groups by folder or tag; the keyboard reaches every note.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { filteredGraph, graphTimeDomain, groupsOf, type GraphDateField, type GraphFilter, type GroupBy } from "../graph/graphModel";
import { runLayout } from "../graph/layoutClient";
import { readWorkspaceFile } from "../storage/workspace";
import { log } from "../lib/logger";
import { t } from "../i18n";
import { GraphCanvas } from "./graph/GraphCanvas";
import { GraphTable } from "./graph/GraphTable";
import { TimeSlider, untilOf } from "./graph/TimeSlider";
import { EmptyState, runCommand } from "./EmptyState";
import { groupColor, nodeStyle, resolveColor, useVaultGraph } from "./graph/graphData";
import "./graphViewStrings";
import "./graph/clusterGapsStrings";
import type { ClusterAnalysis } from "../graph/clusterGaps";
import { convexHull } from "../graph/hull";

// W13.G8: clusters and structural gaps, loaded when asked for.
const ClusterGapsPanel = lazy(() => import("./graph/ClusterGapsPanel"));

const field = { fontSize: 12, paddingInline: 6, paddingBlock: 3, borderRadius: 4, border: "1px solid hsl(var(--border))", background: "hsl(var(--bg))", color: "hsl(var(--fg))", inlineSize: 120 } as const;

export function GraphView({ onOpenFile, initialTable = false }: { onOpenFile: (path: string, content: string) => void; initialTable?: boolean }) {
  const { graph } = useVaultGraph();
  const [filter, setFilter] = useState<GraphFilter>({});
  // W12.V8: the entity graph's time slider (W12.E7) over the notes' created or modified day.
  const [dateField, setDateField] = useState<GraphDateField>("modified");
  const domain = useMemo(() => (graph ? graphTimeDomain(graph, dateField) : []), [graph, dateField]);
  const [until, setUntil] = useState(Number.MAX_SAFE_INTEGER);
  const at = Math.min(until, Math.max(0, domain.length - 1));
  const timed: GraphFilter = useMemo(() => ({ ...filter, dateField, until: untilOf(domain, at) }), [filter, dateField, domain, at]);
  const [groupBy, setGroupBy] = useState<GroupBy>("folder");
  const [positions, setPositions] = useState<Float32Array | null>(null);
  const [laying, setLaying] = useState(false);
  // The text alternative (W10.E60): the same nodes and links as a table.
  const [asTable, setAsTable] = useState(initialTable);
  // The ready marker (plan W7.25): the layout of the graph on screen has finished (or failed).
  const [laidOut, setLaidOut] = useState<object | null>(null);

  const sub = useMemo(() => (graph ? filteredGraph(graph, timed) : null), [graph, timed]);
  const groups = useMemo(() => (graph ? groupsOf(graph, groupBy) : null), [graph, groupBy]);
  // W13.G8: with an analysis on screen, nodes take their cluster's colour (grey outside every cluster) and clusters get hulls.
  const [gapsOpen, setGapsOpen] = useState(false);
  const [analysis, setAnalysis] = useState<ClusterAnalysis | null>(null);
  const baseStyle = useMemo(() => (graph && sub ? nodeStyle(graph, sub.nodes, groupBy === "none" ? null : groups!.group) : null), [graph, sub, groups, groupBy]);
  const style = useMemo(() => {
    if (!baseStyle || !analysis || !graph || !sub) return baseStyle;
    const colors = new Float32Array(baseStyle.colors);
    const grey = resolveColor("hsl(var(--fg-muted))", 0.6);
    const palette = new Map<number, [number, number, number, number]>();
    Array.from(sub.nodes, (i: number, k: number) => {
      const c = analysis.clusterOf.get(graph.paths[i]) ?? -1;
      if (c >= 0 && !palette.has(c)) palette.set(c, resolveColor(groupColor(c)));
      colors.set(c >= 0 ? palette.get(c)! : grey, 4 * k);
    });
    return { colors, sizes: baseStyle.sizes };
  }, [baseStyle, analysis, graph, sub]);
  const labels = useMemo(() => (graph && sub ? Array.from(sub.nodes, (i: number) => graph.labels[i]) : []), [graph, sub]);
  const adjacency = useMemo(() => {
    if (!sub) return [] as number[][];
    const adj: number[][] = Array.from({ length: sub.nodes.length }, () => []);
    for (let e = 0; e < sub.edges.length; e += 2) {
      adj[sub.edges[e]].push(sub.edges[e + 1]);
      adj[sub.edges[e + 1]].push(sub.edges[e]);
    }
    return adj;
  }, [sub]);

  // W13.G8: a convex hull per cluster, in its colour, under the labels.
  const underlay = useCallback(
    (ctx: CanvasRenderingContext2D, at: (x: number, y: number) => { x: number; y: number }) => {
      if (!analysis || !positions || !graph || !sub) return;
      const index = new Map(Array.from(sub.nodes, (i: number, k: number) => [graph.paths[i], k] as const));
      for (const c of analysis.clusters) {
        const pts = c.members.map((p) => index.get(p)).filter((k): k is number => k !== undefined).map((k) => at(positions[2 * k], positions[2 * k + 1]));
        if (pts.length < 3) continue;
        const hull = convexHull(pts.map((p) => [p.x, p.y] as [number, number]));
        ctx.beginPath();
        hull.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        const color = groupColor(c.index);
        ctx.fillStyle = color.replace(")", " / 0.10)");
        ctx.strokeStyle = color.replace(")", " / 0.55)");
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();
      }
    },
    [analysis, positions, graph, sub],
  );

  // Lay out in the worker; draw every few steps while it settles.
  useEffect(() => {
    if (!sub) return;
    let cancelled = false;
    setLaying(true);
    setPositions(null);
    runLayout(sub.nodes.length, sub.edges, (p) => !cancelled && setPositions(p))
      .then((p) => !cancelled && setPositions(p))
      .catch((e: unknown) => log.warn("graph: layout failed", e))
      .finally(() => {
        if (cancelled) return;
        setLaying(false);
        setLaidOut(sub);
      });
    return () => {
      cancelled = true;
    };
  }, [sub]);

  const edgeColor = useMemo(() => resolveColor("hsl(var(--fg-muted))", 0.18), []);
  const ring = useMemo(() => resolveColor("hsl(var(--fg))"), []);
  const labelColor = "hsl(var(--fg))";

  const open = async (k: number) => {
    if (!graph || !sub) return;
    const path = graph.paths[sub.nodes[k]];
    try {
      onOpenFile(path, await readWorkspaceFile(path));
    } catch (err) {
      log.warn("graph view: failed to open file", path, err);
    }
  };

  if (graph && graph.paths.length === 0) {
    return (
      <EmptyState
        style={{ blockSize: "100%", alignItems: "center", justifyContent: "center", fontSize: 13 }}
        testId="graph-empty"
        message={t("graphView.empty")}
        action={{ label: t("graphView.openWorkspace"), onClick: () => runCommand("view.workspace") }}
      />
    );
  }

  const set = (k: keyof GraphFilter) => (e: { target: { value: string } }) => setFilter((f) => ({ ...f, [k]: e.target.value.trim() || undefined }));
  return (
    <div style={{ inlineSize: "100%", blockSize: "100%", position: "relative", display: "flex", flexDirection: "column" }} data-testid="graph-view" data-ready={String(sub !== null && laidOut === sub)}>
      <div role="toolbar" aria-label={t("graph.filters")} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "6px 12px", borderBlockEnd: "1px solid hsl(var(--border))", fontSize: 12 }}>
        <span data-testid="graph-stats" style={{ color: "hsl(var(--fg-muted))" }}>
          {t("graphView.stats", { nodes: String(sub?.nodes.length ?? 0), edges: String((sub?.edges.length ?? 0) / 2) })}
          {laying && ` · ${t("graph.layingOut")}`}
        </span>
        <input dir="auto" placeholder={t("graph.filter.tag")} aria-label={t("graph.filter.tag")} onChange={set("tag")} style={field} />
        <input dir="auto" placeholder={t("graph.filter.folder")} aria-label={t("graph.filter.folder")} onChange={set("folder")} style={field} />
        <input dir="auto" placeholder={t("graph.filter.property")} aria-label={t("graph.filter.property")} onChange={set("property")} style={field} />
        <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          {t("graph.groupBy")}
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} style={{ ...field, inlineSize: "auto" }}>
            <option value="folder">{t("graph.groupBy.folder")}</option>
            <option value="tag">{t("graph.groupBy.tag")}</option>
            {/* empty-allow: a "group by: none" option */}
            <option value="none">{t("graph.groupBy.none")}</option>
          </select>
        </label>
        <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          {t("graph.time.field")}
          <select value={dateField} onChange={(e) => {
              setDateField(e.target.value as GraphDateField);
              setUntil(Number.MAX_SAFE_INTEGER);
            }} style={{ ...field, inlineSize: "auto" }} data-testid="graph-time-field">
            <option value="modified">{t("graph.time.modified")}</option>
            <option value="created">{t("graph.time.created")}</option>
          </select>
        </label>
        <TimeSlider domain={domain} value={at} onChange={setUntil} labels={{ until: t("graph.time.until"), play: t("graph.time.play"), pause: t("graph.time.pause") }} testId="graph-time" style={{ ...field, inlineSize: "auto" }} />
        <button type="button" className="icon-btn" aria-pressed={gapsOpen} onClick={() => setGapsOpen((v) => !v)} data-testid="graph-clusters" style={{ inlineSize: "auto", paddingInline: 8, fontSize: 12 }}>
          {t("graphClusters.toggle")}
        </button>
        <button type="button" className="icon-btn" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} data-testid="graph-as-table" style={{ inlineSize: "auto", paddingInline: 8, fontSize: 12 }}>
          {t("graph.table.toggle")}
        </button>
        {groups && groupBy !== "none" && (
          <ul aria-label={t("graph.groups")} style={{ display: "flex", flexWrap: "wrap", gap: 8, listStyle: "none", margin: 0, padding: 0 }}>
            {groups.names.map((name, k) => (
              <li key={name} style={{ display: "inline-flex", gap: 4, alignItems: "center" }} dir="auto">
                <span aria-hidden style={{ inlineSize: 8, blockSize: 8, borderRadius: 4, background: groupColor(k) }} />
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div style={{ flex: 1, minBlockSize: 0, position: "relative" }}>
        {gapsOpen && graph && sub && (
          <Suspense fallback={null}>
            <ClusterGapsPanel
              nodes={Array.from(sub.nodes, (i: number) => ({ id: graph.paths[i], label: graph.labels[i] }))}
              edges={Array.from({ length: sub.edges.length / 2 }, (_, e) => ({ source: graph.paths[sub.nodes[sub.edges[2 * e]]], target: graph.paths[sub.nodes[sub.edges[2 * e + 1]]] }))}
              onAnalysis={setAnalysis}
              onFocus={(path) => void readWorkspaceFile(path).then((text) => onOpenFile(path, text), (err: unknown) => log.warn("graph view: failed to open file", path, err))}
              colorOf={groupColor}
              onClose={() => setGapsOpen(false)}
            />
          </Suspense>
        )}
        {sub && asTable && <GraphTable labels={labels} neighbors={(i) => adjacency[i] ?? []} onOpen={(k) => void open(k)} />}
        {sub && style && !asTable && (
          <GraphCanvas
            labels={labels}
            edges={sub.edges}
            neighbors={(i) => adjacency[i] ?? []}
            positions={positions}
            colors={style.colors}
            sizes={style.sizes}
            edgeColor={edgeColor}
            ring={ring}
            labelColor={labelColor}
            onOpen={(k) => void open(k)}
            ariaLabel={t("graph.ariaLabel", { nodes: sub.nodes.length })}
            fitKey={`${sub.nodes.length}:${sub.edges.length}:${JSON.stringify(timed)}`}
            underlay={analysis ? underlay : undefined}
          />
        )}
      </div>
    </div>
  );
}
