/**
 * The knowledge graph (plan W1.10): every note of the vault, sized for
 * 10,000 notes and 50,000 links. The graph comes from the vault index, the
 * layout runs in a worker and draws as it settles, nodes and links are drawn
 * with WebGL (./graph/GraphCanvas.tsx). Filters by tag, folder or property,
 * colour groups by folder or tag; the keyboard reaches every note.
 *
 * W13.G1: the engine follows the size — the standard engine below 20,000
 * nodes, the GPU layout (a lazy chunk) above, the table where a big graph
 * meets a browser without WebGL 2. The toolbar can force one.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { filteredGraph, graphTimeDomain, groupsOf, type GraphDateField, type GraphFilter, type GroupBy } from "../graph/graphModel";
import { chooseEngine, layoutWithEngine, probeCaps, type GraphEngineKind, type GraphEnginePref } from "../graph/engine";
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
import "./graph/graphAltStrings";
import { GraphSummary } from "./graph/GraphSummary";
import type { AltGraph } from "../graph/textAlt";

// W13.G8: clusters and structural gaps, loaded when asked for.
const ClusterGapsPanel = lazy(() => import("./graph/ClusterGapsPanel"));

// W13.G11: the note graph as a list you walk, loaded when asked for.
const GraphListView = lazy(() => import("./graph/GraphListView").then((m) => ({ default: m.GraphListView })));

const ENGINE_KEY = "lumen.graph.engine";
const ENGINES: readonly GraphEnginePref[] = ["auto", "gpu", "standard", "list"];
function readEnginePref(): GraphEnginePref {
  try {
    const v = localStorage.getItem(ENGINE_KEY) as GraphEnginePref | null;
    return v && ENGINES.includes(v) ? v : "auto";
  } catch {
    // why: no storage (private window): the automatic choice
    return "auto";
  }
}

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
  const [asList, setAsList] = useState(false);
  // The ready marker (plan W7.25): the layout of the graph on screen has finished (or failed).
  const [laidOut, setLaidOut] = useState<object | null>(null);

  const sub = useMemo(() => (graph ? filteredGraph(graph, timed) : null), [graph, timed]);
  // W13.G1: which engine draws this subgraph.
  const [enginePref, setEnginePref] = useState<GraphEnginePref>(readEnginePref);
  const caps = useMemo(() => probeCaps(), []);
  const choice = useMemo(() => chooseEngine(sub?.nodes.length ?? 0, caps, enginePref, (sub?.edges.length ?? 0) / 2), [sub, caps, enginePref]);
  const [ran, setRan] = useState<GraphEngineKind | null>(null);
  const engineKind = choice.kind;
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

  // W13.G11: the same nodes and links for the summary sentence and the list.
  const alt: AltGraph | null = useMemo(() => {
    if (!graph || !sub) return null;
    const nodes = Array.from(sub.nodes, (i: number) => ({ id: graph.paths[i], label: graph.labels[i] }));
    const edges: AltGraph["edges"][number][] = [];
    for (let e = 0; e < sub.edges.length; e += 2) edges.push({ source: nodes[sub.edges[e]].id, target: nodes[sub.edges[e + 1]].id });
    return { nodes, edges };
  }, [graph, sub]);

  // Lay out in the worker; draw every few steps while it settles.
  useEffect(() => {
    if (!sub) return;
    setPositions(null);
    if (engineKind === "list") {
      // No drawing engine for this size here: the table is the view, nothing to lay out.
      setRan("list");
      setLaying(false);
      setLaidOut(sub);
      return;
    }
    let cancelled = false;
    const abort = new AbortController();
    setLaying(true);
    layoutWithEngine(engineKind, sub.nodes.length, sub.edges, (p) => !cancelled && setPositions(p), { signal: abort.signal })
      .then((r) => {
        if (cancelled) return;
        setPositions(r.positions);
        setRan(r.ran);
      })
      .catch((e: unknown) => !cancelled && log.warn("graph: layout failed", e))
      .finally(() => {
        if (cancelled) return;
        setLaying(false);
        setLaidOut(sub);
      });
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [sub, engineKind]);

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

  const openPath = async (path: string) => {
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

  const pickEngine = (v: GraphEnginePref) => {
    setEnginePref(v);
    try {
      localStorage.setItem(ENGINE_KEY, v);
    } catch {
      // why: no storage: the choice lasts for this view only
    }
  };
  const tableView = asTable || engineKind === "list";
  const set = (k: keyof GraphFilter) => (e: { target: { value: string } }) => setFilter((f) => ({ ...f, [k]: e.target.value.trim() || undefined }));
  return (
    <div style={{ inlineSize: "100%", blockSize: "100%", position: "relative", display: "flex", flexDirection: "column" }} data-testid="graph-view" data-ready={String(sub !== null && laidOut === sub)} data-engine={ran ?? engineKind}>
      <div role="toolbar" aria-label={t("graph.filters")} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "6px 12px", borderBlockEnd: "1px solid hsl(var(--border))", fontSize: 12 }}>
        <span data-testid="graph-stats" style={{ color: "hsl(var(--fg-muted))" }}>
          {t("graphView.stats", { nodes: String(sub?.nodes.length ?? 0), edges: String((sub?.edges.length ?? 0) / 2) })}
          {` · ${t(`graph.engine.${ran ?? engineKind}`)}`}
          {laying && ` · ${t("graph.layingOut")}`}
        </span>
        <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          {t("graph.engine")}
          <select value={enginePref} onChange={(e) => pickEngine(e.target.value as GraphEnginePref)} style={{ ...field, inlineSize: "auto" }} data-testid="graph-engine">
            <option value="auto">{t("graph.engine.auto")}</option>
            <option value="gpu">{t("graph.engine.gpu")}</option>
            <option value="standard">{t("graph.engine.standard")}</option>
            <option value="list">{t("graph.engine.list")}</option>
          </select>
        </label>
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
        <button type="button" className="icon-btn" aria-pressed={tableView} disabled={engineKind === "list"} onClick={() => (setAsTable((v) => !v), setAsList(false))} data-testid="graph-as-table" style={{ inlineSize: "auto", paddingInline: 8, fontSize: 12 }}>
          {t("graph.table.toggle")}
        </button>
        <button type="button" className="icon-btn" aria-pressed={asList} onClick={() => (setAsList((v) => !v), setAsTable(false))} data-testid="graph-as-list" style={{ inlineSize: "auto", paddingInline: 8, fontSize: 12 }}>
          {t("graphAlt.mode.list")}
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
        {alt && <GraphSummary graph={alt} />}
      </div>
      <div style={{ flex: 1, minBlockSize: 0, position: "relative", overflow: asList ? "auto" : undefined }}>
        {sub && engineKind === "list" && choice.reason !== "pref" && (
          <p role="status" data-testid="graph-engine-note" style={{ margin: 0, padding: "6px 12px", fontSize: 12, color: "hsl(var(--fg-muted))" }}>
            {t("graph.engine.noGpu", { nodes: String(sub.nodes.length) })}
          </p>
        )}
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
        {alt && asList && (
          <Suspense fallback={null}>
            <GraphListView graph={alt} relationLabel={(_, d) => t(d === "out" ? "graphAlt.list.linksTo" : "graphAlt.list.linkedFrom")} onOpen={(path) => void openPath(path)} />
          </Suspense>
        )}
        {sub && tableView && !asList && <GraphTable labels={labels} neighbors={(i) => adjacency[i] ?? []} onOpen={(k) => void open(k)} />}
        {sub && style && !tableView && !asList && (
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
