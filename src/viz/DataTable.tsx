/**
 * The data table that stands in for a chart (plan W12.V1, gate W12.V7): a
 * real `<table>` with a caption and column headers, so a screen reader can
 * walk it cell by cell. Numbers are formatted for the locale and isolated
 * (`<bdi>`), so "-1,234.5" reads the same way in a right-to-left table;
 * labels take their own direction (`dir="auto"`).
 *
 * No strings of its own: the host passes the caption.
 */

import type { ChartTable } from "./chartModel";

interface Props {
  table: ChartTable;
  caption: string;
  locale?: string;
  /** The first column names the row (a category, a date, a point). */
  rowHeaders?: boolean;
  id?: string;
  hidden?: boolean;
}

export function formatCell(v: string | number | null, nf: Intl.NumberFormat): string {
  if (v === null) return "";
  return typeof v === "number" ? nf.format(v) : v;
}

export function DataTable({ table, caption, locale = "he", rowHeaders = true, id, hidden }: Props) {
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 });
  return (
    <div className="lumen-viz-table-wrap" id={id} hidden={hidden}>
      <table className="lumen-viz-table" data-viz-table="">
        <caption dir="auto">{caption}</caption>
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={i} scope="col" dir="auto">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((v, ci) =>
                ci === 0 && rowHeaders ? (
                  <th key={ci} scope="row" dir="auto">
                    {formatCell(v, nf)}
                  </th>
                ) : typeof v === "number" ? (
                  <td key={ci} data-value={v}>
                    <bdi>{formatCell(v, nf)}</bdi>
                  </td>
                ) : (
                  <td key={ci} dir="auto">
                    {formatCell(v, nf)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
