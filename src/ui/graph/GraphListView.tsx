/**
 * The graph as a list you walk (plan W13.G11): one node at a time — its
 * name as a heading, a one-line description, and its neighbours grouped by
 * relation (outgoing first, then incoming). A neighbour is a button: Enter
 * (or a click) moves there and the heading takes the focus, so a screen
 * reader says where you are; Backspace goes back the way you came. ↑/↓ move
 * between the neighbours, Home / End to the first and last.
 *
 * The same `AltGraph` the summary and the table read, so the three views
 * show the same nodes (graphTextAlt.test.ts checks it).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../../i18n";
import { degrees, neighbourGroups, type AltGraph, type AltNode } from "../../graph/textAlt";
import "./graphAltStrings";
import { EmptyState, learnHow } from "../EmptyState";

export interface GraphListViewProps {
  graph: AltGraph;
  /** The node to start from; else the most connected one. */
  start?: string;
  /** "Person", "Place"… for a node's kind (entity graph); notes have none. */
  kindLabel?: (kind: string) => string;
  /** A relation group's heading. */
  relationLabel: (relation: string, direction: "out" | "in") => string;
  onOpen?: (id: string) => void;
  /** Reports the current node (the host can centre its other views on it). */
  onCurrent?: (id: string) => void;
}

// Not `all: unset`: that would also drop the :focus-visible ring.
const btn: React.CSSProperties = { background: "none", border: 0, color: "inherit", font: "inherit", cursor: "pointer", paddingBlock: 2, paddingInline: 4, borderRadius: 3, textDecoration: "underline", textUnderlineOffset: 2 };

export function GraphListView({ graph, start, kindLabel, relationLabel, onOpen, onCurrent }: GraphListViewProps) {
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const deg = useMemo(() => degrees(graph), [graph]);
  const first = useMemo(() => {
    if (start && byId.has(start)) return start;
    let best: AltNode | undefined;
    for (const n of graph.nodes) if (!best || (deg.get(n.id) ?? 0) > (deg.get(best.id) ?? 0)) best = n;
    return best?.id ?? "";
  }, [graph, byId, deg, start]);
  const [current, setCurrent] = useState(first);
  const [trail, setTrail] = useState<string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  // A filter that drops the current node: start again from the best one.
  useEffect(() => {
    if (!byId.has(current)) {
      setCurrent(first);
      setTrail((tr) => tr.filter((x) => byId.has(x)));
    }
  }, [byId, current, first]);
  useEffect(() => {
    if (current) onCurrent?.(current);
    if (moved.current) heading.current?.focus();
    moved.current = false;
  }, [current, onCurrent]);

  const node = byId.get(current);
  const groups = useMemo(() => (node ? neighbourGroups(graph, node.id) : []), [graph, node]);

  const go = (id: string) => {
    if (id === current) return;
    moved.current = true;
    setTrail((tr) => [...tr, current]);
    setCurrent(id);
  };
  const back = () => {
    if (!trail.length) return;
    moved.current = true;
    setCurrent(trail[trail.length - 1]);
    setTrail((tr) => tr.slice(0, -1));
  };

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button[data-neighbour]") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const to = (i: number) => {
      e.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, i))]?.focus();
    };
    if (e.key === "Backspace" && (e.target as HTMLElement).tagName !== "INPUT") {
      e.preventDefault();
      back();
    } else if (!buttons.length) return;
    else if (e.key === "ArrowDown") to(at < 0 ? 0 : at + 1);
    else if (e.key === "ArrowUp") to(at < 0 ? buttons.length - 1 : at - 1);
    else if (e.key === "Home" && at >= 0) to(0);
    else if (e.key === "End" && at >= 0) to(buttons.length - 1);
  };

  if (!node) {
    return (
      <EmptyState testId="graph-list-empty" message={t("graphAlt.list.empty")} action={learnHow("workspace/graph")} />
    );
  }
  const links = deg.get(node.id) ?? 0;
  const desc = [node.kind && kindLabel ? kindLabel(node.kind) : null, t("graphAlt.list.links", { n: links, groups: groups.length })].filter(Boolean).join(" · ");
  return (
    <section data-testid="graph-list" aria-label={t("graphAlt.list.label")} onKeyDown={onKey} style={{ padding: 12, display: "grid", gap: 8, fontSize: 13, color: "hsl(var(--fg))" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 12 }}>
          {t("graphAlt.list.goTo")}
          <select value={current} onChange={(e) => go(e.target.value)} data-testid="graph-list-goto" style={{ fontSize: 12, maxInlineSize: 240 }}>
            {graph.nodes.map((n) => (
              <option key={n.id} value={n.id} dir="auto">
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={back} disabled={!trail.length} data-testid="graph-list-back" aria-keyshortcuts="Backspace">
          {t("graphAlt.list.back")}
        </button>
        {onOpen && (
          <button type="button" onClick={() => onOpen(node.id)} data-testid="graph-list-open">
            {t("graphAlt.list.open")}
          </button>
        )}
      </div>
      <h3 ref={heading} tabIndex={-1} data-testid="graph-list-current" style={{ margin: 0, fontSize: 16 }}>
        <bdi>{node.label}</bdi>
      </h3>
      <p id="graph-list-desc" style={{ margin: 0, color: "hsl(var(--fg-muted))" }} data-testid="graph-list-desc">
        {desc}
      </p>
      <div ref={list} role="group" aria-labelledby="graph-list-desc" style={{ display: "grid", gap: 10 }}>
        {/* empty-action: the Back button above (graph-list-back) returns to the node you came from */}
        {!groups.length && <p style={{ margin: 0 }}>{t("graphAlt.list.none")}</p>}
        {groups.map((g) => {
          const hid = `graph-list-g-${g.direction}-${g.relation || "link"}`;
          return (
            <div key={hid} data-group={`${g.direction}:${g.relation}`}>
              <h4 id={hid} style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 600 }}>
                {relationLabel(g.relation, g.direction)} ({g.nodes.length})
              </h4>
              <ul aria-labelledby={hid} style={{ margin: 0, paddingInlineStart: 18, display: "grid", gap: 2 }}>
                {g.nodes.map((n) => (
                  <li key={n.id}>
                    <button type="button" dir="auto" style={btn} data-neighbour={n.id} onClick={() => go(n.id)}>
                      {n.label}
                    </button>
                    {n.kind && kindLabel && <span style={{ color: "hsl(var(--fg-muted))", fontSize: 11 }}> · {kindLabel(n.kind)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "hsl(var(--fg-muted))" }}>{t("graphAlt.list.keys")}</p>
    </section>
  );
}
