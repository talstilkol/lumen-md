/**
 * The path finder (plan W13.G4): "how does A connect to B?" — the k
 * shortest chains between two entities, each one read as citations:
 * entity → relation → entity, every link with its paragraph and a button
 * that opens the note there (`note#^anchor`). Filters: relation types, the
 * longest chain, how many chains. A loaded chunk of the entity graph view.
 *
 * Keyboard: a form (Enter searches), then ordinary lists and buttons; the
 * result count is announced in a live region. Direction: every arrow of a
 * path points the way the path is read (→ in English, ← in Hebrew), also on
 * a link read backwards — that one says so in words ("(reversed)") — so
 * one path never mixes → and ← (INT7, audit r4 design check); each name is
 * its own `dir="auto"` isolate.
 */
import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { t } from "../../i18n";
import { dirOf } from "../bidi";
import { PREDICATES, type Edge, type Entity } from "../../entities/model";
import { buildPathGraph, citeChain, kShortestPaths, type CitedStep, type FoundPath, type PathGraph } from "../../graph/paths";

interface Props {
  entities: readonly Entity[];
  edges: readonly Edge[];
  /** The notes' text, to show each link's paragraph as it is now. */
  texts?: ReadonlyMap<string, string>;
  /** Pre-filled ends (the entity open in the graph). */
  from?: string;
  to?: string;
  onOpenEntity?: (id: string) => void;
  onOpenSource?: (note: string, anchor: string) => void;
}

const field: React.CSSProperties = { fontSize: 12, padding: "2px 6px", borderRadius: 4, border: "1px solid hsl(var(--border))", background: "hsl(var(--bg))", color: "hsl(var(--fg))" };

/** Resolve what was typed to an entity: its exact name or alias, then a case- and niqqud-blind match. */
function resolve(entities: readonly Entity[], typed: string): Entity | undefined {
  const q = typed.trim();
  if (!q) return undefined;
  const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  return entities.find((e) => e.name === q || e.aliases.includes(q)) ?? entities.find((e) => fold(e.name) === fold(q) || e.aliases.some((a) => fold(a) === fold(q)));
}

export default function PathFinderPanel({ entities, edges, texts, from = "", to = "", onOpenEntity, onOpenSource }: Props) {
  const ids = useId();
  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const [a, setA] = useState(byId.get(from)?.name ?? "");
  const [b, setB] = useState(byId.get(to)?.name ?? "");
  const [preds, setPreds] = useState<Set<string>>(new Set(PREDICATES.map((p) => p.id)));
  const [maxHops, setMaxHops] = useState(0);
  const [k, setK] = useState(5);
  const [result, setResult] = useState<{ paths: FoundPath[]; ms: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const results = useRef<HTMLHeadingElement>(null);
  // The searchable graph, built on the first search and kept until the data or the relation filter changes.
  const built = useRef<{ entities: readonly Entity[]; edges: readonly Edge[]; preds: Set<string>; graph: PathGraph } | null>(null);
  const rtl = dirOf(null) === "rtl";
  const name = (id: string) => byId.get(id)?.name ?? id;

  const search = (e?: FormEvent) => {
    e?.preventDefault();
    const s = resolve(entities, a);
    const d = resolve(entities, b);
    setResult(null);
    if (!s || !d) return setProblem(t("entityGraph.paths.unknown", { name: !s ? a.trim() || "…" : b.trim() || "…" }));
    if (s.id === d.id) return setProblem(t("entityGraph.paths.same"));
    setProblem(null);
    const t0 = performance.now();
    const cached = built.current;
    const graph =
      cached && cached.entities === entities && cached.edges === edges && cached.preds === preds
        ? cached.graph
        : (built.current = { entities, edges, preds, graph: buildPathGraph(entities, edges, { predicates: preds.size === PREDICATES.length ? undefined : preds }) }).graph;
    const paths = kShortestPaths(graph, s.id, d.id, { k, maxHops: maxHops || undefined });
    setResult({ paths, ms: Math.round(performance.now() - t0) });
    requestAnimationFrame(() => results.current?.focus());
  };

  const toggle = (id: string) => setPreds((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  // The walking direction, the same for every step; a backward link is told by its label, not by the arrow.
  const arrow = (_forward: boolean) => (rtl ? "←" : "→");

  return (
    <section aria-labelledby={`${ids}-title`} data-testid="path-finder" style={{ display: "grid", gap: 12, padding: 12, fontSize: 13 }}>
      <h2 id={`${ids}-title`} style={{ margin: 0, fontSize: 15 }}>
        {t("entityGraph.paths.title")}
      </h2>
      <form onSubmit={search} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
        <datalist id={`${ids}-names`}>
          {entities.slice(0, 5000).map((e) => (
            <option key={e.id} value={e.name}>
              {t(`entityGraph.type.${e.type}`)}
            </option>
          ))}
        </datalist>
        <label style={{ display: "grid", gap: 2 }}>
          {t("entityGraph.paths.from")}
          <input dir="auto" list={`${ids}-names`} style={field} value={a} onChange={(e) => setA(e.target.value)} data-testid="path-from" autoComplete="off" />
        </label>
        <button
          type="button"
          style={field}
          aria-label={t("entityGraph.paths.swap")}
          title={t("entityGraph.paths.swap")}
          onClick={() => {
            setA(b);
            setB(a);
          }}
        >
          ⇄
        </button>
        <label style={{ display: "grid", gap: 2 }}>
          {t("entityGraph.paths.to")}
          <input dir="auto" list={`${ids}-names`} style={field} value={b} onChange={(e) => setB(e.target.value)} data-testid="path-to" autoComplete="off" />
        </label>
        <label style={{ display: "grid", gap: 2 }}>
          {t("entityGraph.paths.maxHops")}
          <select style={field} value={maxHops} onChange={(e) => setMaxHops(Number(e.target.value))} data-testid="path-max">
            <option value={0}>{t("entityGraph.paths.anyLength")}</option>
            {[1, 2, 3, 4, 5, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 2 }}>
          {t("entityGraph.paths.count")}
          <select style={field} value={k} onChange={(e) => setK(Number(e.target.value))}>
            {[1, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <details>
          <summary>{t("entityGraph.paths.relations", { n: String(preds.size), total: String(PREDICATES.length) })}</summary>
          <div role="group" aria-label={t("entityGraph.view.relations")} style={{ display: "grid", gridTemplateColumns: "repeat(2, auto)", gap: 2 }}>
            {PREDICATES.map((p) => (
              <label key={p.id}>
                <input type="checkbox" checked={preds.has(p.id)} onChange={() => toggle(p.id)} data-predicate={p.id} /> {t(`entityGraph.predicate.${p.id}`)}
              </label>
            ))}
          </div>
        </details>
        <button type="submit" style={{ ...field, fontWeight: 600 }} data-testid="path-search">
          {t("entityGraph.paths.find")}
        </button>
      </form>
      <p role="status" aria-live="polite" style={{ margin: 0, color: "hsl(var(--fg-muted))" }} data-testid="path-status">
        {problem ?? (result ? (result.paths.length ? t("entityGraph.paths.found", { n: String(result.paths.length), ms: String(result.ms) }) : t("entityGraph.paths.none")) : "")}
      </p>
      {result && result.paths.length > 0 && (
        <>
          <h3 ref={results} tabIndex={-1} className="sr-only">
            {t("entityGraph.paths.results")}
          </h3>
          <ol style={{ margin: 0, paddingInlineStart: 20, display: "grid", gap: 12 }} data-testid="path-results">
            {result.paths.map((p, n) => (
              <li key={p.steps.map((s) => s.edge.id).join("|")} data-path={n}>
                <div style={{ fontWeight: 600, marginBlockEnd: 4 }}>
                  {t("entityGraph.paths.summary", { n: String(n + 1), hops: String(p.steps.length), confidence: Math.round(100 * p.steps.reduce((c, s) => c * s.edge.confidence, 1)) + "%" })}
                </div>
                <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                  {citeChain(p, texts ?? new Map()).map((s: CitedStep, j) => (
                    <li key={s.edge.id} data-step={j} style={{ borderInlineStart: "2px solid hsl(var(--border))", paddingInlineStart: 8 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "baseline" }}>
                        <button type="button" className="link" dir="auto" onClick={() => onOpenEntity?.(s.from)} style={{ ...field, border: 0 }}>
                          {name(s.from)}
                        </button>
                        <span aria-hidden>{arrow(s.forward)}</span>
                        <span>
                          {s.forward ? t(`entityGraph.predicate.${s.edge.predicate}`) : t("entityGraph.paths.inverse", { relation: t(`entityGraph.predicate.${s.edge.predicate}`) })}
                          {s.others.length > 0 && ` ${t("entityGraph.paths.more", { n: String(s.others.length) })}`}
                        </span>
                        <span aria-hidden>{arrow(s.forward)}</span>
                        <button type="button" dir="auto" onClick={() => onOpenEntity?.(s.to)} style={{ ...field, border: 0 }}>
                          {name(s.to)}
                        </button>
                      </div>
                      <blockquote dir="auto" style={{ margin: "4px 0", color: "hsl(var(--fg-muted))" }}>
                        {s.paragraph ?? s.edge.provenance.quote}
                      </blockquote>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                        <button type="button" style={field} onClick={() => onOpenSource?.(s.edge.provenance.note, s.edge.provenance.anchor)} data-open-source={`${s.edge.provenance.note}#^${s.edge.provenance.anchor}`}>
                          {t("entityGraph.paths.openSource")}
                        </button>
                        <span dir="auto" title={`${s.edge.provenance.note}#^${s.edge.provenance.anchor}`}>
                          {s.edge.provenance.note.replace(/^.*\//, "").replace(/\.md$/i, "")}
                        </span>
                        {texts && s.paragraph === null && <span role="note">{t("entityGraph.paths.moved")}</span>}
                        <span>{Math.round(s.edge.confidence * 100)}%</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
