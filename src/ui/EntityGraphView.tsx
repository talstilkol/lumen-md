/**
 * The entity graph view (plan W12.E7): the W1.10 WebGL renderer and its
 * layout worker (GraphCanvas, runLayout), coloured by entity type, with
 * filters by type, relation, source folder or tag and confidence; a time
 * slider that runs right to left in RTL (the range input follows the
 * document's direction) with play; a 1–3 hop neighbourhood; and a data
 * table that shows exactly what the graph draws — both read one
 * `visibleGraph` result.
 *
 * Keyboard: the canvas has W1.10's own keyboard navigation; in the table,
 * ↑/↓ move between rows, ←/→ (logical: next/previous) jump to the focused
 * entity's neighbours, Enter centres the neighbourhood on it.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { isRTL, t } from "../i18n";
import { ENTITY_TYPES, PREDICATES, type Edge, type Entity, type EntityType } from "../entities/model";
import { edgeDay, neighbours, timeDomain, toRenderEdges, visibleGraph, type EntityGraphFilter, type NoteInfo } from "../entities/view";
import { runLayout } from "../graph/layoutClient";
import { GraphCanvas } from "./graph/GraphCanvas";
import { TimeSlider, untilOf } from "./graph/TimeSlider";
import { groupColor, resolveColor } from "./graph/graphData";
import "./entityGraphStrings";
import "./graph/perspectiveStrings";
import { PerspectiveBar } from "./graph/PerspectiveBar";
import { rgbaToHex, styleNodes, type KindRule, type Perspective, type PerspectiveFilter } from "../graph/perspectives";
import { egoDefault } from "../views/graph/ego";
import { countedSankey, type FlowInput } from "../views/graph/flows";
import type { SourceMeta } from "../views/graph/claims";

// R12.8 / W12.V2: the Sankey, the matrix and the claim inspector load only when asked for.
const SankeyView = lazy(() => import("../viz/graph/SankeyView"));
const AdjacencyMatrixView = lazy(() => import("../viz/graph/AdjacencyMatrixView"));
const EdgeInspector = lazy(() => import("../viz/graph/EdgeInspector"));

/** Above this many entities the view opens as an ego graph (R12.8), never as a hairball. */
export const EGO_MAX = 50;

export type EntityGraphMode = "graph" | "table" | "sankey" | "flows" | "matrix";

export interface EntityGraphViewProps {
  entities: readonly Entity[];
  edges: readonly Edge[];
  notes: ReadonlyMap<string, NoteInfo>;
  onOpenEntity?: (id: string) => void;
  /** Start in the table (also the choice when WebGL is missing), or in one of the R12.8 / W12.V2 views. */
  initialMode?: EntityGraphMode;
  /** Open around this entity (R12.8: the ego graph of the entity being opened). */
  start?: string;
  /** Open a note at a paragraph (the claim card's source link). */
  onOpenSource?: (note: string, anchor: string) => void;
  /** W13.G9: where perspectives are kept (tests pass a vault; the app uses the workspace). */
  perspectiveVault?: import("../graph/perspectives").PerspectiveVault;
}

const field: React.CSSProperties = { fontSize: 12, padding: "2px 6px", borderRadius: 4, border: "1px solid hsl(var(--border))", background: "hsl(var(--bg))", color: "hsl(var(--fg))" };

export function EntityGraphView({ entities, edges, notes, onOpenEntity, initialMode = "graph", start, onOpenSource, perspectiveVault }: EntityGraphViewProps) {
  const [types, setTypes] = useState<Set<EntityType>>(new Set(ENTITY_TYPES));
  const [preds, setPreds] = useState<Set<string>>(new Set(PREDICATES.map((p) => p.id)));
  const [folder, setFolder] = useState("");
  const [tag, setTag] = useState("");
  const [minConf, setMinConf] = useState(0);
  const domain = useMemo(() => timeDomain(edges, notes), [edges, notes]);
  const [until, setUntil] = useState(domain.length - 1);
  // R12.8: a big graph opens as the ego graph of `start`, else of the most connected entity.
  const ego = useMemo(() => egoDefault(entities.map((e) => e.id), edges, { max: EGO_MAX, start: start ?? null }), [entities, edges, start]);
  const [center, setCenter] = useState(ego.center ?? "");
  const [depth, setDepth] = useState<1 | 2 | 3>(ego.center ? ego.depth : 1);
  const [mode, setMode] = useState<EntityGraphMode>(initialMode);
  const [inspect, setInspect] = useState<readonly string[] | null>(null);
  const [rowState, setRow] = useState(0);
  const table = useRef<HTMLTableSectionElement>(null);
  // W13.G9: the perspective's style rules per entity type, and the root Alt+1…9 listens on.
  const [rules, setRules] = useState<Record<string, KindRule>>({});
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => setUntil(domain.length - 1), [domain.length]);

  const filter: EntityGraphFilter = useMemo(
    () => ({
      types,
      predicates: preds,
      folder: folder.trim() || undefined,
      tag: tag.trim().replace(/^#/, "") || undefined,
      minConfidence: minConf > 0 ? minConf : undefined,
      to: untilOf(domain, until),
      center: center || undefined,
      depth,
    }),
    [types, preds, folder, tag, minConf, domain, until, center, depth],
  );
  const visible = useMemo(() => visibleGraph(entities, edges, notes, filter), [entities, edges, notes, filter]);
  const render = useMemo(() => toRenderEdges(visible), [visible]);
  const nameOf = useMemo(() => new Map(entities.map((e) => [e.id, e.name])), [entities]);
  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const rtl = isRTL();
  // W12.V2: relations counted from entity type to entity type; R12.8: one band per relation (flows).
  const typeBands = useMemo(
    () => countedSankey(visible.edges.map((e) => ({ from: t(`entityGraph.type.${byId.get(e.subject)?.type}`), to: t(`entityGraph.type.${byId.get(e.object)?.type}`), id: e.id }))),
    [visible, byId],
  );
  const flows: FlowInput[] = useMemo(
    () => visible.edges.map((e) => ({ id: e.id, from: nameOf.get(e.subject) ?? e.subject, to: nameOf.get(e.object) ?? e.object, label: t(`entityGraph.predicate.${e.predicate}`), amount: null, day: e.when ?? null })),
    [visible, nameOf],
  );
  const sourceOf = (note: string): SourceMeta | undefined => {
    const n = notes.get(note);
    return n ? { reliability: n.reliability, sourceClass: n.sourceClass } : undefined;
  };
  const egoShown = !!ego.center && center === ego.center;

  const [positions, setPositions] = useState<Float32Array | null>(null);
  useEffect(() => {
    if (mode !== "graph") return;
    let off = false;
    setPositions(null);
    runLayout(visible.nodes.length, render.pairs, (p) => !off && setPositions(p))
      .then((p) => !off && setPositions(p))
      .catch(() => {
        // why: no worker or WebGL here — the table shows the same data
        if (!off) setMode("table");
      });
    return () => {
      off = true;
    };
  }, [mode, visible, render]);
  const adjacency = useMemo(() => visible.nodes.map((n) => neighbours(visible, n.id).map((x) => render.index.get(x)!)), [visible, render]);
  const style = useMemo(
    () => styleNodes(visible.nodes.map((n, i) => ({ kind: n.type, degree: adjacency[i]?.length ?? 0 })), rules, (k) => resolveColor(groupColor(ENTITY_TYPES.indexOf(k as EntityType)))),
    [visible, adjacency, rules],
  );

  // W13.G9: the view's state as a perspective, and back.
  const snapshot = (): PerspectiveFilter => ({
    ...(types.size < ENTITY_TYPES.length ? { kinds: [...types] } : {}),
    ...(preds.size < PREDICATES.length ? { predicates: [...preds] } : {}),
    ...(folder.trim() ? { folder: folder.trim() } : {}),
    ...(tag.trim() ? { tag: tag.trim() } : {}),
    ...(minConf > 0 ? { minConfidence: minConf } : {}),
    ...(center ? { center, depth } : {}),
    mode,
  });
  const applyPerspective = (p: Perspective) => {
    const f = p.filter;
    setTypes(new Set(f.kinds ? ENTITY_TYPES.filter((x) => f.kinds!.includes(x)) : ENTITY_TYPES));
    setPreds(new Set(f.predicates ? PREDICATES.map((x) => x.id).filter((x) => f.predicates!.includes(x)) : PREDICATES.map((x) => x.id)));
    setFolder(f.folder ?? "");
    setTag(f.tag ?? "");
    setMinConf(f.minConfidence ?? 0);
    setCenter(f.center && byId.has(f.center) ? f.center : "");
    setDepth(f.depth ?? 1);
    if (f.mode && ["graph", "table", "sankey", "flows", "matrix"].includes(f.mode)) setMode(f.mode as EntityGraphMode);
    setRules({ ...p.rules });
  };

  const toggle = <T,>(set: Set<T>, v: T, put: (s: Set<T>) => void) => put(set.has(v) ? new Set([...set].filter((x) => x !== v)) : new Set([...set, v]));
  const focusRow = (i: number) => {
    setRow(i);
    (table.current?.querySelectorAll<HTMLTableRowElement>("tr[data-node]")[i])?.focus();
  };
  const onTableKey = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    const n = visible.nodes.length;
    if (!n) return;
    // The focused row is the one the keys act on (state may lag a focus that came from outside).
    const at = visible.nodes.findIndex((x) => x.id === (document.activeElement as HTMLElement | null)?.dataset?.node);
    const row = at >= 0 ? at : rowState;
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusRow((row + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const nb = neighbours(visible, visible.nodes[row].id).map((id) => visible.nodes.findIndex((x) => x.id === id)).sort((a, b) => a - b);
      if (!nb.length) return;
      const forward = (e.key === "ArrowLeft") === rtl;
      const next = forward ? (nb.find((i) => i > row) ?? nb[0]) : ([...nb].reverse().find((i) => i < row) ?? nb[nb.length - 1]);
      focusRow(next);
    } else if (e.key === "Enter") {
      setCenter(visible.nodes[row].id);
    }
  };

  return (
    <div ref={root} data-testid="entity-graph" style={{ display: "flex", flexDirection: "column", blockSize: "100%", fontSize: 12 }}>
      <div role="toolbar" aria-label={t("entityGraph.view.filters")} style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "6px 12px", borderBlockEnd: "1px solid hsl(var(--border))", alignItems: "center" }}>
        <span data-testid="entity-graph-stats">{t("entityGraph.view.stats", { nodes: String(visible.nodes.length), edges: String(visible.edges.length) })}</span>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 6 }}>
          <legend className="sr-only">{t("entityGraph.view.types")}</legend>
          {ENTITY_TYPES.map((ty, k) => (
            <label key={ty} style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
              <input type="checkbox" checked={types.has(ty)} onChange={() => toggle(types, ty, setTypes)} />
              <span aria-hidden style={{ inlineSize: 8, blockSize: 8, borderRadius: 4, background: rules[ty]?.color ?? groupColor(k) }} />
              {t(`entityGraph.type.${ty}`)}
            </label>
          ))}
        </fieldset>
        {/* W12.X3: the citation graph — "cites" edges between sources (and laws) only. */}
        <button type="button" aria-pressed={preds.size === 1 && preds.has("cites")} onClick={() => (preds.size === 1 && preds.has("cites") ? (setPreds(new Set(PREDICATES.map((p) => p.id))), setTypes(new Set(ENTITY_TYPES))) : (setPreds(new Set(["cites"])), setTypes(new Set<EntityType>(["source", "law"]))))}>
          {t("entityGraph.view.citationsOnly")}
        </button>
        <details>
          <summary>{t("entityGraph.view.relations")}</summary>
          <div role="group" aria-label={t("entityGraph.view.relations")} style={{ display: "grid", gridTemplateColumns: "repeat(2, auto)", gap: 2 }}>
            {PREDICATES.map((p) => (
              <label key={p.id}>
                <input type="checkbox" checked={preds.has(p.id)} onChange={() => toggle(preds, p.id, setPreds)} /> {t(`entityGraph.predicate.${p.id}`)}
              </label>
            ))}
          </div>
        </details>
        <input dir="auto" style={field} placeholder={t("entityGraph.view.folder")} aria-label={t("entityGraph.view.folder")} value={folder} onChange={(e) => setFolder(e.target.value)} />
        <input dir="auto" style={field} placeholder={t("entityGraph.view.tag")} aria-label={t("entityGraph.view.tag")} value={tag} onChange={(e) => setTag(e.target.value)} />
        <label>
          {t("entityGraph.view.confidence")} <input type="number" min={0} max={1} step={0.1} style={{ ...field, inlineSize: 56 }} value={minConf} onChange={(e) => setMinConf(Number(e.target.value) || 0)} />
        </label>
        <TimeSlider
          domain={domain}
          value={until}
          onChange={setUntil}
          labels={{ until: t("entityGraph.view.until"), play: t("entityGraph.view.play"), pause: t("entityGraph.view.pause") }}
          testId="entity-graph-time"
          style={field}
        />
        <label>
          {t("entityGraph.view.around")}{" "}
          <select style={field} value={center} onChange={(e) => setCenter(e.target.value)}>
            <option value="">{t("entityGraph.view.everything")}</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("entityGraph.view.depth")}{" "}
          <select style={field} value={depth} onChange={(e) => setDepth(Number(e.target.value) as 1 | 2 | 3)} disabled={!center}>
            {[1, 2, 3].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("entityGraph.view.mode")}{" "}
          <select style={field} value={mode} onChange={(e) => setMode(e.target.value as EntityGraphMode)} data-testid="entity-graph-mode">
            <option value="graph">{t("entityGraph.view.showGraph")}</option>
            <option value="table">{t("entityGraph.view.showTable")}</option>
            <option value="sankey">{t("entityGraph.view.mode.sankey")}</option>
            <option value="flows">{t("entityGraph.view.mode.flows")}</option>
            <option value="matrix">{t("entityGraph.view.mode.matrix")}</option>
          </select>
        </label>
        <PerspectiveBar
          scope="entities"
          kinds={ENTITY_TYPES}
          kindLabel={(k) => t(`entityGraph.type.${k}`)}
          defaultColor={(k) => rgbaToHex(resolveColor(groupColor(ENTITY_TYPES.indexOf(k as EntityType))))}
          rules={rules}
          onRules={setRules}
          snapshot={snapshot}
          onApply={applyPerspective}
          hotkeyRoot={root}
          vault={perspectiveVault}
          style={field}
        />
        {egoShown && (
          <span data-testid="entity-graph-ego">
            {t("entityGraph.view.egoOf", { name: nameOf.get(ego.center!) ?? "", shown: String(visible.nodes.length), total: String(ego.total) })}{" "}
            <button type="button" style={field} onClick={() => setCenter("")}>
              {t("entityGraph.view.whole")}
            </button>
          </span>
        )}
      </div>
      {inspect && (
        <Suspense fallback={null}>
          <EdgeInspector ids={inspect} edges={edges} entities={byId} sourceOf={sourceOf} onClose={() => setInspect(null)} onOpenSource={onOpenSource} />
        </Suspense>
      )}
      <div style={{ flex: 1, minBlockSize: 0, position: "relative", overflow: "auto" }}>
        {mode === "sankey" || mode === "flows" || mode === "matrix" ? (
          <Suspense fallback={null}>
            {mode === "matrix" ? (
              <AdjacencyMatrixView
                title={t("entityGraph.view.mode.matrix")}
                dir={rtl ? "rtl" : "ltr"}
                nodes={visible.nodes.map((n) => ({ id: n.id, label: n.name }))}
                edges={visible.edges.map((e) => ({ source: e.subject, target: e.object }))}
              />
            ) : (
              <SankeyView
                title={mode === "sankey" ? t("entityGraph.view.mode.sankey") : t("entityGraph.view.mode.flows")}
                dir={rtl ? "rtl" : "ltr"}
                data={mode === "sankey" ? typeBands : undefined}
                flows={mode === "flows" ? flows : undefined}
                onBand={(ids) => setInspect(ids)}
              />
            )}
          </Suspense>
        ) : mode === "graph" ? (
          <GraphCanvas
            labels={visible.nodes.map((n) => n.name)}
            edges={render.pairs}
            neighbors={(i) => adjacency[i] ?? []}
            positions={positions}
            colors={style.colors}
            sizes={style.sizes}
            edgeColor={resolveColor("hsl(var(--fg-muted))", 0.25)}
            ring={resolveColor("hsl(var(--fg))")}
            labelColor="hsl(var(--fg))"
            onOpen={(k) => onOpenEntity?.(visible.nodes[k].id)}
            ariaLabel={t("entityGraph.view.aria", { nodes: String(visible.nodes.length) })}
            fitKey={`${visible.nodes.length}:${visible.edges.length}`}
          />
        ) : (
          <div style={{ display: "grid", gap: 12, padding: 12 }}>
            <table data-testid="entity-graph-nodes">
              <caption>{t("entityGraph.view.nodes")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("entityGraph.view.name")}</th>
                  <th scope="col">{t("entityGraph.view.type")}</th>
                  <th scope="col">{t("entityGraph.view.neighbours")}</th>
                </tr>
              </thead>
              <tbody ref={table} onKeyDown={onTableKey}>
                {visible.nodes.map((n, i) => (
                  <tr key={n.id} data-node={n.id} tabIndex={i === rowState ? 0 : -1} aria-selected={i === rowState} onFocus={() => setRow(i)} onDoubleClick={() => onOpenEntity?.(n.id)}>
                    <td dir="auto">{n.name}</td>
                    <td>{t(`entityGraph.type.${n.type}`)}</td>
                    <td>{neighbours(visible, n.id).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table data-testid="entity-graph-edges">
              <caption>{t("entityGraph.view.edges")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("entityGraph.view.subject")}</th>
                  <th scope="col">{t("entityGraph.view.relation")}</th>
                  <th scope="col">{t("entityGraph.view.object")}</th>
                  <th scope="col">{t("entityGraph.view.date")}</th>
                  <th scope="col">{t("entityGraph.view.source")}</th>
                  <th scope="col">{t("entityGraph.view.why")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.edges.map((e) => (
                  <tr key={e.id} data-edge={e.id}>
                    <td dir="auto">{nameOf.get(e.subject)}</td>
                    <td>{t(`entityGraph.predicate.${e.predicate}`)}</td>
                    <td dir="auto">{nameOf.get(e.object)}</td>
                    <td>{edgeDay(e, notes)}</td>
                    <td dir="auto">
                      <q>{e.provenance.quote}</q> — {e.provenance.note}#^{e.provenance.anchor}
                    </td>
                    <td>
                      <button type="button" onClick={() => setInspect([e.id])} data-edge-why-open={e.id}>
                        {t("entityGraph.view.whyOpen")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
