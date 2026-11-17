/**
 * The overlay that shows a notebook, a data file or a map file (plan W12.F4,
 * F5, F7), opened from the file tree or any `lumen-open-file` event. It reads
 * the file from the workspace, hands it to the viewer for its kind, and
 * offers "Open as text" and, where it makes sense, "Convert to note" (the
 * conversion the app did before, unchanged).
 */
import "./strings";
import "./FileViewer.css";
import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { explainError } from "../lib/userError";
import type { FileView } from "./fileViewers";
import { NotebookError, parseNotebook, type Notebook } from "./notebook";
import { NotebookView } from "./NotebookView";
import { dataFormatOf, parseDataText, writeCell, type DataTable } from "./dataFile";
import { DataKanbanView, DataTableView } from "./DataFileView";
import { parseGeoFile, type GeoCollection } from "./geoFile";
import { GeoFileView } from "./GeoFileView";
import { Modal } from "../ui/Modal";

type Loaded =
  | { kind: "notebook"; text: string; notebook: Notebook }
  | { kind: "data"; text: string; table: DataTable }
  | { kind: "geo"; text: string; geo: GeoCollection };

export interface FileViewerIo {
  readText: (path: string) => Promise<string>;
  readBytes: (path: string) => Promise<ArrayBuffer>;
  writeText: (path: string, text: string) => Promise<void>;
}

const workspaceIo: FileViewerIo = {
  readText: async (p) => (await import("../storage/workspace")).readWorkspaceFile(p),
  readBytes: async (p) => (await (await import("../storage/workspace")).readWorkspaceBlob(p)).arrayBuffer(),
  writeText: async (p, text) => (await import("../storage/workspace")).writeWorkspaceFile(p, text),
};

export async function loadFileView(view: Pick<FileView, "kind" | "path">, io: FileViewerIo): Promise<Loaded> {
  if (view.kind === "notebook") {
    const text = await io.readText(view.path);
    return { kind: "notebook", text, notebook: parseNotebook(text) };
  }
  if (view.kind === "geo") {
    const text = await io.readText(view.path);
    return { kind: "geo", text, geo: parseGeoFile(view.path, text) };
  }
  const format = dataFormatOf(view.path);
  if (format === "xlsx") {
    const { xlsxSheets } = await import("../storage/officeFormats");
    const sheet = (await xlsxSheets(await io.readBytes(view.path)))[0];
    const rows = sheet?.rows ?? [];
    const width = Math.max(0, ...rows.map((r) => r.length));
    const pad = (r: string[]) => Array.from({ length: width }, (_, k) => r[k] ?? "");
    return { kind: "data", text: "", table: { format, columns: pad(rows[0] ?? []), rows: rows.slice(1).map(pad), editable: false, readOnlyReason: "xlsx" } };
  }
  const text = await io.readText(view.path);
  return { kind: "data", text, table: parseDataText(format ?? "csv", text) };
}

interface Props {
  view: FileView;
  onClose: () => void;
  /** Open the file in the editor as text. */
  onOpenAsText: (path: string, text: string) => void;
  io?: FileViewerIo;
}

function Viewer({ view, onClose, onOpenAsText, io = workspaceIo }: Props) {
  const [state, setState] = useState<{ loaded?: Loaded; error?: string }>({});
  const [mode, setMode] = useState<"table" | "kanban">("table");
  const [groupBy, setGroupBy] = useState<string>("");
  const [status, setStatus] = useState("");
  const name = view.path.split("/").pop() ?? view.path;

  useEffect(() => {
    let live = true;
    setState({});
    loadFileView(view, io).then(
      (loaded) => live && setState({ loaded }),
      (e) => live && setState({ error: e instanceof NotebookError ? e.message : explainError(e) }),
    );
    return () => {
      live = false;
    };
  }, [view, io]);

  const onEdit = useCallback(
    async (row: number, column: string, value: string) => {
      const l = state.loaded;
      if (l?.kind !== "data" || !l.table.editable) return;
      const next = writeCell(l.table.format, l.text, row, column, value, l.table.columns);
      if (next === null) return;
      try {
        await io.writeText(view.path, next);
        setState({ loaded: { kind: "data", text: next, table: parseDataText(l.table.format as "csv", next) } });
        setStatus(t("fileViewer.data.saved"));
      } catch (e) {
        setStatus(t("fileViewer.failed", { error: explainError(e) }));
      }
    },
    [state.loaded, io, view.path],
  );

  const convert = useCallback(async () => {
    const l = state.loaded;
    if (!l) return;
    const ff = await import("../storage/fileFormats");
    const md =
      l.kind === "notebook"
        ? ff.ipynbToMarkdown(l.text)
        : l.kind === "data"
          ? [`| ${l.table.columns.join(" | ")} |`, `| ${l.table.columns.map(() => "---").join(" | ")} |`, ...l.table.rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`)].join("\n")
          : "";
    const ws = await import("../storage/workspace");
    const path = await ws.uniqueWorkspaceName(view.path.replace(/\.[^./]+$/, ".md"));
    await ws.createWorkspaceFile(path, md);
    onClose();
    window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path } }));
  }, [state.loaded, view.path, onClose]);

  const l = state.loaded;
  return (
    <Modal className="fv-overlay" aria-label={name} onClose={onClose}>
      <header className="fv-toolbar">
        <h2 dir="auto">{name}</h2>
        {l?.kind === "data" && (
          <>
            <button type="button" aria-pressed={mode === "table"} onClick={() => setMode("table")}>
              {t("fileViewer.data.table")}
            </button>
            <button type="button" aria-pressed={mode === "kanban"} onClick={() => setMode("kanban")}>
              {t("fileViewer.data.kanban")}
            </button>
            {mode === "kanban" && (
              <label>
                {t("fileViewer.data.groupBy")}{" "}
                <select value={groupBy || l.table.columns[0]} onChange={(e) => setGroupBy(e.target.value)}>
                  {l.table.columns.map((c, k) => (
                    <option key={k} value={c}>
                      {c || k + 1}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="fv-meta">{t("fileViewer.data.rows", { n: l.table.rows.length })}</span>
            {!l.table.editable && <span className="fv-meta">{t("fileViewer.data.readOnly")}</span>}
          </>
        )}
        <span className="fv-spacer" />
        <span role="status" className="fv-meta">
          {status}
        </span>
        {l && l.kind !== "geo" && (
          <button type="button" onClick={() => void convert()}>
            {t("fileViewer.convert")}
          </button>
        )}
        {l && l.text !== "" && (
          <button type="button" onClick={() => onOpenAsText(view.path, l.text)}>
            {t("fileViewer.asText")}
          </button>
        )}
        <button type="button" onClick={onClose} aria-label={t("fileViewer.close")}>
          ✕
        </button>
      </header>
      <main className="fv-body">
        {state.error && <p role="alert">{t("fileViewer.failed", { error: state.error })}</p>}
        {!l && !state.error && <p>{t("fileViewer.loading")}</p>}
        {l?.kind === "notebook" && <NotebookView notebook={l.notebook} />}
        {l?.kind === "data" && (mode === "table" ? <DataTableView table={l.table} onEdit={(r, c, v) => void onEdit(r, c, v)} /> : <DataKanbanView table={l.table} groupBy={groupBy || l.table.columns[0]} />)}
        {l?.kind === "geo" && <GeoFileView geo={l.geo} />}
      </main>
    </Modal>
  );
}

export function FileViewerOverlay(props: Props) {
  return (
    <ErrorBoundary
      fallback={
        <div className="fv-overlay" role="alert">
          <p>{t("errorBoundary.heading")}</p>
          <button type="button" onClick={props.onClose}>
            {t("fileViewer.close")}
          </button>
        </div>
      }
    >
      <Viewer {...props} />
    </ErrorBoundary>
  );
}

export default FileViewerOverlay;
