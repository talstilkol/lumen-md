/**
 * Zotero by file (plan W5.23, the path without api.zotero.org): the user
 * exports from Zotero (File → Export Library…, or a collection's Export)
 * and imports the file here; for the other direction Lumen writes a file
 * that Zotero's File → Import reads. Nothing is fetched and no origin is
 * added to the CSP: the Web API route needs api.zotero.org in connect-src,
 * which this plan does not widen.
 *
 * Formats read: CSL JSON (Zotero's "CSL JSON"), BibTeX / BibLaTeX (Zotero's
 * own and Better BibTeX's, the citation key kept) and RIS. Formats written:
 * CSL JSON (Zotero imports it losslessly for what a citation needs) and RIS
 * (also for EndNote and Mendeley).
 *
 * The import merges into the vault's Zotero copy
 * (`.lumen/zotero-library.csl.json`, the file the cite dialog already
 * reads): an item is matched by its citation key, then its Zotero id, then
 * its DOI, then title + year. A second import of the same library changes
 * only what changed; items missing from the file are reported, and removed
 * only when the user says so (a collection's export is not the library).
 */
import { parseBibtex, type BibEntry } from "../data/bibtex";
import { recordFromBibtex, type CitationRecord, type Name } from "../data/citationStyles";
import { keyFromNote, type CslItem, type CslName } from "./csl";

export type ZoteroFileFormat = "csl-json" | "bibtex" | "ris";

/** The format of an exported file, from its text (the name is only a tie-breaker). */
export function detectFormat(name: string, text: string): ZoteroFileFormat | null {
  const head = text.replace(/^﻿/, "").trimStart();
  if (head.startsWith("[") || head.startsWith("{")) return "csl-json";
  if (/^TY {2}- /m.test(head.slice(0, 4096))) return "ris";
  if (/^@\w+\s*\{/m.test(head.slice(0, 65536)) || /\.(bib|biblatex)$/i.test(name)) return "bibtex";
  return null;
}

/* ─── BibTeX → CSL ───────────────────────────────────────────────────── */

const BIB_TYPE: Record<CitationRecord["type"], string> = { book: "book", article: "article-journal", chapter: "chapter", thesis: "thesis", report: "report", web: "webpage", misc: "document" };

const cslNameOf = (n: Name): CslName => (n.given || n.suffix ? { family: n.family, given: n.given, suffix: n.suffix } : { literal: n.family });

/** A citation record as CSL JSON, keyed `key`. */
export function recordToCsl(key: string, r: CitationRecord): CslItem {
  const item: CslItem = { id: key, "citation-key": key, type: BIB_TYPE[r.type] ?? "document", title: r.title };
  if (r.authors.length) item.author = r.authors.map(cslNameOf);
  if (r.editors?.length) item.editor = r.editors.map(cslNameOf);
  if (r.year) item.issued = /^\d{4}$/.test(r.year) ? { "date-parts": [[Number(r.year)]] } : { raw: r.year };
  if (r.container) item["container-title"] = r.container;
  if (r.publisher) item.publisher = r.publisher;
  if (r.volume) item.volume = r.volume;
  if (r.issue) item.issue = r.issue;
  if (r.pages) item.page = r.pages.replace(/–/g, "-");
  if (r.doi) item.DOI = r.doi;
  if (r.url) item.URL = r.url;
  if (r.edition) item.edition = r.edition;
  return item;
}

const bibToCsl = (e: BibEntry): CslItem => {
  const item = recordToCsl(e.key, recordFromBibtex(e));
  const lang = e.fields.langid ?? e.fields.language;
  if (lang) item.language = lang;
  return item;
};

/* ─── RIS ────────────────────────────────────────────────────────────── */

const RIS_TYPE: Record<string, string> = { BOOK: "book", JOUR: "article-journal", MGZN: "article-magazine", NEWS: "article-newspaper", CHAP: "chapter", CONF: "paper-conference", CPAPER: "paper-conference", THES: "thesis", RPRT: "report", ELEC: "webpage", WEB: "webpage", ENCYC: "entry-encyclopedia", GEN: "document" };
const RIS_OUT: Record<string, string> = { book: "BOOK", "article-journal": "JOUR", "article-magazine": "MGZN", "article-newspaper": "NEWS", chapter: "CHAP", "paper-conference": "CONF", thesis: "THES", report: "RPRT", webpage: "ELEC", "entry-encyclopedia": "ENCYC" };

const risName = (s: string): CslName => {
  const [family, given] = s.split(",").map((x) => x.trim());
  return given ? { family, given } : { literal: family };
};

/** RIS records → CSL items. Unknown tags are ignored; a record without a title is dropped. */
export function parseRis(text: string): CslItem[] {
  const out: CslItem[] = [];
  let cur: Record<string, string[]> | null = null;
  const flush = () => {
    if (!cur) return;
    const one = (t: string) => cur![t]?.[0]?.trim();
    const title = one("TI") ?? one("T1") ?? one("CT") ?? one("BT");
    if (title) {
      const item: CslItem = { id: one("ID") ?? `ris-${out.length + 1}`, type: RIS_TYPE[one("TY") ?? ""] ?? "document", title };
      const authors = [...(cur.AU ?? []), ...(cur.A1 ?? [])].map(risName);
      if (authors.length) item.author = authors;
      const editors = [...(cur.ED ?? []), ...(cur.A2 ?? [])].map(risName);
      if (editors.length) item.editor = editors;
      const year = (one("PY") ?? one("Y1") ?? one("DA"))?.match(/\d{4}/)?.[0];
      if (year) item.issued = { "date-parts": [[Number(year)]] };
      const container = one("T2") ?? one("JO") ?? one("JF") ?? one("JA");
      if (container && container !== title) item["container-title"] = container;
      if (one("PB")) item.publisher = one("PB");
      if (one("VL")) item.volume = one("VL");
      if (one("IS")) item.issue = one("IS");
      const sp = one("SP");
      const ep = one("EP");
      if (sp) item.page = ep ? `${sp}-${ep}` : sp;
      if (one("DO")) item.DOI = one("DO")!.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
      if (one("UR")) item.URL = one("UR");
      if (one("ET")) item.edition = one("ET");
      if (one("LA")) item.language = one("LA");
      const key = (cur.N1 ?? []).map((n) => keyFromNote(n)).find(Boolean);
      if (key) item["citation-key"] = key;
      out.push(item);
    }
    cur = null;
  };
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])  - ?(.*)$/.exec(raw);
    if (!m) continue;
    const [, tag, value] = m;
    if (tag === "TY") {
      flush();
      cur = { TY: [value] };
    } else if (tag === "ER") flush();
    else if (cur) (cur[tag] ??= []).push(value);
  }
  flush();
  return out;
}

const risNameOut = (n: CslName) => (n.literal ? n.literal : [n.family, n.given].filter(Boolean).join(", "));

/** CSL items → RIS (Zotero, EndNote, Mendeley read it). The citation key goes in a note. */
export function toRis(items: readonly CslItem[]): string {
  const lines: string[] = [];
  for (const it of items) {
    const tag = (t: string, v: unknown) => {
      if (v !== undefined && v !== null && String(v).trim()) lines.push(`${t}  - ${String(v).replace(/\r?\n/g, " ")}`);
    };
    tag("TY", RIS_OUT[it.type ?? ""] ?? "GEN");
    tag("TI", it.title);
    for (const a of it.author ?? []) tag("AU", risNameOut(a));
    for (const e of it.editor ?? []) tag("ED", risNameOut(e));
    tag("PY", it.issued?.["date-parts"]?.[0]?.[0] ?? it.issued?.raw?.match(/\d{4}/)?.[0]);
    tag("T2", it["container-title"]);
    tag("PB", it.publisher);
    tag("VL", it.volume);
    tag("IS", it.issue);
    const [sp, ep] = String(it.page ?? "").split(/\s*[-–]\s*/);
    tag("SP", sp);
    tag("EP", ep);
    tag("DO", it.DOI);
    tag("UR", it.URL);
    tag("ET", it.edition);
    tag("LA", it.language);
    if (it["citation-key"]) tag("N1", `Citation Key: ${it["citation-key"]}`);
    lines.push("ER  - ", "");
  }
  return lines.join("\r\n");
}

/* ─── Reading an export ──────────────────────────────────────────────── */

export class ZoteroFileError extends Error {
  constructor(readonly reason: "format" | "empty" | "json") {
    super(reason);
  }
}

/** The items of an exported file. Throws ZoteroFileError when it is not one of the formats, or holds none. */
export function parseZoteroExport(name: string, text: string): { format: ZoteroFileFormat; items: CslItem[] } {
  const format = detectFormat(name, text);
  if (!format) throw new ZoteroFileError("format");
  let items: CslItem[];
  if (format === "csl-json") {
    let data: unknown;
    try {
      data = JSON.parse(text.replace(/^﻿/, ""));
    } catch {
      throw new ZoteroFileError("json");
    }
    const list = Array.isArray(data) ? data : ((data as { items?: unknown[] })?.items ?? []);
    items = list.filter((x): x is CslItem => !!x && typeof x === "object" && typeof (x as CslItem).title === "string" && !!(x as CslItem).title);
  } else if (format === "bibtex") items = parseBibtex(text).map(bibToCsl);
  else items = parseRis(text);
  if (!items.length) throw new ZoteroFileError("empty");
  return { format, items };
}

/* ─── Merging into the vault's copy ──────────────────────────────────── */

const norm = (s: string) => s.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const yearOf = (it: CslItem) => String(it.issued?.["date-parts"]?.[0]?.[0] ?? it.issued?.raw?.match(/\d{4}/)?.[0] ?? "");

/** The identities an item is matched by, strongest first. */
export function identities(it: CslItem): string[] {
  const ids: string[] = [];
  const key = it["citation-key"] ?? keyFromNote(it.note);
  if (key) ids.push(`k:${key}`);
  if (it.id !== undefined && it.id !== "") ids.push(`i:${String(it.id)}`);
  if (it.DOI) ids.push(`d:${it.DOI.toLowerCase()}`);
  if (it.title) ids.push(`t:${norm(it.title)}|${yearOf(it)}`);
  return ids;
}

/** Stable JSON (sorted keys) to tell a changed item from an unchanged one. */
const canon = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v));

export interface MergeReport {
  items: CslItem[];
  added: number;
  updated: number;
  unchanged: number;
  /** Items of the old copy that the file does not have (kept unless `removeMissing`). */
  missing: number;
  removed: number;
}

/** Merges an export into the previous copy: order kept, new items appended, missing ones kept unless asked. */
export function mergeZoteroImport(prev: readonly CslItem[], incoming: readonly CslItem[], opts: { removeMissing?: boolean } = {}): MergeReport {
  const index = new Map<string, number>();
  prev.forEach((it, i) => {
    for (const id of identities(it)) if (!index.has(id)) index.set(id, i);
  });
  const next: Array<CslItem | null> = [...prev];
  const touched = new Set<number>();
  const appended: CslItem[] = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const it of incoming) {
    const at = identities(it).map((id) => index.get(id)).find((i) => i !== undefined && !touched.has(i));
    if (at === undefined) {
      appended.push(it);
      added++;
      continue;
    }
    touched.add(at);
    if (canon(prev[at]) === canon(it)) unchanged++;
    else {
      next[at] = it;
      updated++;
    }
  }
  const missingIdx = prev.map((_, i) => i).filter((i) => !touched.has(i));
  if (opts.removeMissing) for (const i of missingIdx) next[i] = null;
  return { items: [...next.filter((x): x is CslItem => x !== null), ...appended], added, updated, unchanged, missing: missingIdx.length, removed: opts.removeMissing ? missingIdx.length : 0 };
}
