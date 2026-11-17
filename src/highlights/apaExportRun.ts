/**
 * W12.R3 — "Export with APA citations" from the highlights panel: finds
 * each document's metadata in the citation library (Zotero, W5.23, or
 * CSL-JSON / BibTeX files), asks for the ones it cannot match, remembers
 * the answer per document on this device, and writes the note.
 */
import { t } from "../i18n";
import { exportNoteApa, type SourceMeta } from "./apaExport";
import type { HighlightItem } from "./hub";

const KEY = "lumen.highlights.citeKeys";

function remembered(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function remember(source: string, key: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...remembered(), [source]: key }));
  } catch {
    /* why: private mode; the choice is asked again next time */
  }
}

/** Writes the APA note and returns its path; null when the user cancelled a metadata question. */
export async function runApaExport(items: readonly HighlightItem[], whereLabel: (it: HighlightItem) => string): Promise<string | null> {
  const [{ loadLibrary, searchLibrary }, { uiSelect }, ws, { notifyWorkspaceChanged }] = await Promise.all([
    import("../citations/library"),
    import("../ui/PromptDialog"),
    import("../storage/workspace"),
    import("../storage/workspaceEvents"),
  ]);
  const library = await loadLibrary();
  const byKey = new Map(library.map((i) => [i.key, i]));
  const keys = remembered();
  const metas = new Map<string, SourceMeta>();
  for (const source of new Set(items.map((i) => i.source))) {
    let key = keys[source];
    if (!key || !byKey.has(key)) {
      const name = source.replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, "");
      const options = (searchLibrary(library, name).length ? searchLibrary(library, name) : library).slice(0, 50);
      if (!options.length) throw new Error(t("hl.apaNoLibrary"));
      const picked = await uiSelect({ message: t("hl.apaWhich", { source: name }), choices: options.map((o) => ({ value: o.key, label: `${o.record.authors[0]?.family ?? ""} ${o.record.year ?? ""} — ${o.record.title}`.trim() })) });
      if (!picked) return null;
      key = picked;
      remember(source, key);
    }
    metas.set(source, { key, record: byKey.get(key)!.record });
  }
  // Scanned books: the page printed on the page ("עמ׳ 14"), from the PDF's /PageLabels, not its index.
  const { withPageLabels } = await import("./pageLabels");
  await withPageLabels(metas, items, async (source) => new Uint8Array(await (await ws.readWorkspaceBlob(source)).arrayBuffer()));
  const date = new Date().toISOString().slice(0, 10);
  const r = exportNoteApa(items, (s) => metas.get(s) ?? null, { title: t("hl.apaTitle", { date, n: items.length }), references: t("hl.apaReferences"), where: whereLabel });
  if (!r.ok) return null;
  const path = await ws.uniqueWorkspaceName(`${t("hl.exportName", { date })}.md`);
  await ws.writeWorkspaceFile(path, r.markdown);
  notifyWorkspaceChanged();
  return path;
}
