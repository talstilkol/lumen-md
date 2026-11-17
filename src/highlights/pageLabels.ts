/**
 * W12.R3: the page number a citation should carry is the one printed on the
 * page, not the PDF's page index. A scanned book's PDF often starts with a
 * cover and roman-numbered front matter, so its 5th page is printed "14";
 * the PDF says so in its /PageLabels (ISO 32000 §12.4.2), which pdf.js reads
 * with `getPageLabels()`. `exportNoteApa` already used a page-label map when
 * one was given (src/highlights/apaExport.ts); the export from the
 * highlights panel never gave one. This reads it.
 */
import type { HighlightItem } from "./hub";
import type { SourceMeta } from "./apaExport";

/** pdf.js's labels (index 0 = page 1) → { page: label }, only where the label says something the index doesn't. */
export function labelsByPage(labels: readonly (string | null | undefined)[] | null | undefined): Record<number, string> | undefined {
  if (!labels?.length) return undefined;
  const out: Record<number, string> = {};
  labels.forEach((l, i) => {
    const label = (l ?? "").trim();
    if (label && label !== String(i + 1)) out[i + 1] = label;
  });
  return Object.keys(out).length ? out : undefined;
}

interface LabelledPdf {
  getPageLabels?: () => Promise<(string | null)[] | null>;
}

/** The printed page labels of a PDF, or undefined (none, or it can't be read: the index is used then). */
export async function pdfPageLabels(bytes: Uint8Array, open?: (data: Uint8Array) => Promise<{ doc: unknown; close: () => Promise<void> }>): Promise<Record<number, string> | undefined> {
  const openPdf = open ?? (await import("../pdf/pdfjs")).openPdf;
  let close: (() => Promise<void>) | null = null;
  try {
    const r = await openPdf(bytes);
    close = r.close;
    const doc = r.doc as LabelledPdf;
    return labelsByPage(doc.getPageLabels ? await doc.getPageLabels() : null);
  } catch {
    return undefined;
  } finally {
    await close?.().catch(() => undefined);
  }
}

/**
 * Add each PDF source's printed page labels to its metadata. `readBytes`
 * reads a source from the vault; a source it can't read keeps the index.
 */
export async function withPageLabels(
  metas: Map<string, SourceMeta>,
  items: readonly HighlightItem[],
  readBytes: (source: string) => Promise<Uint8Array>,
  open?: (data: Uint8Array) => Promise<{ doc: unknown; close: () => Promise<void> }>,
): Promise<Map<string, SourceMeta>> {
  const pdfSources = new Set(items.filter((i) => i.kind === "pdf" && /\.pdf$/i.test(i.source)).map((i) => i.source));
  for (const source of pdfSources) {
    const meta = metas.get(source);
    if (!meta || meta.pageLabels) continue;
    const bytes = await readBytes(source).catch(() => null);
    const pageLabels = bytes ? await pdfPageLabels(bytes, open) : undefined;
    if (pageLabels) metas.set(source, { ...meta, pageLabels });
  }
  return metas;
}
