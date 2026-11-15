/**
 * A data file as a table or a kanban board (plan W12.F5). Rows are
 * virtualized (@tanstack/react-virtual, as in the Bases table), so a file of
 * 10,000 rows renders only what is on screen. A cell edit calls `onEdit`,
 * which writes the file back through ./dataFile (only the edited record
 * changes in a CSV).
 */
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { t } from "../i18n";
import { firstStrongDirection } from "../lib/textDirection";
import type { DataTable } from "./dataFile";

const ROW_HEIGHT = 30;

/** Before the scroller has been measured, the first rows are drawn so the table never paints empty. */
function visibleRows(items: { index: number; start: number }[], count: number): { index: number; start: number }[] {
  if (items.length || count === 0) return items;
  return Array.from({ length: Math.min(count, 40) }, (_, i) => ({ index: i, start: i * ROW_HEIGHT }));
}

function EditableCell({ value, label, editable, onCommit }: { value: string; label: string; editable: boolean; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (editing !== null)
    return (
      <input
        className="df-input"
        aria-label={label}
        autoFocus
        dir="auto"
        value={editing}
        onChange={(e) => setEditing(e.target.value)}
        onBlur={() => {
          if (editing !== value) onCommit(editing);
          setEditing(null);
        }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") setEditing(null);
        }}
      />
    );
  return (
    <span
      className="df-value"
      dir="auto"
      tabIndex={editable ? 0 : -1}
      role={editable ? "button" : undefined}
      aria-label={editable ? `${label}: ${value}` : undefined}
      onDoubleClick={() => editable && setEditing(value)}
      onKeyDown={(e) => {
        if (editable && (e.key === "Enter" || e.key === "F2")) {
          e.preventDefault();
          setEditing(value);
        }
      }}
    >
      {value}
    </span>
  );
}

export function DataTableView({ table, onEdit }: { table: DataTable; onEdit: (row: number, column: string, value: string) => void }) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const virtual = useVirtualizer({ count: table.rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_HEIGHT, overscan: 20, initialRect: { width: 800, height: 600 } });
  const dir = firstStrongDirection(table.columns.join(" ") + " " + (table.rows[0] ?? []).join(" ")) ?? "ltr";
  const template = `repeat(${Math.max(1, table.columns.length)}, minmax(8rem, 1fr))`;
  return (
    <div className="df-table" dir={dir} role="table" aria-rowcount={table.rows.length + 1} aria-colcount={table.columns.length}>
      <div className="df-row df-head" role="row" style={{ gridTemplateColumns: template }}>
        {table.columns.map((c, k) => (
          <span key={k} role="columnheader" className="df-cell" dir="auto">
            {c}
          </span>
        ))}
      </div>
      {/* The height is inline, not only in CSS: the virtualizer needs a bounded scroller to draw only what is on screen. */}
      <div ref={scroller} className="df-scroll" data-testid="data-scroll" style={{ maxHeight: "calc(100vh - 120px)", overflow: "auto" }}>
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {visibleRows(virtual.getVirtualItems(), table.rows.length).map((v) => (
            <div
              key={v.index}
              role="row"
              aria-rowindex={v.index + 2}
              className="df-row"
              style={{ position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, top: v.start, height: ROW_HEIGHT, gridTemplateColumns: template }}
            >
              {table.columns.map((c, k) => (
                <span key={k} role="cell" className="df-cell">
                  <EditableCell value={table.rows[v.index][k] ?? ""} label={`${c || k + 1} ${v.index + 1}`} editable={table.editable} onCommit={(val) => onEdit(v.index, c, val)} />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Records grouped by one column's values; a record with no value goes to "None", as in Obsidian Bases. */
export function DataKanbanView({ table, groupBy }: { table: DataTable; groupBy: string }) {
  const k = table.columns.indexOf(groupBy);
  const groups = useMemo(() => {
    const m = new Map<string, number[]>();
    table.rows.forEach((r, i) => {
      const key = (r[k] ?? "").trim();
      m.set(key, [...(m.get(key) ?? []), i]);
    });
    return [...m.entries()].slice(0, 60);
  }, [table, k]);
  const title = (row: string[]) => row.find((v, j) => j !== k && v.trim()) ?? "";
  return (
    <div className="df-kanban" dir="auto">
      {groups.map(([key, rows]) => ( // empty-allow: the lane of rows without a value (its label)
        <section key={key} className="df-lane" aria-label={`${key || t("fileViewer.data.none")} (${rows.length})`}>
          <h3 dir="auto">
            {/* empty-allow: the lane of rows without a value (its heading) */}
            {key || t("fileViewer.data.none")} <span className="df-count">{rows.length}</span>
          </h3>
          <ul>
            {rows.slice(0, 200).map((i) => (
              <li key={i} dir="auto">
                {title(table.rows[i])}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
