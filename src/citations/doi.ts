/**
 * DOI lookup (plan 6.13, W10.E38): a DOI → a filled reference record, from
 * CrossRef's public REST API (api.crossref.org/works/<doi>). Switched off in
 * this version, pending the owner's approval of the CSP entry
 * (CROSSREF_LOOKUP_ENABLED below). Only the DOI
 * is sent, after the user approves the request, and through window.fetch,
 * which the privacy ledger wraps (its api.crossref.org rule, category
 * research: a local-only policy blocks it like the other research routes).
 * The record is the one Lumen's own APA / Chicago / MLA formatter reads
 * (data/citationStyles.ts).
 */
import type { CitationRecord, Name } from "../data/citationStyles";

export const CROSSREF_HOST = "api.crossref.org";

/**
 * Off until the owner approves adding api.crossref.org to the CSP's
 * connect-src (R8-L1: an allow-list change needs the owner; the host is not
 * in security/policy.json in this version). While it is false, lookupDoi
 * refuses before asking or sending anything, and "Cite from a DOI" says the
 * lookup is pending the owner's approval. To turn it on: add the host back to
 * security/policy.json, run `npm run headers:write`, and set this to true.
 */
export const CROSSREF_LOOKUP_ENABLED = false;

/** The lookup is switched off pending the owner's approval (CROSSREF_LOOKUP_ENABLED). */
export class DoiLookupPendingError extends Error {
  constructor() {
    super("DOI lookup via CrossRef is pending the owner's approval");
    this.name = "DoiLookupPendingError";
  }
}

/** "10.1234/abc", "doi:10.1234/abc", "https://doi.org/10.1234/abc" → "10.1234/abc"; null when it is not a DOI. */
export function normalizeDoi(input: string): string | null {
  const s = input.trim().replace(/^doi:\s*/i, "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  let decoded = s;
  try {
    decoded = decodeURIComponent(s);
  } catch {
    // why: a stray % is just part of the text; the pattern below decides
  }
  const m = /^(10\.\d{4,9}\/\S+)$/.exec(decoded);
  return m ? m[1].replace(/[.,;]+$/, "") : null;
}

type CrossrefDate = { "date-parts"?: Array<Array<number | null>> };
interface CrossrefPerson {
  given?: string;
  family?: string;
  name?: string;
  suffix?: string;
}
/** The fields of CrossRef's `message` for one work that a reference uses. */
export interface CrossrefWork {
  DOI?: string;
  type?: string;
  title?: string[];
  "container-title"?: string[];
  author?: CrossrefPerson[];
  editor?: CrossrefPerson[];
  issued?: CrossrefDate;
  "published-print"?: CrossrefDate;
  "published-online"?: CrossrefDate;
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  edition?: string;
  URL?: string;
}

const TYPES: Record<string, CitationRecord["type"]> = {
  "journal-article": "article",
  "proceedings-article": "article",
  book: "book",
  monograph: "book",
  "edited-book": "book",
  "reference-book": "book",
  "book-chapter": "chapter",
  "book-section": "chapter",
  "book-part": "chapter",
  dissertation: "thesis",
  report: "report",
  "posted-content": "misc",
  dataset: "misc",
};

const person = (p: CrossrefPerson): Name | null =>
  p.family ? { family: p.family.trim(), ...(p.given ? { given: p.given.trim() } : {}), ...(p.suffix ? { suffix: p.suffix } : {}) } : p.name ? { family: p.name.trim() } : null;

const yearOf = (...dates: Array<CrossrefDate | undefined>) => {
  for (const d of dates) {
    const y = d?.["date-parts"]?.[0]?.[0];
    if (typeof y === "number" && y > 0) return String(y);
  }
  return undefined;
};

const clean = (s: string | undefined) => (s ? s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : undefined);

/** CrossRef's work → the reference record (APA / Chicago / MLA read it). */
export function recordFromCrossref(w: CrossrefWork): CitationRecord {
  const authors = (w.author ?? []).map(person).filter((x): x is Name => !!x);
  const editors = (w.editor ?? []).map(person).filter((x): x is Name => !!x);
  const r: CitationRecord = { type: TYPES[w.type ?? ""] ?? "misc", authors, title: clean(w.title?.[0]) ?? "" };
  if (editors.length) r.editors = editors;
  const year = yearOf(w.issued, w["published-print"], w["published-online"]);
  if (year) r.year = year;
  const container = clean(w["container-title"]?.[0]);
  if (container) r.container = container;
  if (w.publisher) r.publisher = w.publisher;
  if (w.volume) r.volume = w.volume;
  if (w.issue) r.issue = w.issue;
  // CrossRef writes a hyphen; the formatter wants an en dash.
  if (w.page) r.pages = w.page.replace(/-+/g, "–");
  if (w.edition) r.edition = w.edition;
  if (w.DOI) r.doi = w.DOI;
  if (w.URL && !w.DOI) r.url = w.URL;
  return r;
}

export interface DoiDeps {
  /** Ask the user before anything is sent (uiConfirm). */
  confirm: (o: { title: string; message: string; okLabel: string }) => Promise<boolean>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** Tests: the lookup as it runs once approved (default CROSSREF_LOOKUP_ENABLED). */
  enabled?: boolean;
}

export class DoiNotFoundError extends Error {
  constructor(readonly doi: string) {
    super(`DOI not found: ${doi}`);
    this.name = "DoiNotFoundError";
  }
}

/** Look a DOI up on CrossRef, after the user's approval. null: declined. Throws DoiLookupPendingError while switched off. */
export async function lookupDoi(input: string, deps: DoiDeps): Promise<CitationRecord | null> {
  if (!(deps.enabled ?? CROSSREF_LOOKUP_ENABLED)) throw new DoiLookupPendingError();
  const doi = normalizeDoi(input);
  if (!doi) throw new Error(deps.t("cite.doi.invalid", { doi: input }));
  const ok = await deps.confirm({ title: deps.t("cite.doi.consent.title"), message: deps.t("cite.doi.consent.message", { doi, host: CROSSREF_HOST }), okLabel: deps.t("cite.doi.consent.ok") });
  if (!ok) return null;
  // privacy-ledger: research — window.fetch (wrapped by the ledger) to api.crossref.org only, the DOI in the path
  const res = await (deps.fetch ?? fetch)(`https://${CROSSREF_HOST}/works/${encodeURIComponent(doi)}`, { headers: { Accept: "application/json" }, signal: deps.signal });
  if (res.status === 404) throw new DoiNotFoundError(doi);
  if (!res.ok) throw new Error(`CrossRef ${res.status}`);
  const body = (await res.json()) as { status?: string; message?: CrossrefWork };
  if (!body?.message) throw new DoiNotFoundError(doi);
  return recordFromCrossref(body.message);
}
