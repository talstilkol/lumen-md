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
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../i18n";
import { ENTITY_TYPES, PREDICATES, type Edge, type Entity, type EntityType } from "../entities/model";
import { edgeDay, neighbours, timeDomain, toRenderEdges, visibleGraph, type EntityGraphFilter, type NoteInfo } from "../entities/view";
import { runLayout } from "../graph/layoutClient";
import { GraphCanvas } from "./graph/GraphCanvas";
import { groupColor, resolveColor } from "./graph/graphData";
import "./entityGraphStrings";

export interface EntityGraphViewProps {
  entities: readonly Entity[];
  edges: readonly Edge[];
  notes: ReadonlyMap<string, NoteInfo>;
  onOpenEntity?: (id: string) => void;
  /** Start in the table (also the choice when WebGL is missing). */
  initialMode?: "graph" | "table";
}

const field: React.CSSProperties = { fontSize: 12, padding: "2px 6px", borderRadius: 4, border: "1px solid hsl(var(--border))", background: "hsl(var(--bg))", color: "hsl(var(--fg))" };

export function EntityGraphView({ entities, edges, notes, onOpenEntity, initialMode = "graph" }: EntityGraphViewProps) {
  const [types, setTypes] = useState<Set<EntityType>>(new Set(ENTITY_TYPES));
  const [preds, setPreds] = useState<Set<string>>(new Set(PREDICATES.map((p) => p.id)));
  const [folder, setFolder] = useState("");
  const [tag, setTag] = useState("");
  const [minConf, setMinConf] = useState(0);
  const domain = useMemo(() => timeDomain(edges, notes), [edges, notes]);
  const [until, setUntil] = useState(domain.length - 1);
  const [playing, setPlaying] = useState(false);
  const [center, setCenter] = useState("");
  const [depth, setDepth] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState(initialMode);
  const [rowState, setRow] = useState(0);
  const table = useRef<HTMLTableSectionElement>(null);

  useEffect(() => setUntil(domain.length - 1), [domain.length]);
  useEffect(() => {
    if (!playing) return;
    const h = setInterval(() => setUntil((u) => (u + 1 < domain.length ? u + 1 : (setPlaying(false), u))), 700);
    return () => clearInterval(h);
  }, [playing, domain.length]);

  const filter: EntityGraphFilter = useMemo(
    () => ({
      types,
      predicates: preds,
      folder: folder.trim() || undefined,
      tag: tag.trim().replace(/^#/, "") || undefined,
      minConfidence: minConf > 0 ? minConf : undefined,
      to: domain.length && until < domain.length - 1 ? domain[Math.max(0, until)] : undefined,
      center: center || undefined,
      depth,
    }),
    [types, preds, folder, tag, minConf, domain, until, center, depth],
  );
  const visible = useMemo(() => visibleGraph(entities, edges, notes, filter), [entities, edges, notes, filter]);
  const render = useMemo(() => toRenderEdges(visible), [visible]);
  const nameOf = useMemo(() => new Map(entities.map((e) => [e.id, e.name])), [entities]);

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
  const style = useMemo(() => {
    const colors = new Float32Array(visible.nodes.length * 4);
    const sizes = new Float32Array(visible.nodes.length);
    visible.nodes.forEach((n, i) => {
      colors.set(resolveColor(groupColor(ENTITY_TYPES.indexOf(n.type))), i * 4);
      sizes[i] = 4;
    });
    return { colors, sizes };
  }, [visible]);
  const adjacency = useMemo(() => visible.nodes.map((n) => neighbours(visible, n.id).map((x) => render.index.get(x)!)), [visible, render]);

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
    <div data-testid="entity-graph" style={{ display: "flex", flexDirection: "column", blockSize: "100%", fontSize: 12 }}>
      <div role="toolbar" aria-label={t("entityGraph.view.filters")} style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "6px 12px", borderBlockEnd: "1px solid hsl(var(--border))", alignItems: "center" }}>
        <span data-testid="entity-graph-stats">{t("entityGraph.view.stats", { nodes: String(visible.nodes.length), edges: String(visible.edges.length) })}</span>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 6 }}>
          <legend className="sr-only">{t("entityGraph.view.types")}</legend>
          {ENTITY_TYPES.map((ty, k) => (
            <label key={ty} style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
              <input type="checkbox" checked={types.has(ty)} onChange={() => toggle(types, ty, setTypes)} />
              <span aria-hidden style={{ inlineSize: 8, blockSize: 8, borderRadius: 4, background: groupColor(k) }} />
              {t(`entityGraph.type.${ty}`)}
            </label>
          ))}
        </fieldset>
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
        {domain.length > 0 && (
          <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            {t("entityGraph.view.until")}
            <input type="range" min={0} max={domain.length - 1} value={until} onChange={(e) => setUntil(Number(e.target.value))} aria-valuetext={domain[until]} data-testid="entity-graph-time" />
            <output>{domain[until]}</output>
            <button type="button" style={field} onClick={() => (until >= domain.length - 1 && setUntil(0), setPlaying((p) => !p))} aria-pressed={playing}>
              {playing ? t("entityGraph.view.pause") : t("entityGraph.view.play")}
            </button>
          </label>
        )}
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
        <button type="button" style={field} aria-pressed={mode === "table"} onClick={() => setMode((m) => (m === "graph" ? "table" : "graph"))}>
          {mode === "graph" ? t("entityGraph.view.showTable") : t("entityGraph.view.showGraph")}
        </button>
      </div>
      <div style={{ flex: 1, minBlockSize: 0, position: "relative", overflow: "auto" }}>
        {mode === "graph" ? (
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
