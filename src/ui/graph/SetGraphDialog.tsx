/**
 * "Open as graph" (plan W13.G9): the rows of a Base view or a ```query
 * block as a graph, in a dialog — the W1.10 canvas with its keyboard, the
 * table alternative, the perspective bar (scope "base": colour and size per
 * `type:`), and, for a Base, the notes its rows link to outside it.
 * Loaded by BasesBlock and QueryBlock with a dynamic import only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../i18n";
import { baseToGraph, setDegrees, subgraphOfPaths, OUTSIDE_KIND, type RowFile, type SetGraph } from "../../graph/baseGraph";
import { rgbaToHex, styleNodes, type KindRule, type Perspective, type PerspectiveVault } from "../../graph/perspectives";
import { runLayout } from "../../graph/layoutClient";
import { Modal } from "../Modal";
import { GraphCanvas } from "./GraphCanvas";
import { GraphTable } from "./GraphTable";
import { PerspectiveBar } from "./PerspectiveBar";
import { groupColor, resolveColor } from "./graphData";
import "./perspectiveStrings";
import { compareNames } from "../../i18n/collate";

export interface SetGraphDialogProps {
  title: string;
  /** A Base view's rows. */
  rows?: readonly RowFile[];
  /** A query's result paths (the vault graph gives their links). */
  paths?: readonly string[];
  onClose: () => void;
  onOpen?: (path: string) => void;
  vault?: PerspectiveVault;
  /** Tests: the vault graph for `paths`. */
  loadGraph?: () => Promise<import("../../graph/graphModel").GraphData>;
}

const field: React.CSSProperties = { fontSize: 12, padding: "2px 6px", borderRadius: 4, border: "1px solid hsl(var(--border))", background: "hsl(var(--bg))", color: "hsl(var(--fg))" };

export function SetGraphDialog({ title, rows, paths, onClose, onOpen, vault, loadGraph }: SetGraphDialogProps) {
  const [outside, setOutside] = useState(false);
  const [queried, setQueried] = useState<SetGraph | null>(null);
  const [error, setError] = useState("");
  const [rules, setRules] = useState<Record<string, KindRule>>({});
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [asTable, setAsTable] = useState(false);
  const [positions, setPositions] = useState<Float32Array | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!paths) return;
    let off = false;
    (loadGraph ?? (async () => (await import("./graphData")).loadVaultGraph()))().then(
      (g) => !off && setQueried(subgraphOfPaths(g, paths)),
      (e: unknown) => !off && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      off = true;
    };
  }, [paths, loadGraph]);

  const all = useMemo(() => (rows ? baseToGraph(rows, { outside }) : queried), [rows, outside, queried]);
  const kinds = useMemo(() => [...new Set(all?.nodes.map((n) => n.kind) ?? [])].sort((a, b) => (a === OUTSIDE_KIND ? 1 : b === OUTSIDE_KIND ? -1 : compareNames(String(a), String(b)))), [all]);
  const graph = useMemo(() => {
    if (!all) return null;
    const nodes = all.nodes.filter((n) => !hidden.has(n.kind));
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: all.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }, [all, hidden]);
  const index = useMemo(() => new Map(graph?.nodes.map((n, i) => [n.id, i]) ?? []), [graph]);
  const pairs = useMemo(() => {
    const p = new Uint32Array((graph?.edges.length ?? 0) * 2);
    graph?.edges.forEach((e, k) => {
      p[2 * k] = index.get(e.source)!;
      p[2 * k + 1] = index.get(e.target)!;
    });
    return p;
  }, [graph, index]);
  const adjacency = useMemo(() => {
    const adj: number[][] = (graph?.nodes ?? []).map(() => []);
    for (let k = 0; k < pairs.length; k += 2) {
      adj[pairs[k]].push(pairs[k + 1]);
      adj[pairs[k + 1]].push(pairs[k]);
    }
    return adj;
  }, [graph, pairs]);
  const kindColor = (k: string) => (k === OUTSIDE_KIND ? resolveColor("hsl(var(--fg-muted))") : resolveColor(groupColor(Math.max(0, kinds.indexOf(k)))));
  const style = useMemo(() => {
    const deg = graph ? setDegrees(graph) : new Map<string, number>();
    return styleNodes((graph?.nodes ?? []).map((n) => ({ kind: n.kind, degree: deg.get(n.id) ?? 0 })), rules, kindColor);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kindColor reads `kinds`
  }, [graph, rules, kinds]);

  useEffect(() => {
    if (!graph || asTable) return;
    let off = false;
    setPositions(null);
    runLayout(graph.nodes.length, pairs, (p) => !off && setPositions(p))
      .then((p) => !off && setPositions(p))
      .catch(() => !off && setAsTable(true));
    return () => {
      off = true;
    };
  }, [graph, pairs, asTable]);

  const apply = (p: Perspective) => {
    setRules({ ...p.rules });
    setHidden(new Set(p.filter.kinds ? kinds.filter((k) => !p.filter.kinds!.includes(k)) : []));
    if (p.filter.mode === "table" || p.filter.mode === "graph") setAsTable(p.filter.mode === "table");
  };

  return (
    <Modal onClose={onClose} aria-labelledby="set-graph-title" data-testid="set-graph" style={{ inlineSize: "92vw", blockSize: "90vh", maxInlineSize: "none", maxBlockSize: "none", margin: "auto", zIndex: 9999, background: "hsl(var(--bg))", color: "hsl(var(--fg))", border: "1px solid hsl(var(--border))", borderRadius: 8, padding: 0, overflow: "hidden" }}>
      <div ref={root} style={{ display: "flex", flexDirection: "column", blockSize: "100%", fontSize: 12 }}>
        <div role="toolbar" aria-label={t("graphPersp.toolbar")} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "6px 12px", borderBlockEnd: "1px solid hsl(var(--border))" }}>
          <h2 id="set-graph-title" style={{ margin: 0, fontSize: 14 }}>
            <bdi>{title}</bdi>
          </h2>
          <span data-testid="set-graph-stats">{t("graphPersp.stats", { nodes: graph?.nodes.length ?? 0, edges: graph?.edges.length ?? 0 })}</span>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "inline-flex", gap: 6 }}>
            <legend className="sr-only">{t("graphPersp.kinds")}</legend>
            {kinds.map((k) => (
              <label key={k} style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
                <input type="checkbox" checked={!hidden.has(k)} onChange={() => setHidden((h) => (h.has(k) ? new Set([...h].filter((x) => x !== k)) : new Set([...h, k])))} />
                <bdi>{k === OUTSIDE_KIND ? t("graphPersp.outside") : k}</bdi>
              </label>
            ))}
          </fieldset>
          {rows && (
            <label>
              <input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} data-testid="set-graph-outside" /> {t("graphPersp.includeOutside")}
            </label>
          )}
          <button type="button" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} data-testid="set-graph-table">
            {t("graphPersp.asTable")}
          </button>
          <PerspectiveBar
            scope="base"
            kinds={kinds}
            kindLabel={(k) => (k === OUTSIDE_KIND ? t("graphPersp.outside") : k)}
            defaultColor={(k) => rgbaToHex(kindColor(k))}
            rules={rules}
            onRules={setRules}
            snapshot={() => ({ ...(hidden.size ? { kinds: kinds.filter((k) => !hidden.has(k)) } : {}), mode: asTable ? "table" : "graph" })}
            onApply={apply}
            hotkeyRoot={root}
            vault={vault}
            style={field}
          />
          <button type="button" onClick={onClose} style={{ marginInlineStart: "auto" }}>
            {t("graphPersp.close")}
          </button>
        </div>
        <div style={{ flex: 1, minBlockSize: 320, position: "relative" }}>
          {error ? (
            <p role="alert" style={{ padding: 16 }}>{t("graphPersp.loadGraphFailed", { error })}</p>
          ) : !graph ? (
            <p style={{ padding: 16 }}>{t("graphPersp.loading")}</p>
          ) : !graph.nodes.length ? (
            <p style={{ padding: 16 }} data-testid="set-graph-empty">{t("graphPersp.empty")}</p>
          ) : asTable ? (
            <GraphTable labels={graph.nodes.map((n) => n.label)} neighbors={(i) => adjacency[i] ?? []} onOpen={(k) => onOpen?.(graph.nodes[k].id)} />
          ) : (
            <GraphCanvas
              labels={graph.nodes.map((n) => n.label)}
              edges={pairs}
              neighbors={(i) => adjacency[i] ?? []}
              positions={positions}
              colors={style.colors}
              sizes={style.sizes}
              edgeColor={resolveColor("hsl(var(--fg-muted))", 0.3)}
              ring={resolveColor("hsl(var(--fg))")}
              labelColor="hsl(var(--fg))"
              onOpen={(k) => graph.nodes[k].kind !== OUTSIDE_KIND && onOpen?.(graph.nodes[k].id)}
              ariaLabel={t("graphPersp.aria", { title, nodes: graph.nodes.length })}
              fitKey={`${graph.nodes.length}:${graph.edges.length}`}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

export default SetGraphDialog;
