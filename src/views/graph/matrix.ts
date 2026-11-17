/**
 * The adjacency matrix (plan W12.V2): a graph as a table — one row and one
 * column per node, the cell the number of edges between them — ordered so
 * that communities sit together along the diagonal (Leiden, src/views/
 * leiden.ts; or Louvain, or by name). Pure; the view is a real HTML table.
 */

import { leiden } from "../leiden";
import { louvain } from "../louvain";

export type MatrixOrder = "leiden" | "louvain" | "name";

export interface AdjacencyMatrix {
  ids: string[];
  labels: string[];
  /** Community of each row (same order). */
  community: number[];
  /** `${row},${col}` → count; symmetric; the diagonal holds self-links. */
  cells: Map<string, number>;
  max: number;
}

export function adjacencyMatrix(nodes: ReadonlyArray<{ id: string; label: string }>, edges: ReadonlyArray<{ source: string; target: string }>, order: MatrixOrder = "leiden", locale = "he"): AdjacencyMatrix {
  const input = { nodes: nodes.map((n) => n.id), edges: edges.map((e) => ({ source: e.source, target: e.target })) };
  const comm = order === "name" ? new Map<string, number>() : (order === "leiden" ? leiden(input) : louvain(input)).communities;
  const coll = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const label = new Map(nodes.map((n) => [n.id, n.label]));
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  // Communities by size, then inside each by degree, then by name.
  const size = new Map<number, number>();
  for (const c of comm.values()) size.set(c, (size.get(c) ?? 0) + 1);
  const ids = nodes
    .map((n) => n.id)
    .sort((a, b) => {
      const ca = comm.get(a) ?? 0;
      const cb = comm.get(b) ?? 0;
      return (size.get(cb) ?? 0) - (size.get(ca) ?? 0) || ca - cb || (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || coll.compare(label.get(a)!, label.get(b)!);
    });
  const pos = new Map(ids.map((id, i) => [id, i]));
  const cells = new Map<string, number>();
  let max = 0;
  for (const e of edges) {
    const a = pos.get(e.source);
    const b = pos.get(e.target);
    if (a === undefined || b === undefined) continue;
    for (const k of a === b ? [`${a},${b}`] : [`${a},${b}`, `${b},${a}`]) {
      const v = (cells.get(k) ?? 0) + 1;
      cells.set(k, v);
      if (v > max) max = v;
    }
  }
  return { ids, labels: ids.map((id) => label.get(id)!), community: ids.map((id) => comm.get(id) ?? 0), cells, max };
}
