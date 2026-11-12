/**
 * DatabaseBlock — renders a ```database fenced block as one of four views
 * (table / kanban / gallery / calendar). Re-runs the workspace query when
 * the spec changes or when a `lumen-workspace-changed` event is dispatched
 * (so editing a note in another tab refreshes this view).
 */

import { useEffect, useMemo, useState } from "react";
import { Table2, Columns3, LayoutGrid, Calendar as CalendarIcon, AlertCircle } from "lucide-react";
import {
  parseDatabaseSpec,
  runDatabaseQuery,
  groupRows,
  displayValue,
  resolveFields,
  type DatabaseRow,
  type DatabaseSpec,
  type DatabaseView,
} from "./database";
import { log } from "../lib/logger";
import { onWorkspaceChanged } from "../storage/workspaceEvents";
import { useAppStore } from "../store/useStore";
import { dateCell, type DateCellOptions } from "../daily/dateCells";
import { deadlineText } from "../daily/DateHint";
import { defaultIsrael, holidaysOn } from "../daily/hebrewCalendar";
import { holidayLabel, nameLang } from "../daily/hebrewCalendarNames";
import { dayOfValue } from "../daily/israeliTime";

interface Props {
  source: string;
  meta?: string;
}

export default function DatabaseBlock({ source, meta }: Props) {
  const { spec, error: parseError } = useMemo(
    () => parseDatabaseSpec(source),
    [source],
  );
  const [rows, setRows] = useState<DatabaseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<DatabaseView>(spec?.view ?? "table");

  // Re-run the query when the spec changes OR the workspace changes.
  useEffect(() => {
    if (!spec) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    runDatabaseQuery(spec)
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        log.warn("database query failed", e);
        setError(e.message);
        setLoading(false);
      });
    function refresh() {
      if (!spec) return;
      runDatabaseQuery(spec)
        .then((r) => !cancelled && setRows(r))
        .catch(() => {});
    }
    const off = onWorkspaceChanged(refresh, { debounceMs: 500 });
    return () => {
      cancelled = true;
      off();
    };
  }, [spec]);

  if (parseError || !spec) {
    return (
      <div className="chart-block" style={{ padding: "1rem" }}>
        <div style={{ color: "hsl(0 80% 60%)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertCircle size={14} />
          Database spec error: {parseError ?? "invalid"}
        </div>
      </div>
    );
  }

  const fields = resolveFields(rows, spec);
  const titleLabel = spec.title ?? `${spec.type ?? "All"} · ${rows.length} item${rows.length === 1 ? "" : "s"}`;

  return (
    <div className="chart-block">
      <div className="chart-block-header">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{titleLabel}</span>
          {loading && <span style={{ fontSize: 11, color: "hsl(var(--fg-muted))" }}>· loading…</span>}
        </span>
        <div className="chart-block-tabs">
          <ViewTab cur={view} v="table" set={setView}><Table2 size={12} /> Table</ViewTab>
          <ViewTab cur={view} v="kanban" set={setView}><Columns3 size={12} /> Kanban</ViewTab>
          <ViewTab cur={view} v="gallery" set={setView}><LayoutGrid size={12} /> Gallery</ViewTab>
          <ViewTab cur={view} v="calendar" set={setView}><CalendarIcon size={12} /> Calendar</ViewTab>
        </div>
      </div>
      <div style={{ padding: 8 }}>
        {error && (
          <div style={{ padding: 12, color: "hsl(0 80% 60%)" }}>{error}</div>
        )}
        {!error && rows.length === 0 && !loading && (
          <div style={{ padding: 24, textAlign: "center", color: "hsl(var(--fg-muted))", fontSize: 13 }}>
            No notes match this query.
            <br />
            <span style={{ fontSize: 11, opacity: 0.7 }}>
              Add YAML frontmatter <code>type: {spec.type ?? "…"}</code> to notes under{" "}
              <code>{spec.source ?? "the workspace root"}</code>.
            </span>
          </div>
        )}
        {!error && rows.length > 0 && view === "table" && <TableView rows={rows} fields={fields} spec={spec} />}
        {!error && rows.length > 0 && view === "kanban" && <KanbanView rows={rows} spec={spec} fields={fields} />}
        {!error && rows.length > 0 && view === "gallery" && <GalleryView rows={rows} spec={spec} fields={fields} />}
        {!error && rows.length > 0 && view === "calendar" && <CalendarView rows={rows} spec={spec} />}
      </div>
      {meta && <div style={{ padding: "0 8px 6px", fontSize: 10, color: "hsl(var(--fg-muted))" }}>{meta}</div>}
    </div>
  );
}

/* ─── View toggle button ─────────────────────────────────────────────── */

function ViewTab({
  cur,
  v,
  set,
  children,
}: {
  cur: DatabaseView;
  v: DatabaseView;
  set: (v: DatabaseView) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`chart-block-tab ${cur === v ? "active" : ""}`}
      onClick={() => set(v)}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {children}
      </span>
    </button>
  );
}

function rowLink(row: DatabaseRow): JSX.Element {
  const title = (row.fm.title as string) ?? row.basename;
  return (
    <a
      href={`#${encodeURIComponent(row.path)}`}
      onClick={(e) => {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("lumen-open-file", { detail: { path: row.path } }),
        );
      }}
      style={{
        color: "hsl(var(--accent))",
        textDecoration: "none",
        fontWeight: 500,
      }}
    >
      {title}
    </a>
  );
}

/* ─── Table view ─────────────────────────────────────────────────────── */

/** Options for the date cells of this block: the UI locale and the calendar settings (plan W5.15). */
function useDateOptions(spec: DatabaseSpec): Omit<DateCellOptions, "deadline"> {
  const locale = useAppStore((s) => s.locale) as string;
  const settings = useAppStore((s) => s.dailyNotes);
  return { locale, settings, hebrewDates: spec.hebrewDate };
}

/** A cell's value: dates with their Hebrew date; the deadline column with its suggested working day and the working days left. */
function CellValue({ value, deadline, opts }: { value: unknown; deadline: boolean; opts: Omit<DateCellOptions, "deadline"> }) {
  const cell = dateCell(value, { ...opts, deadline });
  if (!cell) return <>{displayValue(value)}</>;
  const d = cell.deadline && deadlineText(cell.deadline);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 1 }}>
      <span>
        {cell.iso}
        {cell.hebrew && (
          <span lang="he" dir={opts.locale === "he" ? "rtl" : "auto"} style={{ marginInlineStart: 6, color: "hsl(var(--fg-muted))", fontSize: 11 }}>
            {cell.hebrew}
          </span>
        )}
      </span>
      {d?.moved && (
        <span role="note" data-testid="db-deadline-moved" style={{ fontSize: 11, color: "hsl(var(--warning, 35 90% 40%))" }}>
          ⚠ {d.moved}
        </span>
      )}
      {d && (
        <span data-testid="db-deadline-left" style={{ fontSize: 11, color: cell.deadline!.left < 0 ? "hsl(0 70% 50%)" : "hsl(var(--fg-muted))" }}>
          {d.left}
          {d.notes ? ` · ${d.notes}` : ""}
        </span>
      )}
    </span>
  );
}

function TableView({ rows, fields, spec }: { rows: DatabaseRow[]; fields: string[]; spec: DatabaseSpec }) {
  const opts = useDateOptions(spec);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}>Title</th>
            {fields.map((f) => (
              <th key={f} style={thStyle}>
                {f}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.path}>
              <td style={tdStyle}>{rowLink(r)}</td>
              {fields.map((f) => (
                <td key={f} style={tdStyle}>
                  <CellValue value={r.fm[f]} deadline={f === spec.deadline} opts={opts} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "start",
  padding: "6px 10px",
  borderBottom: "1px solid hsl(var(--border))",
  color: "hsl(var(--fg-muted))",
  fontWeight: 600,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};
const tdStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderBottom: "1px solid hsl(var(--border) / 0.5)",
  verticalAlign: "top",
};

/* ─── Kanban view ────────────────────────────────────────────────────── */

function KanbanView({
  rows,
  spec,
  fields,
}: {
  rows: DatabaseRow[];
  spec: DatabaseSpec;
  fields: string[];
}) {
  const groupBy = spec.groupBy;
  if (!groupBy) {
    return (
      <div style={{ padding: 12, color: "hsl(var(--fg-muted))", fontSize: 12 }}>
        Kanban needs a <code>groupBy:</code> column. Add one to the database spec.
      </div>
    );
  }
  const groups = groupRows(rows, groupBy);
  const columns = [...groups.keys()].sort((a, b) => {
    if (a === "_") return 1;
    if (b === "_") return -1;
    return a.localeCompare(b);
  });
  return (
    <div
      style={{
        display: "grid",
        gridAutoFlow: "column",
        gridAutoColumns: "minmax(220px, 1fr)",
        gap: 10,
        overflowX: "auto",
        paddingBottom: 6,
      }}
    >
      {columns.map((col) => (
        <div
          key={col}
          style={{
            background: "hsl(var(--bg-subtle))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            padding: 8,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "hsl(var(--fg-muted))",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 6,
              padding: "0 4px",
            }}
          >
            {col === "_" ? "(none)" : col}
            <span style={{ marginInlineStart: 6, fontWeight: 400, opacity: 0.7 }}>
              {groups.get(col)!.length}
            </span>
          </div>
          {groups.get(col)!.map((r) => (
            <div
              key={r.path}
              style={{
                background: "hsl(var(--bg))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                padding: "6px 8px",
                marginBottom: 6,
                fontSize: 12,
              }}
            >
              <div>{rowLink(r)}</div>
              {fields
                .filter((f) => f !== "title" && f !== groupBy)
                .slice(0, 3)
                .map((f) => (
                  <div
                    key={f}
                    style={{
                      fontSize: 11,
                      color: "hsl(var(--fg-muted))",
                      marginTop: 2,
                    }}
                  >
                    <span style={{ opacity: 0.7 }}>{f}:</span> {displayValue(r.fm[f])}
                  </div>
                ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ─── Gallery view ───────────────────────────────────────────────────── */

function GalleryView({
  rows,
  spec,
  fields,
}: {
  rows: DatabaseRow[];
  spec: DatabaseSpec;
  fields: string[];
}) {
  const coverField = spec.cover ?? "cover";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: 10,
      }}
    >
      {rows.map((r) => {
        const cover = r.fm[coverField];
        return (
          <div
            key={r.path}
            style={{
              background: "hsl(var(--bg-subtle))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {typeof cover === "string" && cover.startsWith("http") && (
              <div
                style={{
                  aspectRatio: "16/9",
                  background: `center / cover no-repeat url(${JSON.stringify(cover)})`,
                  borderBottom: "1px solid hsl(var(--border))",
                }}
              />
            )}
            <div style={{ padding: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                {rowLink(r)}
              </div>
              {fields
                .filter((f) => f !== "title" && f !== coverField)
                .slice(0, 4)
                .map((f) => (
                  <div
                    key={f}
                    style={{
                      fontSize: 11,
                      color: "hsl(var(--fg-muted))",
                      marginTop: 2,
                    }}
                  >
                    <span style={{ opacity: 0.7 }}>{f}:</span> {displayValue(r.fm[f])}
                  </div>
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Calendar view ──────────────────────────────────────────────────── */

function CalendarView({ rows, spec }: { rows: DatabaseRow[]; spec: DatabaseSpec }) {
  const opts = useDateOptions(spec);
  const dateField = spec.dateField;
  if (!dateField) {
    return (
      <div style={{ padding: 12, color: "hsl(var(--fg-muted))", fontSize: 12 }}>
        Calendar needs a <code>dateField:</code> column. Add one to the database spec.
      </div>
    );
  }
  // Bucket rows by ISO date (YYYY-MM-DD).
  const buckets = new Map<string, DatabaseRow[]>();
  for (const r of rows) {
    const v = r.fm[dateField];
    if (v == null) continue;
    const date = parseDate(v);
    if (!date) continue;
    const key = date.toISOString().slice(0, 10);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }
  if (buckets.size === 0) {
    return (
      <div style={{ padding: 12, color: "hsl(var(--fg-muted))", fontSize: 12 }}>
        No notes have a parseable <code>{dateField}</code> value.
      </div>
    );
  }
  // Render an agenda — sorted ascending by date.
  const sorted = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {sorted.map(([date, items]) => (
        <div
          key={date}
          style={{
            display: "grid",
            gridTemplateColumns: "100px 1fr",
            gap: 12,
            padding: 8,
            borderRadius: 6,
            background: "hsl(var(--bg-subtle))",
          }}
        >
          <CalendarDayHeader iso={date} opts={opts} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {items.map((r) => (
              <div key={r.path}>
                {rowLink(r)}
                {spec.deadline === dateField && <CalendarDeadline value={r.fm[dateField]} opts={opts} />}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A day in the agenda: the date, its Hebrew date and the day's holidays (plan W5.15). */
function CalendarDayHeader({ iso, opts }: { iso: string; opts: Omit<DateCellOptions, "deadline"> }) {
  const cell = dateCell(iso, opts);
  const day = dayOfValue(iso);
  const israel = opts.settings.israel ?? defaultIsrael(opts.locale);
  const holidays = day ? holidaysOn(day, { israel }).filter((h) => h.kind !== "roshChodesh") : [];
  return (
    <div style={{ fontSize: 11, color: "hsl(var(--fg-muted))", fontWeight: 600, display: "flex", flexDirection: "column", gap: 1 }}>
      <span>{iso}</span>
      {cell?.hebrew && (
        <span lang="he" dir={opts.locale === "he" ? "rtl" : "auto"} style={{ fontWeight: 400 }}>
          {cell.hebrew}
        </span>
      )}
      {holidays.length > 0 && <span style={{ fontWeight: 400 }}>{holidays.map((h) => holidayLabel(h, nameLang(opts.locale))).join(" · ")}</span>}
    </div>
  );
}

/** Under an item whose deadline is a day off: the suggested working day (plan W5.15). */
function CalendarDeadline({ value, opts }: { value: unknown; opts: Omit<DateCellOptions, "deadline"> }) {
  const cell = dateCell(value, { ...opts, deadline: true });
  const d = cell?.deadline && deadlineText(cell.deadline);
  if (!d?.moved) return null;
  return (
    <div role="note" data-testid="db-deadline-moved" style={{ fontSize: 11, color: "hsl(var(--warning, 35 90% 40%))" }}>
      ⚠ {d.moved} · {d.left}
    </div>
  );
}

function parseDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}
