/**
 * What the entity graph view shows (plan W12.E7), computed once and used
 * by both the drawing and the table, so the table holds exactly what the
 * graph draws.
 *
 * Filters: entity types, predicates, the source note's folder or tag, the
 * minimum confidence, and a time window. An edge's time is its event date
 * (`when`) when it has one, else its source note's date (the note's `date`
 * property, else the extraction date). The neighbourhood is 1–3 hops
 * around a chosen entity, over the edges that pass the filters.
 */
import type { Edge, Entity, EntityType } from "./model";

export interface EntityGraphFilter {
  types?: ReadonlySet<EntityType>;
  predicates?: ReadonlySet<string>;
  /** Source note folder prefix ("יומן/"). */
  folder?: string;
  /** Source note tag (without #). */
  tag?: string;
  minConfidence?: number;
  /** Inclusive ISO day bounds. */
  from?: string;
  to?: string;
  /** Neighbourhood: centre entity id and depth 1–3. */
  center?: string;
  depth?: 1 | 2 | 3;
}

export interface NoteInfo {
  tags: readonly string[];
  /** ISO day of the note (its `date` property), if any. */
  date?: string;
  /** R12.8 claim card: the note's own `reliability:` (A–F) and `source-class:`, as written. */
  reliability?: string;
  sourceClass?: string;
}

export interface VisibleGraph {
  nodes: Entity[];
  edges: Edge[];
}

export const edgeDay = (e: Edge, notes: ReadonlyMap<string, NoteInfo>): string => (e.when ?? notes.get(e.provenance.note)?.date ?? e.provenance.date).slice(0, 10);

/** The days the slider runs over, sorted ascending. */
export function timeDomain(edges: readonly Edge[], notes: ReadonlyMap<string, NoteInfo>): string[] {
  return [...new Set(edges.map((e) => edgeDay(e, notes)))].sort();
}

export function visibleGraph(entities: readonly Entity[], edges: readonly Edge[], notes: ReadonlyMap<string, NoteInfo>, f: EntityGraphFilter): VisibleGraph {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const typeOk = (id: string) => {
    const e = byId.get(id);
    return !!e && (!f.types || f.types.has(e.type));
  };
  let es = edges.filter((e) => {
    if (!typeOk(e.subject) || !typeOk(e.object)) return false;
    if (f.predicates && !f.predicates.has(e.predicate)) return false;
    if (f.minConfidence !== undefined && e.confidence < f.minConfidence) return false;
    if (f.folder && !e.provenance.note.startsWith(f.folder)) return false;
    if (f.tag && !(notes.get(e.provenance.note)?.tags ?? []).includes(f.tag)) return false;
    const day = edgeDay(e, notes);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    return true;
  });
  let ids: Set<string>;
  if (f.center && byId.has(f.center)) {
    const depth = f.depth ?? 1;
    const adj = new Map<string, string[]>();
    for (const e of es) {
      (adj.get(e.subject) ?? adj.set(e.subject, []).get(e.subject)!).push(e.object);
      (adj.get(e.object) ?? adj.set(e.object, []).get(e.object)!).push(e.subject);
    }
    ids = new Set([f.center]);
    let frontier = [f.center];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const x of frontier) for (const y of adj.get(x) ?? []) if (!ids.has(y)) {
        ids.add(y);
        next.push(y);
      }
      frontier = next;
    }
    es = es.filter((e) => ids.has(e.subject) && ids.has(e.object));
  } else {
    ids = new Set(es.flatMap((e) => [e.subject, e.object]));
    // An entity with no edge shows when its type passes and no edge filter narrows the view.
    const narrowed = f.predicates || f.minConfidence !== undefined || f.folder || f.tag || f.from || f.to;
    if (!narrowed) for (const e of entities) if (!f.types || f.types.has(e.type)) ids.add(e.id);
  }
  const nodes = entities.filter((e) => ids.has(e.id));
  return { nodes, edges: es };
}

/** The neighbours of an entity in the visible graph, for keyboard steps in the table. */
export function neighbours(g: VisibleGraph, id: string): string[] {
  const out = new Set<string>();
  for (const e of g.edges) {
    if (e.subject === id) out.add(e.object);
    if (e.object === id) out.add(e.subject);
  }
  return [...out];
}

/** The renderer's input: index arrays over the visible nodes (CSR-friendly pairs). */
export function toRenderEdges(g: VisibleGraph): { index: Map<string, number>; pairs: Uint32Array } {
  const index = new Map(g.nodes.map((n, i) => [n.id, i]));
  const pairs = new Uint32Array(g.edges.length * 2);
  g.edges.forEach((e, k) => {
    pairs[2 * k] = index.get(e.subject)!;
    pairs[2 * k + 1] = index.get(e.object)!;
  });
  return { index, pairs };
}
