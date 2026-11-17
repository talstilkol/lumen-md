/**
 * The knowledge graph as a table (plan W1.10, W10.E60): the text
 * alternative to the canvas. Every note of the (filtered) graph with its
 * number of links and the notes it links to; a note's name opens it. It
 * reads the same nodes and links as the canvas, so a screen reader user
 * and a keyboard user get the graph's content, not a picture of it.
 */
import { t } from "../../i18n";
import { compareNames } from "../../i18n/collate";

/** Rows shown at once; the filters above the graph narrow a larger vault. */
export const GRAPH_TABLE_ROWS = 500;
/** Linked notes named per row before "+N". */
const NAMED = 8;

export interface GraphTableRow {
  index: number;
  label: string;
  links: number[];
}

/** The rows: most-linked first, then by name; at most `max`. */
export function graphTableRows(labels: readonly string[], neighbors: (i: number) => readonly number[], max = GRAPH_TABLE_ROWS): GraphTableRow[] {
  const rows = labels.map((label, index) => ({ index, label, links: [...new Set(neighbors(index))].filter((j) => j !== index) }));
  rows.sort((a, b) => b.links.length - a.links.length || compareNames(a.label, b.label));
  return rows.slice(0, max);
}

export function GraphTable({ labels, neighbors, onOpen }: { labels: readonly string[]; neighbors: (i: number) => readonly number[]; onOpen: (index: number) => void }) {
  const rows = graphTableRows(labels, neighbors);
  const cell = { padding: "4px 8px", borderBlockEnd: "1px solid hsl(var(--border))", textAlign: "start" } as const;
  return (
    <div style={{ blockSize: "100%", overflow: "auto", padding: "8px 12px" }} data-testid="graph-table">
      <table style={{ borderCollapse: "collapse", inlineSize: "100%", fontSize: 13, color: "hsl(var(--fg))" }}>
        <caption style={{ textAlign: "start", paddingBlockEnd: 6, color: "hsl(var(--fg-muted))" }}>{t("graph.table.caption", { shown: String(rows.length), nodes: String(labels.length) })}</caption>
        <thead>
          <tr>
            <th scope="col" style={cell}>{t("graph.table.note")}</th>
            <th scope="col" style={cell}>{t("graph.table.links")}</th>
            <th scope="col" style={cell}>{t("graph.table.linkedTo")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.index}>
              <th scope="row" style={{ ...cell, fontWeight: 400 }}>
                <button type="button" dir="auto" onClick={() => onOpen(r.index)} style={{ all: "unset", cursor: "pointer", textDecoration: "underline" }}>
                  {r.label}
                </button>
              </th>
              <td style={cell}>{r.links.length}</td>
              <td style={cell} dir="auto">
                {/* empty-action: the note's button in this row's header opens it, where the links are added */}
                {r.links.length ? r.links.slice(0, NAMED).map((j) => labels[j]).join(", ") + (r.links.length > NAMED ? ` ${t("graph.table.more", { n: String(r.links.length - NAMED) })}` : "") : t("graph.table.none")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
