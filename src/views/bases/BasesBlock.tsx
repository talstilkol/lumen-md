/**
 * BasesBlock — an Obsidian Bases file (plan W1.11) in a note: a ```base
 * block, `![[Books.base]]` (or `![[Books.base#View]]`), or a `.base` file
 * opened in the editor. Shows its views — table, cards, list, kanban, map —
 * over the whole workspace, with the file's filters, formulas, sort, groups,
 * limit and summaries (./base.ts).
 *
 * Clicking a column header sorts; for an embedded base, "Save this sort"
 * writes it back to the `.base` file with only that view's `sort:` changed.
 * Loaded lazily with the preview's code blocks (never in the startup
 * bundle); the map view loads Leaflet only when it is shown.
 */

import { lazy, Suspense, useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { basesFileFromText, basesLatLng, parseBase, runBase, setViewSort, viewKind, type BaseModel, type BaseResult, type BaseRow, type BasesSort } from "./base";
import { parseBaseEmbedMeta } from "./embed";
import { isTagged, toText, type BasesFile, type BValue } from "./values";
import type { DatabaseRow } from "../database";
import { isOPFSAvailable, listWorkspace, readWorkspaceFile, writeWorkspaceFile } from "../../storage/workspace";
import { onWorkspaceChanged } from "../../storage/workspaceEvents";
import { useAppStore } from "../../store/useStore";
import { showAiToast } from "../../ui/AiToast";
import { log } from "../../lib/logger";
import { t } from "../../i18n";

const DatabaseMapView = lazy(() => import("../DatabaseMapView"));

const muted = "hsl(var(--fg-muted))";
const danger = "hsl(0 80% 60%)";

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

function openFile(path: string) {
  window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path } }));
}

function FileLink({ path, label }: { path: string; label: string }) {
  return (
    <a
      href={`#${encodeURIComponent(path)}`}
      dir="auto"
      onClick={(e) => {
        e.preventDefault();
        openFile(path);
      }}
      style={{ color: "hsl(var(--accent))", textDecoration: "none", fontWeight: 500 }}
    >
      {label}
    </a>
  );
}

/** One value in a cell: files and links open, lists join, true / false as ✓ / ✗. */
function Cell({ value, files }: { value: BValue; files: readonly BasesFile[] }): JSX.Element | null {
  if (value === null) return null;
  if (typeof value === "boolean") return <span aria-label={String(value)}>{value ? "✓" : "✗"}</span>;
  if (Array.isArray(value))
    return (
      <>
        {value.map((v, i) => (
          <span key={i}>
            {i > 0 && ", "}
            <Cell value={v} files={files} />
          </span>
        ))}
      </>
    );
  if (isTagged(value)) {
    if (value.$ === "file") return <FileLink path={value.file.path} label={value.file.basename} />;
    if (value.$ === "link") {
      const target = files.find((f) => f.path === value.path || f.basename === value.path || f.path.replace(/\.md$/i, "") === value.path);
      return target ? <FileLink path={target.path} label={toText(value)} /> : <span dir="auto">{toText(value)}</span>;
    }
    if (value.$ === "image" && /^https:\/\//i.test(value.src)) return <img src={value.src} alt="" loading="lazy" style={{ maxInlineSize: 120, maxBlockSize: 80 }} />;
  }
  return <span dir="auto">{toText(value)}</span>;
}

function nameCell(row: BaseRow, id: string, files: readonly BasesFile[]): ReactNode {
  // file.name in the first column opens the note, as in Obsidian.
  if (id === "file.name" || id === "file.basename") return <FileLink path={row.file.path} label={row.file.ext === "md" ? row.file.basename : row.file.name} />;
  return <Cell value={row.cells[id]} files={files} />;
}

export default function BasesBlock({ source, meta }: { source: string; meta?: string }) {
  const embed = useMemo(() => parseBaseEmbedMeta(meta), [meta]);
  const activePath = useAppStore((s) => s.doc.workspaceName ?? null);
  const [files, setFiles] = useState<BasesFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [embedded, setEmbedded] = useState<{ path: string; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [sortOverride, setSortOverride] = useState<BasesSort[] | null>(null);

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
        if (!cancelled) setLoadError(e.message);
      })
      .finally(() => !cancelled && setLoading(false));
    const off = onWorkspaceChanged(() => void load().catch(() => undefined), { debounceMs: 500 });
    return () => {
      cancelled = true;
      off();
    };
  }, [embed]);

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
    return runBase({ ...base, views }, files, { view: current, thisFile });
  }, [base, files, current, sortOverride, thisFile]);

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
      showAiToast(t("base.error", { error: (e as Error)?.message ?? String(e) }), "error");
    }
  };
  const fileLabel = embedded?.path ?? (activePath?.toLowerCase().endsWith(".base") ? activePath : null);

  return (
    <div className="chart-block lumen-base" data-testid="base-block" data-view-kind={kind}>
      <div className="chart-block-header">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600 }} dir="auto">
            {fileLabel ? fileLabel.replace(/^.*\//, "").replace(/\.base$/i, "") : result.view.name}
          </span>
          <span style={{ fontSize: 11, color: muted }} data-testid="base-count">
            {result.total > result.rows.length ? t("base.limited", { count: result.rows.length, total: result.total }) : t("db.count", { count: result.rows.length })}
          </span>
          {loading && <span style={{ fontSize: 11, color: muted }}>· {t("db.loading")}</span>}
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
      {canSave && (
        <div style={{ paddingInline: 8, paddingBlockStart: 4 }}>
          <button type="button" onClick={() => void save()} style={{ fontSize: 11 }}>
            {t("base.saveSort", { file: embedded!.path })}
          </button>
        </div>
      )}
      <div style={{ padding: 8 }}>
        {result.rows.length === 0 && !loading && <div style={{ padding: 24, textAlign: "center", color: muted, fontSize: 13 }}>{t("db.empty")}</div>}
        {result.rows.length > 0 && kind === "table" && <TableView result={result} files={files} sort={sortOverride ?? result.view.sort} onSort={clickSort} />}
        {result.rows.length > 0 && kind === "cards" && <CardsView result={result} files={files} />}
        {result.rows.length > 0 && kind === "list" && <ListView result={result} files={files} />}
        {result.rows.length > 0 && kind === "kanban" && <KanbanView result={result} files={files} />}
        {result.rows.length > 0 && kind === "map" && (
          <Suspense fallback={<div style={{ padding: 12, fontSize: 12, color: muted }}>{t("db.loading")}</div>}>
            <MapView result={result} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

interface ViewProps {
  result: BaseResult;
  files: readonly BasesFile[];
}

function groupLabel(key: BValue): string {
  return key === null ? t("db.none") : toText(key);
}

function TableView({ result, files, sort, onSort }: ViewProps & { sort: BasesSort[]; onSort: (id: string) => void }) {
  const cols = result.columns;
  const sections = result.groups ?? [{ key: null, rows: result.rows }];
  const summaryIds = Object.keys(result.summaries);
  return (
    <div style={{ overflow: "auto" }}>
      <table style={{ inlineSize: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
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
          {sections.map((g, gi) => [
            result.groups ? (
              <tr key={`g${gi}`}>
                <th colSpan={cols.length} scope="colgroup" style={{ textAlign: "start", fontSize: 11, color: muted, padding: "8px 4px 4px" }} dir="auto">
                  {groupLabel(g.key)} <span style={{ fontWeight: 400, opacity: 0.7 }}>{g.rows.length}</span>
                </th>
              </tr>
            ) : null,
            ...g.rows.map((r) => (
              <tr key={r.file.path} data-path={r.file.path}>
                {cols.map((c) => (
                  <td key={c.id} style={{ padding: "4px 6px", borderBlockEnd: "1px solid hsl(var(--border))" }}>
                    {nameCell(r, c.id, files)}
                  </td>
                ))}
              </tr>
            )),
          ])}
        </tbody>
        {summaryIds.length > 0 && (
          <tfoot>
            <tr>
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

function CardsView({ result, files }: ViewProps) {
  const image = result.view.image;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
      {result.rows.map((r) => {
        const img = image ? r.cells[image] : null;
        const src = typeof img === "string" ? img : isTagged(img) && img.$ === "image" ? img.src : null;
        return (
          <div key={r.file.path} data-path={r.file.path} style={{ border: "1px solid hsl(var(--border))", borderRadius: 6, padding: 8, fontSize: 12 }}>
            {src && /^https:\/\//i.test(src) && <img src={src} alt="" loading="lazy" style={{ inlineSize: "100%", maxBlockSize: 120, objectFit: "cover" }} />}
            {result.columns.map((c) => (
              <div key={c.id}>{nameCell(r, c.id, files)}</div>
            ))}
          </div>
        );
      })}
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

function KanbanView({ result, files }: ViewProps) {
  if (!result.groups) return <div style={{ padding: 12, fontSize: 12, color: muted }}>{t("db.kanban.needGroup")}</div>;
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
      {result.groups.map((g, i) => (
        <section key={i} aria-label={groupLabel(g.key)} style={{ minInlineSize: 180, flex: "1 0 180px", background: "hsl(var(--bg-subtle))", borderRadius: 6, padding: 6 }}>
          <h4 style={{ margin: "0 0 6px", fontSize: 12 }} dir="auto">
            {groupLabel(g.key)} <span style={{ fontWeight: 400, color: muted }}>{g.rows.length}</span>
          </h4>
          {g.rows.map((r) => (
            <div key={r.file.path} data-path={r.file.path} style={{ background: "hsl(var(--bg))", border: "1px solid hsl(var(--border))", borderRadius: 4, padding: 6, marginBlockEnd: 6, fontSize: 12 }}>
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
