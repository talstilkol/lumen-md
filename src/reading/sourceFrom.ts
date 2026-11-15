/**
 * New source notes (plan W12.X2) from a citation-library item (Zotero's
 * export, W5.23, or any CSL-JSON / BibTeX entry) and from a page captured
 * in the browser. Both go through the type's own `newObjectText`, so the
 * note gets the type's defaults and is checked against it.
 */
import type { CitationRecord } from "../data/citationStyles";
import { newObjectText } from "../types/fieldValues";
import type { TypeRegistry } from "../types/typeRegistry";
import { frontmatterOf } from "./progress";
import { SOURCE_TYPE_ID, type SourceKind } from "./sourceType";

const KIND: Record<CitationRecord["type"], SourceKind> = {
  book: "book",
  chapter: "book",
  thesis: "book",
  article: "article",
  report: "article",
  misc: "article",
  web: "website",
};

function authorsText(r: CitationRecord): string | undefined {
  const names = r.authors.map((n) => [n.given, n.family].filter(Boolean).join(" ")).filter(Boolean);
  return names.length ? names.join(", ") : undefined;
}

/** Frontmatter values of a source for a library item. */
export function sourceValuesFromCitation(key: string, r: CitationRecord): Record<string, unknown> {
  const v: Record<string, unknown> = { kind: KIND[r.type] ?? "article", citekey: key };
  const author = authorsText(r);
  if (author) v.author = author;
  if (r.year) v.year = r.year;
  const url = r.url ?? (r.doi ? `https://doi.org/${r.doi}` : undefined);
  if (url) v.url = url;
  return v;
}

/** A page captured in the browser (title, URL, maybe an author). */
export interface CapturedPage {
  url: string;
  title?: string;
  author?: string;
  /** Its year of publication, when the page said. */
  year?: string;
  /** The vault path of the clip note it was saved in, linked from the source. */
  note?: string;
}

export function sourceValuesFromCapture(page: CapturedPage): Record<string, unknown> {
  return { kind: "website", url: page.url, ...(page.author ? { author: page.author } : {}), ...(page.year ? { year: page.year } : {}) };
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);

/** An http(s) URL, or null. */
export function webUrl(text: string | undefined): string | null {
  try {
    const u = new URL((text ?? "").trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * The captured page a clip note holds (the web clipper's frontmatter:
 * `source:` its URL, `title:`, `author:`, `published:`); null when the note
 * is not a clip of a web page.
 */
export function captureFromNote(text: string, path?: string): CapturedPage | null {
  const fm = frontmatterOf(text);
  const url = webUrl(str(fm.source) ?? str(fm.url));
  if (!url) return null;
  const heading = /^#\s+(.+)$/m.exec(text.replace(/^---\n[\s\S]*?\n---\n/, ""))?.[1]?.trim();
  const year = /\b(1[5-9]\d\d|2\d\d\d)\b/.exec(str(fm.published) ?? "")?.[1];
  const author = str(fm.author);
  return { url, title: str(fm.title) ?? heading, ...(author ? { author } : {}), ...(year ? { year } : {}), ...(path ? { note: path } : {}) };
}

export interface NewSource {
  /** A file name for the note (no folder), from the title. */
  name: string;
  text: string;
}

const fileName = (title: string): string =>
  (title.replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "source") + ".md";

/** A source note for a library item; null when the type refuses the values. */
export function sourceNoteFromCitation(reg: TypeRegistry, key: string, r: CitationRecord): NewSource | null {
  const made = newObjectText(reg, SOURCE_TYPE_ID, { values: sourceValuesFromCitation(key, r), body: `# ${r.title}\n` });
  return made.ok ? { name: fileName(r.title), text: made.text } : null;
}

/** A source note for a captured page; null when the type refuses the values. */
export function sourceNoteFromCapture(reg: TypeRegistry, page: CapturedPage): NewSource | null {
  const title = page.title?.trim() || page.url;
  const clip = page.note ? `\n[[${page.note.replace(/\.md$/i, "")}]]\n` : "";
  const made = newObjectText(reg, SOURCE_TYPE_ID, { values: sourceValuesFromCapture(page), body: `# ${title}\n\n<${page.url}>\n${clip}` });
  return made.ok ? { name: fileName(title), text: made.text } : null;
}
