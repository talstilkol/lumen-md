/**
 * "Cite from a DOI" through OpenAlex (decision D1 §6, 16.11.2026), while the
 * CrossRef lookup stays off (citations/doi.ts, CROSSREF_LOOKUP_ENABLED):
 * api.crossref.org is not in the CSP's connect-src, and adding it is the
 * owner's call. api.openalex.org already is (the W12.X3 reference lookup),
 * and OpenAlex's metadata is CC0 and comes largely from CrossRef itself.
 *
 * It is the same path as W12.X3, so it is off by default twice over:
 *  - Settings → Privacy → the OpenAlex switch is off by default; while it is
 *    off, this sends nothing and asks nothing (`off`);
 *  - with it on, every lookup still asks first; declined, nothing is sent.
 * Accepted, only the DOI goes to api.openalex.org through the window's fetch,
 * which the privacy ledger wraps (category research, so a local-only policy
 * blocks it). No CSP, allow-list or ledger rule changes.
 */
import type { CitationRecord, Name } from "../data/citationStyles";
import { OPENALEX_API } from "./openAlex";
import { normalizeDoi } from "./doi";

export const OPENALEX_HOST = new URL(OPENALEX_API).host;

/** The fields of an OpenAlex work that a reference uses (GET /works/doi:<doi>). */
export interface OpenAlexWork {
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  type?: string | null;
  publication_year?: number | null;
  authorships?: Array<{ author?: { display_name?: string | null } | null; raw_author_name?: string | null }>;
  primary_location?: { source?: { display_name?: string | null; host_organization_name?: string | null } | null } | null;
  biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null } | null;
}

const TYPES: Record<string, CitationRecord["type"]> = {
  article: "article",
  "journal-article": "article",
  book: "book",
  "book-chapter": "chapter",
  dissertation: "thesis",
  report: "report",
};

/** "Ada M. Lovelace" → { family: "Lovelace", given: "Ada M." }: OpenAlex has one display name, not CrossRef's split. */
export function splitName(display: string): Name | null {
  const s = display.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.includes(",")) {
    const [family, given] = s.split(",", 2).map((x) => x.trim());
    return given ? { family, given } : { family };
  }
  const parts = s.split(" ");
  if (parts.length === 1) return { family: s };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

const clean = (s: string | null | undefined) => (s ? s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : undefined);

/** An OpenAlex work → the reference record (APA / Chicago / MLA read it). */
export function recordFromOpenAlex(w: OpenAlexWork): CitationRecord {
  const authors = (w.authorships ?? [])
    .map((a) => splitName(a.author?.display_name ?? a.raw_author_name ?? ""))
    .filter((x): x is Name => !!x);
  const r: CitationRecord = { type: TYPES[w.type ?? ""] ?? "misc", authors, title: clean(w.title ?? w.display_name) ?? "" };
  if (typeof w.publication_year === "number" && w.publication_year > 0) r.year = String(w.publication_year);
  const container = clean(w.primary_location?.source?.display_name);
  if (container && r.type !== "book") r.container = container;
  const publisher = clean(w.primary_location?.source?.host_organization_name);
  if (publisher) r.publisher = publisher;
  if (w.biblio?.volume) r.volume = w.biblio.volume;
  if (w.biblio?.issue) r.issue = w.biblio.issue;
  const first = w.biblio?.first_page;
  const last = w.biblio?.last_page;
  if (first) r.pages = last && last !== first ? `${first}–${last}` : first;
  const doi = w.doi ? normalizeDoi(w.doi) : null;
  if (doi) r.doi = doi;
  return r;
}

export class OpenAlexDoiNotFoundError extends Error {
  constructor(readonly doi: string) {
    super(`DOI not found in OpenAlex: ${doi}`);
    this.name = "OpenAlexDoiNotFoundError";
  }
}

export interface OpenAlexDoiDeps {
  /** Settings → Privacy → OpenAlex (openAlexLookup.openAlexEnabled). */
  enabled: () => boolean;
  /** Asked before each lookup; false sends nothing. */
  confirm: (doi: string) => Promise<boolean>;
  fetch?: typeof fetch;
}

export type OpenAlexDoiResult = { status: "off" | "declined" } | { status: "invalid" } | { status: "done"; record: CitationRecord };

const SELECT = "doi,title,display_name,type,publication_year,authorships,primary_location,biblio";

/** A DOI → its reference, from OpenAlex: nothing sent unless the switch is on and the user said yes to this one. */
export async function lookupDoiViaOpenAlex(input: string, deps: OpenAlexDoiDeps): Promise<OpenAlexDoiResult> {
  if (!deps.enabled()) return { status: "off" };
  const doi = normalizeDoi(input);
  if (!doi) return { status: "invalid" };
  if (!(await deps.confirm(doi))) return { status: "declined" };
  // privacy-ledger: research — api.openalex.org (privacyLedger RULES); only the DOI, with the switch on and the user's yes for this lookup
  const res = await (deps.fetch ?? ((i: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(i, init)))(`${OPENALEX_API}/works/doi:${encodeURIComponent(doi)}?select=${SELECT}`, { headers: { Accept: "application/json" } });
  if (res.status === 404) throw new OpenAlexDoiNotFoundError(doi);
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  return { status: "done", record: recordFromOpenAlex((await res.json()) as OpenAlexWork) };
}
