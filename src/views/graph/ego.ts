/**
 * The ego graph by default (plan R12.8): a graph that would open as a
 * hairball — more than `max` nodes — opens instead as the neighbourhood of
 * one entity, the one asked for, else the most connected one, at depth 1–2,
 * trimmed to `max` by distance and then degree; the trim is said ("50 of
 * 1,234"), and the whole graph stays one click away. Pure.
 */

export interface EgoChoice {
  /** null: the graph is small enough to show whole. */
  center: string | null;
  depth: 1 | 2;
  /** The ids shown, centre first, then by distance and degree. */
  ids: string[];
  total: number;
}

export function egoDefault(nodes: readonly string[], edges: ReadonlyArray<{ subject: string; object: string }>, opts: { max?: number; start?: string | null; depth?: 1 | 2 } = {}): EgoChoice {
  const max = opts.max ?? 50;
  const depth = opts.depth ?? 2;
  if (nodes.length <= max && !opts.start) return { center: null, depth, ids: [...nodes], total: nodes.length };
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n, new Set());
  for (const e of edges) {
    if (!adj.has(e.subject) || !adj.has(e.object) || e.subject === e.object) continue;
    adj.get(e.subject)!.add(e.object);
    adj.get(e.object)!.add(e.subject);
  }
  const degree = (n: string) => adj.get(n)?.size ?? 0;
  const center = opts.start && adj.has(opts.start) ? opts.start : [...nodes].sort((a, b) => degree(b) - degree(a) || (a < b ? -1 : 1))[0];
  const dist = new Map([[center, 0]]);
  let frontier = [center];
  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const x of frontier)
      for (const y of adj.get(x) ?? [])
        if (!dist.has(y)) {
          dist.set(y, d);
          next.push(y);
        }
    frontier = next;
  }
  const ids = [...dist.keys()].sort((a, b) => dist.get(a)! - dist.get(b)! || degree(b) - degree(a) || (a < b ? -1 : 1)).slice(0, max);
  return { center, depth, ids, total: nodes.length };
}
