/**
 * W12.R3 — PDF highlights exported as Hebrew APA 7 quotations: each
 * highlight with its parenthetical, "(כהן ואחרים, 2020, עמ׳ 14)", from the
 * W11.H15 formatter (src/citations/cite.ts: no comma before the last ו,
 * "ואחרים", FSI … PDI around every parenthetical), and the reference list
 * at the end, Hebrew sources before English ones.
 *
 * The page is the printed page when the PDF has page labels (a scanned
 * book whose page 5 is printed "14"); otherwise the PDF page number.
 * Metadata comes from the citation library (Zotero, W5.23, or CSL-JSON):
 * a document with none is returned in `missing`, and the caller asks.
 */
import { bibliography, formatCluster, yearSuffixes, type CiteContext } from "../citations/cite";
import { runsToMarkdown, type CitationRecord } from "../data/citationStyles";
import type { CiteItem, Cluster } from "../citations/pandoc";
import { encodeWikiPath } from "../pdf/annotations";
import type { HighlightItem } from "./hub";
import { compareNames } from "../i18n/collate";

export interface SourceMeta {
  /** The citation key (library item key). */
  key: string;
  record: CitationRecord;
  /** PDF page number → the label printed on it (pdf.js page labels). */
  pageLabels?: Readonly<Record<number, string>>;
}

export interface ApaLabels {
  title: string;
  /** Heading of the reference list ("מקורות"). */
  references: string;
  /** "p. 3", "ch. 2": the link text back to the highlight. */
  where: (it: HighlightItem) => string;
}

export type ApaExport = { ok: true; markdown: string; cited: number } | { ok: false; missing: string[] };

const inline = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([\\`*_[\]<>|#~])/g, "\\$1");

/** The locator of a highlight: a printed page label when there is one, else the PDF page (PDF only). */
export function pageLocator(it: HighlightItem, meta: SourceMeta): CiteItem["locator"] {
  if (it.kind !== "pdf" || it.location === null) return null;
  return { label: "page", value: meta.pageLabels?.[it.location] ?? String(it.location) };
}

/** One highlight's parenthetical, Hebrew APA 7. */
export function highlightCitation(it: HighlightItem, meta: SourceMeta, ctx: Omit<CiteContext, "lookup">): string {
  const item: CiteItem = { key: meta.key, prefix: "", suffix: "", locator: pageLocator(it, meta), suppressAuthor: false };
  const cluster: Cluster = { start: 0, end: 0, items: [item], inText: false };
  return formatCluster(cluster, { ...ctx, lookup: (k) => (k === meta.key ? meta.record : undefined) }, `[@${meta.key}]`);
}

/**
 * The highlights as a note of APA quotations: a section per document, each
 * quote followed by its parenthetical and a link back to the highlight,
 * then the reference list.
 */
export function exportNoteApa(items: readonly HighlightItem[], metaOf: (source: string) => SourceMeta | null, labels: ApaLabels): ApaExport {
  const bySource = new Map<string, HighlightItem[]>();
  for (const it of items) bySource.set(it.source, [...(bySource.get(it.source) ?? []), it]);
  const metas = new Map<string, SourceMeta>();
  const missing: string[] = [];
  for (const source of bySource.keys()) {
    const m = metaOf(source);
    if (m) metas.set(source, m);
    else missing.push(source);
  }
  if (missing.length) return { ok: false, missing: missing.sort() };

  const cited = [...new Map([...metas.values()].map((m) => [m.key, { key: m.key, record: m.record }])).values()];
  const suffix = yearSuffixes(cited, "il");
  const ctx = { style: "il" as const, lang: "he" as const, suffix };
  const parts = [`# ${labels.title}`, ""];
  for (const [source, list] of [...bySource].sort((a, b) => compareNames(a[0], b[0]))) {
    const meta = metas.get(source)!;
    parts.push(`## [[${encodeWikiPath(source)}]]`, "");
    for (const it of [...list].sort((a, b) => (a.location ?? 0) - (b.location ?? 0))) {
      parts.push(`> ״${inline(it.text)}״ ${highlightCitation(it, meta, ctx)}`, `> — [[${it.link}|${inline(labels.where(it))}]]`, "");
    }
  }
  const groups = bibliography(cited, ctx);
  parts.push(`## ${labels.references}`, "");
  for (const g of groups) for (const e of g) parts.push(runsToMarkdown(e.runs), "");
  return { ok: true, markdown: parts.join("\n").replace(/\n+$/, "\n"), cited: cited.length };
}
