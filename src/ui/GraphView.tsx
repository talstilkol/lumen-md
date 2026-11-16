/**
 * The knowledge graph (plan W1.10): every note of the vault, sized for
 * 10,000 notes and 50,000 links. The graph comes from the vault index, the
 * layout runs in a worker and draws as it settles, nodes and links are drawn
 * with WebGL (./graph/GraphCanvas.tsx). Filters by tag, folder or property,
 * colour groups by folder or tag; the keyboard reaches every note.
 */

import { useEffect, useMemo, useState } from "react";
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
import "./graph/graphExportStrings";
import { GraphExportMenu } from "./graph/GraphExportMenu";
import type { Scene } from "../graph/exportImage";

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
  const style = useMemo(() => (graph && sub ? nodeStyle(graph, sub.nodes, groupBy === "none" ? null : groups!.group) : null), [graph, sub, groups, groupBy]);
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

  // W13.G12: the note graph as it is now, for "Export view" (laid out first when it is shown as a table).
  const exportScene = async (): Promise<Scene> => {
    if (!graph || !sub || !style) return { title: t("graphExport.title.notes"), nodes: [], edges: [] };
    const at = positions && positions.length === sub.nodes.length * 2 ? positions : await runLayout(sub.nodes.length, sub.edges);
    const nodes = Array.from(sub.nodes, (g: number, k: number) => ({
      id: graph.paths[g],
      label: graph.labels[g],
      x: at[2 * k],
      y: at[2 * k + 1],
      color: [style.colors[4 * k], style.colors[4 * k + 1], style.colors[4 * k + 2], style.colors[4 * k + 3]] as const,
      size: style.sizes[k] || 4,
      attrs: { path: graph.paths[g] },
    }));
    const edges: Scene["edges"][number][] = [];
    for (let e = 0; e < sub.edges.length; e += 2) edges.push({ source: nodes[sub.edges[e]].id, target: nodes[sub.edges[e + 1]].id });
    return { title: t("graphExport.title.notes"), description: t("graphView.stats", { nodes: String(sub.nodes.length), edges: String(sub.edges.length / 2) }), lang: document.documentElement.lang || undefined, nodes, edges, background: [1, 1, 1, 1] };
  };

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
        <button type="button" className="icon-btn" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} data-testid="graph-as-table" style={{ inlineSize: "auto", paddingInline: 8, fontSize: 12 }}>
          {t("graph.table.toggle")}
        </button>
        <GraphExportMenu scene={exportScene} testId="graph-export-view" style={{ ...field, inlineSize: "auto" }} />
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
          />
        )}
      </div>
    </div>
  );
}
