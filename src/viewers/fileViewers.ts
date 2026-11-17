/**
 * Files that open in a viewer of their own instead of as text (plan W12.F4,
 * F5, F7): a Jupyter notebook in the notebook viewer, a data file (CSV, TSV,
 * JSON, YAML, XLSX) as a table, and GeoJSON or GPX on a map. PDF and EPUB
 * keep their readers (4.14, W1.14). Every viewer can still hand the file to
 * the editor ("Open as text") or convert it to a note.
 */
export type FileViewerKind = "notebook" | "data" | "geo";

export interface FileView {
  kind: FileViewerKind;
  path: string;
  seq: number;
}

/**
 * The viewer for a workspace path, or null for a file that opens as text.
 * Files in dot-folders (`.lumen/`, `.obsidian/`) are the app's own settings
 * and keep opening as text.
 */
export function fileViewerKind(path: string): FileViewerKind | null {
  if (/(^|\/)\.[^/]+\//.test(path)) return null;
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase();
  if (ext === "ipynb") return "notebook";
  if (ext === "csv" || ext === "tsv" || ext === "xlsx" || ext === "json" || ext === "yaml" || ext === "yml") return "data";
  if (ext === "geojson" || ext === "gpx") return "geo";
  return null;
}
