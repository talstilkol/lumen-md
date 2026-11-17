/**
 * BasesBlock — an Obsidian Bases file (plan W1.11) in a note: a ```base
 * block, `![[Books.base]]` (or `![[Books.base#View]]`), or a `.base` file
 * opened in the editor. Shows its views — table, cards, list, kanban, map —
 * over the whole workspace, with the file's filters, formulas, sort, groups,
 * limit and summaries (./base.ts).
 *
 * Plan W1.12 adds relations and rollups (./base.ts), calendar and timeline
 * views whose drag (or Alt + arrow keys) changes only the date property of
 * the note, a virtual table for big views, and CSV export / import.
 *
 * Clicking a column header sorts; for an embedded base, "Save this sort"
 * writes it back to the `.base` file with only that view's `sort:` changed.
 * Loaded lazily with the preview's code blocks (never in the startup
 * bundle); the map view loads Leaflet only when it is shown.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertCircle } from "lucide-react";
import { basesFileFromText, basesLatLng, moveFilter, parseBase, runBase, setViewSort, viewKind, type BaseModel, type BaseResult, type BaseRow, type BasesSort, type FilterScope } from "./base";
import { applyKanbanSet, coverOf, coverStyle, kanbanColumns, kanbanGrouping, kanbanKeyTarget, planKanbanMove, type KanbanColumn } from "./kanban";
import { filterKeyTarget, filterRows, type FilterRow } from "./filterRows";
import { parseBaseEmbedMeta } from "./embed";
import { toText, type BasesFile, type BValue } from "./values";
import type { DatabaseRow } from "../database";
import { isOPFSAvailable, listWorkspace, readWorkspaceFile, writeWorkspaceFile } from "../../storage/workspace";
import { onWorkspaceChanged } from "../../storage/workspaceEvents";
import { useAppStore } from "../../store/useStore";
import { editNote } from "../databaseEdit";
import { selectRows } from "../bulkEdit";
import { tableKeyMove, visibleWindow, writableKey } from "./viewsData";
import { showAiToast } from "../../ui/AiToast";
import { log } from "../../lib/logger";
import { getLocale, isRTL, t } from "../../i18n";
import "./basesBlockStrings";
import { explainError } from "../../lib/userError";
import { EmptyState, learnHow } from "../../ui/EmptyState";
import { downloadCsv, importCsv } from "./basesCsv";
import { nameCell, openFile, type ViewProps } from "./basesCells";
import { CalendarView, TimelineView } from "./basesTimeViews";
import { useVisibleRefresh } from "../../lib/visibleRefresh";
// W13.G9: "Open as graph" — the dialog loads when the button is pressed.
import { OpenAsGraph } from "../../ui/graph/OpenAsGraph";

const DatabaseMapView = lazy(() => import("../DatabaseMapView"));
// Bulk property editing (W7.4): the same bar as the database block, loaded on the first selection.
const BulkEditBar = lazy(() => import("../BulkEditBar"));
// W12.V1: the chart view loads ECharts and its strings only when it is shown.
const BaseChartView = lazy(() => import("../../viz/BaseChartView"));
// W12.V5: the Hebrew-calendar view, loaded when shown.
const BaseHebrewCalendarView = lazy(() => import("../../viz/BaseHebrewCalendarView"));

const muted = "hsl(var(--fg-muted))";
const isRtl = () => typeof document !== "undefined" && document.documentElement.dir === "rtl";
const danger = "hsl(var(--danger))";

/** Every file of the workspace, as Bases sees it (notes with their text, attachments without). */
async function loadVault(): Promise<BasesFile[]> {
  if (!isOPFSAvailable()) return [];
  const entries = await listWorkspace({ includeAssets: false });
  const out: BasesFile[] = [];
  for (const e of entries) {
    const isNote = /\.(md|markdown)$/i.test(e.path);
    let text: string | null = null;
    if (isNote) {
      try {
        text = await readWorkspaceFile(e.path);
      } catch {
        continue;
      }
    }
    out.push(basesFileFromText(e.path, text, { size: e.size, mtime: e.modified ? new Date(e.modified) : null }));
  }
  return out;
}

/** `Books.base` → the workspace path: exact, else by name (Obsidian resolves embeds by name). */
function findBase(files: readonly { path: string }[], target: string): string | null {
  const want = target.replace(/^\/+/, "").toLowerCase();
  const exact = files.find((f) => f.path.toLowerCase() === want);
  if (exact) return exact.path;
  const byName = files.find((f) => f.path.toLowerCase().endsWith(`/${want}`));
  return byName?.path ?? null;
}

/**
 * `select` (W12.T3, a type's page): the rows come from these paths, chosen
 * by the type registry, instead of the base's own `filters:`.
 */
export default function BasesBlock({ source, meta, select }: { source: string; meta?: string; select?: (files: readonly BasesFile[]) => ReadonlySet<string> }) {
  const embed = useMemo(() => parseBaseEmbedMeta(meta), [meta]);
  const activePath = useAppStore((s) => s.doc.workspaceName ?? null);
  const [files, setFiles] = useState<BasesFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [embedded, setEmbedded] = useState<{ path: string; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [sortOverride, setSortOverride] = useState<BasesSort[] | null>(null);
  /** Notes selected in the table for a bulk edit (W7.4); the .base file itself is never written by it. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);
  // W12.V6: off screen (a long dashboard), a vault change waits until the base is seen again.
  const [rootRef, schedule] = useVisibleRefresh();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const vault = await loadVault();
      if (cancelled) return;
      setFiles(vault);
      if (embed) {
        const all = isOPFSAvailable() ? await listWorkspace({ includeAssets: false }) : [];
        const path = findBase(all, embed.path);
        if (!path) {
          if (!cancelled) setLoadError(t("base.notFound", { path: embed.path }));
          return;
        }
        const text = await readWorkspaceFile(path);
        if (!cancelled) {
          setEmbedded({ path, text });
          setLoadError(null);
        }
      }
    };
    setLoading(true);
    load()
      .catch((e: Error) => {
        log.warn("base: load failed", e);
        if (!cancelled) setLoadError(explainError(e));
      })
      .finally(() => !cancelled && setLoading(false));
    const off = onWorkspaceChanged(() => schedule(() => void load().catch(() => undefined)), { debounceMs: 500 });
    return () => {
      cancelled = true;
      off();
    };
  }, [embed, schedule]);

  const text = embed ? (embedded?.text ?? null) : source;
  const parsed = useMemo(() => (text === null ? null : parseBase(text)), [text]);
  const base: BaseModel | null = parsed?.ok ? parsed.base : null;
  const initialView = useMemo(() => {
    if (!base || !embed?.view) return 0;
    const i = base.views.findIndex((v) => v.name === embed.view);
    return i < 0 ? 0 : i;
  }, [base, embed]);
  const current = viewIndex ?? initialView;
  // `this`: the note that embeds the base, or the .base file itself when it is the open document.
  const thisFile = useMemo(() => files.find((f) => f.path === activePath) ?? null, [files, activePath]);

  const result: BaseResult | null = useMemo(() => {
    if (!base) return null;
    const views = sortOverride ? base.views.map((v, i) => (i === current ? { ...v, sort: sortOverride } : v)) : base.views;
    if (select) return runBase({ ...base, views, filters: undefined }, files, { view: current, thisFile, only: select(files) });
    return runBase({ ...base, views }, files, { view: current, thisFile });
  }, [base, files, current, sortOverride, thisFile, select]);

  if (loadError || (parsed && !parsed.ok)) {
    return (
      <div className="chart-block" style={{ padding: "1rem" }} data-testid="base-block">
        <div role="alert" style={{ color: danger, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }} dir="auto">
          <AlertCircle size={14} />
          {loadError ?? t("base.error", { error: parsed && !parsed.ok ? parsed.error : "" })}
        </div>
      </div>
    );
  }
  if (!base || !result) {
    return (
      <div className="chart-block" style={{ padding: "1rem", color: muted, fontSize: 12 }} data-testid="base-block">
        {t("db.loading")}
      </div>
    );
  }

  const kind = viewKind(result.view);
  const order = result.rows.map((r) => r.file.path);
  const shownSelected = result.rows.filter((r) => selected.has(r.file.path) && r.file.ext === "md");
  const rowSelect: TableSelect = {
    has: (p) => selected.has(p),
    click: (p, e) => {
      const next = selectRows(order, selected, anchorRef.current, p, { shift: e.shiftKey, toggle: true });
      anchorRef.current = next.anchor;
      setSelected(next.selected);
    },
    toggleAll: () => setSelected(shownSelected.length === result.rows.length ? new Set() : new Set(order)),
    count: shownSelected.length,
    total: result.rows.length,
  };
  const noteKeys = [...new Set(result.columns.map((c) => writableKey(c.id)).filter((k): k is string => !!k))];
  const clickSort = (id: string) => {
    const cur = (sortOverride ?? result.view.sort)[0];
    setSortOverride([{ property: id, direction: cur?.property === id && cur.direction === "ASC" ? "DESC" : "ASC" }]);
  };
  const canSave = !!embedded && !!sortOverride && embedded.path !== activePath;
  const save = async () => {
    if (!embedded || !sortOverride) return;
    const w = setViewSort(embedded.text, current, sortOverride);
    if (!w.ok) return showAiToast(t("base.error", { error: w.error }), "error");
    try {
      await writeWorkspaceFile(embedded.path, w.text);
      setEmbedded({ path: embedded.path, text: w.text });
      setSortOverride(null);
      showAiToast(t("base.saved", { file: embedded.path }));
    } catch (e) {
      showAiToast(t("base.error", { error: explainError(e) }), "error");
    }
  };
  const fileLabel = embedded?.path ?? (activePath?.toLowerCase().endsWith(".base") ? activePath : null);
  // W12.T5: the filter order is written to the .base file: the embedded file, or the .base open in the editor.
  const filterFile = embedded?.path ?? (!embed && !select && activePath?.toLowerCase().endsWith(".base") ? activePath : null);
  const filtersEditable = !!filterFile && text !== null;
  const reorderFilters = async (from: FilterScope & { index: number }, to: FilterScope & { index: number }) => {
    if (!filterFile || text === null) return;
    const w = moveFilter(text, from, to);
    if (!w.ok) return showAiToast(t("base.error", { error: w.error }), "error");
    try {
      if (embedded) {
        await writeWorkspaceFile(embedded.path, w.text);
        setEmbedded({ path: embedded.path, text: w.text });
      } else await editNote(filterFile, () => w.text);
      showAiToast(t("base.filters.saved", { file: filterFile }));
    } catch (e) {
      showAiToast(t("base.error", { error: explainError(e) }), "error");
    }
  };

  return (
    <div ref={rootRef} className="chart-block lumen-base" data-testid="base-block" data-view-kind={kind}>
      <div className="chart-block-header">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600 }} dir="auto">
            {fileLabel ? fileLabel.replace(/^.*\//, "").replace(/\.base$/i, "") : result.view.name}
          </span>
          <span style={{ fontSize: 11, color: muted }} data-testid="base-count">
            {result.total > result.rows.length ? t("base.limited", { count: result.rows.length, total: result.total }) : t("db.count", { count: result.rows.length })}
          </span>
          {loading && <span style={{ fontSize: 11, color: muted }}>· {t("db.loading")}</span>}
          <button type="button" onClick={() => downloadCsv(result, fileLabel ?? result.view.name)} style={{ fontSize: 11 }} data-testid="base-csv-export">
            {t("base.csv.export")}
          </button>
          <button type="button" onClick={() => void importCsv(base, fileLabel ?? result.view.name, files)} style={{ fontSize: 11 }} data-testid="base-csv-import">
            {t("base.csv.import")}
          </button>
          {result.rows.length > 0 && <OpenAsGraph label={t("base.openAsGraph")} title={fileLabel ? fileLabel.replace(/^.*\//, "").replace(/\.base$/i, "") : result.view.name} rows={() => result.rows.map((r) => r.file)} testId="base-open-graph" />}
        </span>
        {base.views.length > 1 && (
          <div className="chart-block-tabs" role="tablist" aria-label={t("db.views")}>
            {base.views.map((v, i) => (
              <button
                key={`${i}-${v.name}`}
                type="button"
                role="tab"
                aria-selected={i === current}
                className={i === current ? "active" : ""}
                onClick={() => {
                  setViewIndex(i);
                  setSortOverride(null);
                }}
                dir="auto"
              >
                {v.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {result.errors.length > 0 && (
        <div role="alert" style={{ paddingInline: 8, paddingBlockStart: 4, color: danger, fontSize: 11 }} data-testid="base-errors">
          <div>{t("base.problems")}</div>
          {result.errors.slice(0, 5).map((e) => (
            <div key={e} dir="auto">
              {e}
            </div>
          ))}
        </div>
      )}
      {filtersEditable && <FiltersPanel base={base} view={current} onMove={(from, to) => void reorderFilters(from, to)} />}
      {canSave && (
        <div style={{ paddingInline: 8, paddingBlockStart: 4 }}>
          <button type="button" onClick={() => void save()} style={{ fontSize: 11 }}>
            {t("base.saveSort", { file: embedded!.path })}
          </button>
        </div>
      )}
      {kind === "table" && shownSelected.length > 0 && (
        <Suspense fallback={null}>
          <BulkEditBar
            selected={shownSelected.map((r) => ({ path: r.file.path, fm: r.file.fm }))}
            allRows={files.filter((f) => f.ext === "md").map((f) => ({ path: f.path, fm: f.fm }))}
            fields={noteKeys}
            onClear={() => setSelected(new Set())}
          />
        </Suspense>
      )}
      <div style={{ padding: 8 }}>
        {result.rows.length === 0 && !loading && <EmptyState style={{ padding: 24, alignItems: "center", fontSize: 13 }} message={t("db.empty")} action={learnHow("workspace/obsidian-bases#three-ways-to-show-a-base")} />}
        {result.rows.length > 0 && kind === "table" && <TableView result={result} files={files} sort={sortOverride ?? result.view.sort} onSort={clickSort} select={rowSelect} />}
        {result.rows.length > 0 && kind === "calendar" && <CalendarView result={result} files={files} />}
        {result.rows.length > 0 && kind === "timeline" && <TimelineView result={result} files={files} />}
        {result.rows.length > 0 && kind === "cards" && <CardsView result={result} files={files} />}
        {result.rows.length > 0 && kind === "list" && <ListView result={result} files={files} />}
        {result.rows.length > 0 && kind === "kanban" && <KanbanView result={result} files={files} />}
        {result.rows.length > 0 && kind === "chart" && (
          <Suspense fallback={<div style={{ padding: 12, fontSize: 12, color: muted }}>{t("db.loading")}</div>}>
            <BaseChartView base={base} result={result} dir={isRTL() ? "rtl" : "ltr"} locale={getLocale()} />
          </Suspense>
        )}
        {result.rows.length > 0 && kind === "hebrew-calendar" && (
          <Suspense fallback={<div style={{ padding: 12, fontSize: 12, color: muted }}>{t("db.loading")}</div>}>
            <BaseHebrewCalendarView result={result} dir={isRTL() ? "rtl" : "ltr"} locale={getLocale()} />
          </Suspense>
        )}
        {result.rows.length > 0 && kind === "map" && (
          <Suspense fallback={<div style={{ padding: 12, fontSize: 12, color: muted }}>{t("db.loading")}</div>}>
            <MapView result={result} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

/**
 * The filter rows of the file (W12.T5, Obsidian 1.15): drag a row to
 * reorder it, Alt+ArrowUp/Down to move it, and a button moves it between
 * All views and This view. Every move is written into the `.base` with
 * `moveFilter`, which keeps the rest of the file as written.
 */
export function FiltersPanel({ base, view, onMove }: { base: BaseModel; view: number; onMove: (from: FilterScope & { index: number }, to: FilterScope & { index: number }) => void }) {
  const rows = filterRows(base, view);
  const [drag, setDrag] = useState<FilterRow | null>(null);
  if (!rows.all.length && !rows.view.length) return null;
  const list = (title: string, items: FilterRow[], scope: FilterScope, other: FilterScope, otherLabel: string) => (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, marginBlock: 4 }}>{title}</div>
      <ol style={{ margin: 0, paddingInlineStart: 18 }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
        e.preventDefault();
        if (drag && (drag.scope.view !== scope.view)) onMove({ ...drag.scope, index: drag.index }, { ...scope, index: items.length });
        setDrag(null);
      }} data-scope={scope.view === null ? "all" : "view"}>
        {items.map((r) => (
          <li
            key={`${r.index}-${r.text}`}
            draggable
            tabIndex={0}
            data-filter={r.index}
            aria-description={t("base.filters.drag")}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              setDrag(r);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (drag && !(drag.scope.view === r.scope.view && drag.index === r.index)) onMove({ ...drag.scope, index: drag.index }, { ...r.scope, index: r.index });
              setDrag(null);
            }}
            onKeyDown={(e) => {
              const to = filterKeyTarget(e.key, e.altKey, r, items.length);
              if (to === null) return;
              e.preventDefault();
              onMove({ ...r.scope, index: r.index }, { ...r.scope, index: to });
            }}
            style={{ fontSize: 11, cursor: "grab", paddingBlock: 2 }}
          >
            <code dir="ltr">{r.text}</code>{" "}
            <button type="button" style={{ fontSize: 10 }} onClick={() => onMove({ ...r.scope, index: r.index }, { ...other, index: other.view === null ? rows.all.length : rows.view.length })}>
              {otherLabel}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
  return (
    <details style={{ paddingInline: 8, fontSize: 11 }} data-testid="base-filters">
      <summary>{t("base.filters.title")}</summary>
      {list(t("base.filters.all"), rows.all, { view: null }, { view }, t("base.filters.moveToView"))}
      {list(t("base.filters.view"), rows.view, { view }, { view: null }, t("base.filters.moveToAll"))}
    </details>
  );
}


function groupLabel(key: BValue): string {
  return key === null ? t("db.none") : toText(key);
}

/** Row height of the virtual table, and the number of rows above which it virtualizes. */
const ROW_H = 28;
const VIRTUAL_FROM = 200;

type TableItem = { kind: "group"; key: BValue; count: number } | { kind: "row"; row: BaseRow };

/** The rows picked for a bulk edit (W7.4). */
interface TableSelect {
  has: (path: string) => boolean;
  click: (path: string, e: { shiftKey: boolean }) => void;
  toggleAll: () => void;
  count: number;
  total: number;
}

const NO_SELECT: TableSelect = { has: () => false, click: () => undefined, toggleAll: () => undefined, count: 0, total: 0 };

export function TableView({ result, files, sort, onSort, select = NO_SELECT }: ViewProps & { sort: BasesSort[]; onSort: (id: string) => void; select?: TableSelect }) {
  const cols = result.columns;
  // W12.T3: one cell is in the tab order (roving tabindex); arrows move it, as the text runs.
  const [focus, setFocus] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const rowList = useMemo(() => (result.groups ? result.groups.flatMap((g) => g.rows) : result.rows), [result]);
  const rowAt = useMemo(() => new Map(rowList.map((r, i) => [r, i])), [rowList]);
  const onCellKey = (e: ReactKeyboardEvent<HTMLTableCellElement>, row: number, col: number) => {
    if (e.key === "Enter" && (cols[col].id === "file.name" || cols[col].id === "file.basename")) {
      e.preventDefault();
      openFile(rowList[row].file.path);
      return;
    }
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl" || isRtl();
    const next = tableKeyMove(e.key, { ctrl: e.ctrlKey || e.metaKey, rtl }, { row, col }, { rows: rowList.length, cols: cols.length });
    if (!next) return;
    e.preventDefault();
    setFocus(next);
    const scroller = e.currentTarget.closest("[data-testid=base-table-scroll]");
    if (virtual && scroller) {
      const index = items.findIndex((it) => it.kind === "row" && it.row === rowList[next.row]);
      // Spacer rows keep the scrollbar true, so a row's top is its item index × the row height.
      const top = index * ROW_H;
      if (top < scroller.scrollTop || top > scroller.scrollTop + viewport - ROW_H) scroller.scrollTop = Math.max(0, top - viewport / 2);
    }
    requestAnimationFrame(() => (scroller?.querySelector(`[data-cell="${next.row}:${next.col}"]`) as HTMLElement | null)?.focus());
  };
  const summaryIds = Object.keys(result.summaries);
  const items: TableItem[] = useMemo(() => {
    const out: TableItem[] = [];
    for (const g of result.groups ?? [{ key: null, rows: result.rows }]) {
      if (result.groups) out.push({ kind: "group", key: g.key, count: g.rows.length });
      for (const row of g.rows) out.push({ kind: "row", row });
    }
    return out;
  }, [result]);
  // Big views draw only the rows in sight (plan W1.12: 10,000 rows); spacer rows keep the scrollbar true.
  const virtual = items.length > VIRTUAL_FROM;
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const viewport = 480;
  const win = virtual ? visibleWindow(items.length, ROW_H, scrollTop, viewport) : { start: 0, end: items.length };
  const cell = { padding: "4px 6px", borderBlockEnd: "1px solid hsl(var(--border))", blockSize: virtual ? ROW_H - 9 : undefined, whiteSpace: virtual ? ("nowrap" as const) : undefined, overflow: "hidden", textOverflow: "ellipsis" };
  return (
    <div ref={scroller} style={{ overflow: "auto", maxBlockSize: virtual ? viewport : undefined }} onScroll={virtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined} data-testid="base-table-scroll" data-virtual={virtual || undefined}>
      <table role="grid" style={{ inlineSize: "100%", borderCollapse: "collapse", fontSize: 12 }} aria-rowcount={virtual ? items.length + 1 : undefined}>
        <thead style={virtual ? { position: "sticky", insetBlockStart: 0, background: "hsl(var(--bg))", zIndex: 1 } : undefined}>
          <tr>
            <th scope="col" style={{ inlineSize: 24, padding: "4px 6px", borderBlockEnd: "1px solid hsl(var(--border))" }}>
              <input
                type="checkbox"
                checked={select.total > 0 && select.count === select.total}
                onChange={() => select.toggleAll()}
                aria-label={t("base.select.all", { n: String(select.total) })}
                data-testid="base-select-all"
                style={{ margin: 0 }}
              />
            </th>
            {cols.map((c) => {
              const s = sort[0]?.property === c.id ? sort[0].direction : null;
              return (
                <th key={c.id} scope="col" aria-sort={s === "ASC" ? "ascending" : s === "DESC" ? "descending" : "none"} style={{ textAlign: "start", padding: "4px 6px", borderBlockEnd: "1px solid hsl(var(--border))" }}>
                  <button type="button" onClick={() => onSort(c.id)} style={{ all: "unset", cursor: "pointer", fontWeight: 600 }} dir="auto">
                    {c.label}
                    {s === "ASC" ? " ▲" : s === "DESC" ? " ▼" : ""}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {virtual && win.start > 0 && <tr aria-hidden style={{ blockSize: win.start * ROW_H }} />}
          {items.slice(win.start, win.end).map((it, i) =>
            it.kind === "group" ? (
              <tr key={`g${win.start + i}`} aria-rowindex={virtual ? win.start + i + 2 : undefined}>
                <th colSpan={cols.length + 1} scope="colgroup" style={{ textAlign: "start", fontSize: 11, color: muted, padding: "8px 4px 4px", blockSize: virtual ? ROW_H - 12 : undefined }} dir="auto">
                  {groupLabel(it.key)} <span style={{ fontWeight: 400, opacity: 0.7 }}>{it.count}</span>
                </th>
              </tr>
            ) : (
              <tr key={it.row.file.path} data-path={it.row.file.path} aria-rowindex={virtual ? win.start + i + 2 : undefined} aria-selected={select.has(it.row.file.path)}>
                <td style={cell}>
                  {it.row.file.ext === "md" && (
                    <input
                      type="checkbox"
                      checked={select.has(it.row.file.path)}
                      onChange={() => undefined}
                      onClick={(e) => select.click(it.row.file.path, e)}
                      aria-label={t("base.select.row", { note: it.row.file.basename })}
                      data-testid="base-select-row"
                      style={{ margin: 0 }}
                    />
                  )}
                </td>
                {cols.map((c, ci) => {
                  const ri = rowAt.get(it.row) ?? -1;
                  const here = ri === focus.row && ci === focus.col;
                  return (
                    <td key={c.id} style={cell} tabIndex={here ? 0 : -1} data-cell={`${ri}:${ci}`} onKeyDown={(e) => onCellKey(e, ri, ci)} onFocus={() => (here ? undefined : setFocus({ row: ri, col: ci }))}>
                      {nameCell(it.row, c.id, files)}
                    </td>
                  );
                })}
              </tr>
            ),
          )}
          {virtual && win.end < items.length && <tr aria-hidden style={{ blockSize: (items.length - win.end) * ROW_H }} />}
        </tbody>
        {summaryIds.length > 0 && (
          <tfoot>
            <tr>
              <td />
              {cols.map((c) => (
                <td key={c.id} style={{ padding: "4px 6px", fontWeight: 600 }} data-testid={summaryIds.includes(c.id) ? `base-summary-${c.id}` : undefined}>
                  {summaryIds.includes(c.id) ? toText(result.summaries[c.id]) : null}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export function CardsView({ result, files }: ViewProps) {
  const image = result.view.image;
  const size = result.view.cardSize ?? 160;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))`, gap: 8 }} data-testid="base-cards">
      {result.rows.map((r) => (
        <div key={r.file.path} data-path={r.file.path} style={{ border: "1px solid hsl(var(--border))", borderRadius: 6, padding: 8, fontSize: 12 }}>
          {image && <Cover value={r.cells[image] ?? null} view={result.view} files={files} />}
          {result.columns.map((c) => (
            <div key={c.id}>{nameCell(r, c.id, files)}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ListView({ result, files }: ViewProps) {
  const [first, ...rest] = result.columns;
  return (
    <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 13 }}>
      {result.rows.map((r) => (
        <li key={r.file.path} data-path={r.file.path}>
          {nameCell(r, first.id, files)}
          {rest.map((c) => (
            <span key={c.id} style={{ color: muted }}>
              {" · "}
              <Cell value={r.cells[c.id]} files={files} />
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

/** A cover image (W12.T5): Obsidian's Image property, Image fit and Image aspect ratio. */
function Cover({ value, view, files }: { value: BValue; view: BaseResult["view"]; files: readonly BasesFile[] }) {
  const c = coverOf(value);
  if (!c) return null;
  const st = coverStyle(view);
  const box = { inlineSize: "100%", display: "block", ...(st.ratio ? { aspectRatio: `1 / ${st.ratio}` } : { maxBlockSize: 120 }), borderRadius: 4, marginBlockEnd: 4 } as const;
  if ("color" in c) return <div data-testid="base-cover" data-fit={st.fit} style={{ ...box, blockSize: st.ratio ? undefined : 60, background: c.color }} />;
  if ("link" in c) {
    // A vault image: shown by name until the attachment loader resolves it (W12.T5 owes vault image covers).
    const f = files.find((x) => x.path === c.link || x.name === c.link || x.basename === c.link);
    return f ? <div data-testid="base-cover" data-fit={st.fit} data-link={f.path} style={{ ...box, blockSize: st.ratio ? undefined : 60, background: "hsl(var(--bg-subtle))" }} aria-label={f.name} /> : null;
  }
  return <img data-testid="base-cover" data-fit={st.fit} src={c.src} alt="" loading="lazy" style={{ ...box, objectFit: st.fit }} />;
}

/** Drop a card on a column (W12.T5): writes the grouped property, or moves the file for file.folder. */
async function dropCard(row: BaseRow, property: string, column: KanbanColumn) {
  const move = planKanbanMove(row, property, column);
  const label = column.key ?? t("base.kanban.none");
  if (move.kind === "refuse") {
    if (move.reason === "same") return;
    return showAiToast(move.reason === "notMarkdown" ? t("base.kanban.notMarkdown") : t("base.kanban.readOnly", { property }), "error");
  }
  try {
    if (move.kind === "set") await editNote(move.path, (text) => applyKanbanSet(text, move));
    else {
      const { safeMove } = await import("../../storage/fileOps");
      if (!(await safeMove(move.from, move.to))) return;
      const { notifyWorkspaceChanged } = await import("../../storage/workspaceEvents");
      notifyWorkspaceChanged({ kind: "structure", paths: [move.from, move.to] });
    }
    showAiToast(t("base.kanban.moved", { name: row.file.basename, column: label }));
  } catch (e) {
    showAiToast(t("base.moveFailed", { error: explainError(e) }), "error");
  }
}

export function KanbanView({ result, files, onDrop = dropCard }: ViewProps & { onDrop?: (row: BaseRow, property: string, column: KanbanColumn) => void | Promise<void> }) {
  const [dragging, setDragging] = useState<string | null>(null);
  if (!result.groups || !result.view.groupBy) return <div style={{ padding: 12, fontSize: 12, color: muted }}>{t("db.kanban.needGroup")}</div>;
  const property = result.view.groupBy.property;
  const grouping = kanbanGrouping(property);
  const movable = grouping.kind !== "readOnly";
  const columns = kanbanColumns(result);
  const width = result.view.cardSize ?? 180;
  const byPath = new Map(columns.flatMap((c) => c.rows.map((r) => [r.file.path, r] as const)));
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto" }} data-testid="base-kanban" data-movable={movable || undefined}>
      {!movable && (
        <p role="note" style={{ fontSize: 11, color: muted, margin: 0 }} dir="auto">
          {t("base.kanban.readOnly", { property })}
        </p>
      )}
      {columns.map((col, ci) => (
        <section
          key={`${ci}-${col.key ?? "∅"}`}
          /* empty-allow: the column of notes without a value (its label) */
          aria-label={col.key ?? t("base.kanban.none")}
          data-column={col.key ?? ""}
          onDragOver={movable ? (e) => e.preventDefault() : undefined}
          onDrop={
            movable
              ? (e) => {
                  e.preventDefault();
                  const row = byPath.get(e.dataTransfer.getData("text/x-lumen-path") || dragging || "");
                  setDragging(null);
                  if (row) void onDrop(row, property, col);
                }
              : undefined
          }
          style={{ minInlineSize: width, flex: `1 0 ${width}px`, background: "hsl(var(--bg-subtle))", borderRadius: 6, padding: 6 }}
        >
          <h4 style={{ margin: "0 0 6px", fontSize: 12 }} dir="auto">
            {/* empty-allow: the column of notes without a value (its heading) */}
            {col.key ?? t("base.kanban.none")} <span style={{ fontWeight: 400, color: muted }}>{col.rows.length}</span>
          </h4>
          {col.rows.map((r) => (
            <div
              key={r.file.path}
              data-path={r.file.path}
              draggable={movable}
              tabIndex={0}
              aria-roledescription={movable ? t("base.kanban.card") : undefined}
              aria-description={movable ? t("base.kanban.cardHint") : undefined}
              onDragStart={
                movable
                  ? (e) => {
                      e.dataTransfer.setData("text/x-lumen-path", r.file.path);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(r.file.path);
                    }
                  : undefined
              }
              onKeyDown={(e) => {
                if (!movable) return;
                const rtl = getComputedStyle(e.currentTarget).direction === "rtl" || isRtl();
                const to = kanbanKeyTarget(e.key, { alt: e.altKey, rtl }, ci, columns.length);
                if (to === null) return;
                e.preventDefault();
                void onDrop(r, property, columns[to]);
              }}
              style={{ background: "hsl(var(--bg))", border: "1px solid hsl(var(--border))", borderRadius: 4, padding: 6, marginBlockEnd: 6, fontSize: 12, cursor: movable ? "grab" : undefined }}
            >
              {result.view.image && <Cover value={r.cells[result.view.image] ?? null} view={result.view} files={files} />}
              {result.columns.map((c) => (
                <div key={c.id}>{nameCell(r, c.id, files)}</div>
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** The database map view, fed with this view's rows (coordinates from `coordinates:`, else `location`). */
function MapView({ result }: { result: BaseResult }) {
  const rows: DatabaseRow[] = useMemo(
    () =>
      result.rows.map((r) => {
        const pt = basesLatLng(r.cells[result.view.coordinates ?? "note.location"] ?? null) ?? basesLatLng(r.file.fm.location as BValue);
        const fm: Record<string, unknown> = { title: r.file.basename };
        for (const c of result.columns) if (c.id !== "file.name") fm[c.label] = toText(r.cells[c.id]);
        if (pt) fm.location = [pt.lat, pt.lng];
        return { path: r.file.path, basename: r.file.basename, fm };
      }),
    [result],
  );
  const fields = result.columns.filter((c) => c.id !== "file.name").map((c) => c.label);
  return <DatabaseMapView rows={rows} spec={{ location: "location" }} fields={fields} />;
}
