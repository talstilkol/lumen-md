/**
 * The adjacency matrix (plan W12.V2) as a real HTML table: column and row
 * headers name the nodes, each cell the number of edges between two, rows
 * and columns in community order (Leiden by default) so the communities are
 * blocks along the diagonal. A table is its own accessible alternative;
 * the shading is decoration only (the number is in the cell). At most
 * MATRIX_MAX nodes: a bigger graph shows its most connected ones and says so.
 */

import { useMemo, useState } from "react";
import { t } from "../../i18n";
import "../vizStrings";
import "../viz.css";
import type { Dir } from "../bidi";
import { adjacencyMatrix, type AdjacencyMatrix, type MatrixOrder } from "../../views/graph/matrix";

export const MATRIX_MAX = 200;

/** A row's cells: each edge count, and each run of empty cells as one span. */
export function rowCells(m: AdjacencyMatrix, row: number): Array<{ col: number; span: number; value: number }> {
  const out: Array<{ col: number; span: number; value: number }> = [];
  let run = -1;
  for (let j = 0; j < m.ids.length; j++) {
    const v = m.cells.get(`${row},${j}`);
    if (v) {
      if (run >= 0) out.push({ col: run, span: j - run, value: 0 });
      run = -1;
      out.push({ col: j, span: 1, value: v });
    } else if (run < 0) run = j;
  }
  if (run >= 0) out.push({ col: run, span: m.ids.length - run, value: 0 });
  return out;
}

interface Props {
  title: string;
  dir: Dir;
  locale?: string;
  nodes: ReadonlyArray<{ id: string; label: string }>;
  edges: ReadonlyArray<{ source: string; target: string }>;
  initialOrder?: MatrixOrder;
}

export default function AdjacencyMatrixView({ title, dir, locale = "he", nodes, edges, initialOrder = "leiden" }: Props) {
  const [order, setOrder] = useState<MatrixOrder>(initialOrder);
  const kept = useMemo(() => {
    if (nodes.length <= MATRIX_MAX) return nodes;
    const deg = new Map<string, number>();
    for (const e of edges) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
    return [...nodes].sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0)).slice(0, MATRIX_MAX);
  }, [nodes, edges]);
  const m = useMemo(() => adjacencyMatrix(kept, edges, order, locale), [kept, edges, order, locale]);
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  return (
    <div className="lumen-viz-matrix" dir={dir} data-matrix-order={order}>
      <div className="lumen-viz-bar">
        <label>
          {t("viz.matrix.order")}{" "}
          <select value={order} onChange={(e) => setOrder(e.target.value as MatrixOrder)} data-matrix-order-select="">
            <option value="leiden">{t("viz.matrix.order.leiden")}</option>
            <option value="louvain">{t("viz.matrix.order.louvain")}</option>
            <option value="name">{t("viz.matrix.order.name")}</option>
          </select>
        </label>
      </div>
      {nodes.length > kept.length && <p className="lumen-viz-note">{t("viz.matrix.limited", { shown: kept.length, total: nodes.length })}</p>}
      <div className="lumen-viz-table-wrap" style={{ maxBlockSize: 640 }}>
        <table className="lumen-viz-table lumen-viz-matrix-table" data-viz-table="">
          <caption>{t("viz.matrix.caption", { title })}</caption>
          <thead>
            <tr>
              <td />
              {m.labels.map((l, j) => (
                <th key={m.ids[j]} scope="col" dir="auto" data-community={m.community[j]}>
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.labels.map((l, i) => (
              <tr key={m.ids[i]}>
                <th scope="row" dir="auto" data-community={m.community[i]}>
                  {l}
                </th>
                {rowCells(m, i).map((c) =>
                  c.value ? (
                    // The shade is a class (1–4 by the share of the largest cell): no style object per cell.
                    <td key={c.col} data-value={c.value} className={`lumen-viz-m${Math.min(4, 1 + Math.floor((3 * c.value) / m.max))}`}>
                      {nf.format(c.value)}
                    </td>
                  ) : (
                    // A run of empty cells is one cell spanning them: a sparse 200 × 200 matrix is a few thousand cells, not 40,000.
                    <td key={c.col} colSpan={c.span > 1 ? c.span : undefined} />
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
