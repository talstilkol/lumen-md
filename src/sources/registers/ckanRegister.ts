/**
 * An Israeli register on data.gov.il, looked up by name or number (plan
 * R12.19): the non-profits register (sources/amutot) and the companies
 * register (sources/companies) are two configurations of this module.
 *
 *  - By number: `datastore_search` with `filters` on the register's number
 *    field. By name: `datastore_search` with `q` (CKAN's full-text search
 *    over the resource), then the rows whose name field holds every word.
 *  - A result is a *source note*: the record as the register gave it on the
 *    day it was fetched, quoted with its credit and that date. It is what
 *    the register said, not a canonical fact Lumen keeps up to date.
 *  - What leaves the device: the number or the name typed, nothing else.
 *    Requests go only through the gated, ledgered fetch the caller passes
 *    (sources/open/gate), after the user confirms.
 *
 * The resource ids and field names are the public schema of the two
 * data.gov.il resources. They were not fetched from here (the network is
 * closed to this build), so the tests run on a synthetic recorded answer in
 * the CKAN shape, and the live check is owed.
 */
import { CKAN, DataGovError } from "../datagov/api";
import { REGISTER_TERMS, type RegisterSource, type SourceTerms } from "../open/rights";

/** The privacy ledger's reason for a register lookup (sources/open/app routes data.gov.il requests for these resources to it). */
export const REGISTERS_REASON = "Israeli registers (data.gov.il: non-profits, companies): the name or number typed only";

export interface RegisterConfig {
  source: Extract<RegisterSource, "amutot" | "companies">;
  /** data.gov.il dataset slug and resource id. */
  dataset: string;
  resourceId: string;
  /** The field that holds the registration number. */
  numberField: string;
  /** Name fields, Hebrew first. */
  nameFields: string[];
  /** Status fields, first present wins. */
  statusFields: string[];
  /** The number's first two digits (58 for non-profits, 51 for companies …), to tell a number query apart. */
  numberPrefixes: string[];
}

export interface RegisterRecord {
  source: RegisterConfig["source"];
  number: string;
  name: string;
  nameEn: string | null;
  status: string | null;
  /** Every field as the register gave it (CKAN's `_id` and `rank` left out). */
  fields: Record<string, string>;
  /** The dataset page, for the credit and the link. */
  url: string;
}

/** A registration number as typed ("58-0123456-7", "580123456") → its nine digits, or null. */
export function registerNumber(q: string): string | null {
  const digits = q.replace(/[\s\-–־.]/g, "");
  return /^\d{9}$/.test(digits) ? digits : null;
}

export function datasetUrl(cfg: RegisterConfig): string {
  return `https://data.gov.il/dataset/${encodeURIComponent(cfg.dataset)}`;
}

/** The request for a number, or for a name. */
export function lookupUrl(cfg: RegisterConfig, query: string, limit = 10): string {
  const n = registerNumber(query);
  const params = new URLSearchParams({ resource_id: cfg.resourceId, limit: String(Math.min(Math.max(limit, 1), 100)) });
  if (n) params.set("filters", JSON.stringify({ [cfg.numberField]: Number(n) }));
  else params.set("q", query.trim());
  return `${CKAN}datastore_search?${params.toString()}`;
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const first = (row: Record<string, unknown>, fields: string[]) => {
  for (const f of fields) {
    const v = text(row[f]);
    if (v) return v;
  }
  return "";
};
const fold = (s: string) => s.normalize("NFKC").replace(/[֑-ׇ]/g, "").replace(/["״׳']/g, "").toLowerCase();

/** The records of a datastore_search answer; for a name query only rows whose name holds every word typed. */
export function parseLookup(cfg: RegisterConfig, query: string, json: unknown): RegisterRecord[] {
  const j = (json ?? {}) as { success?: boolean; result?: { records?: unknown }; error?: { message?: string } };
  if (j.success === false) throw new DataGovError(j.error?.message ?? "CKAN error");
  const rows = Array.isArray(j.result?.records) ? (j.result!.records as Array<Record<string, unknown>>) : [];
  const n = registerNumber(query);
  const words = n ? [] : fold(query).split(/\s+/).filter(Boolean);
  const out: RegisterRecord[] = [];
  for (const row of rows) {
    const number = text(row[cfg.numberField]).replace(/\D/g, "");
    if (!number) continue; // a row without a number is attributed to nobody
    if (n && number !== n) continue;
    const name = first(row, cfg.nameFields.slice(0, 1)) || first(row, cfg.nameFields);
    if (words.length) {
      const hay = fold(cfg.nameFields.map((f) => text(row[f])).join(" "));
      if (!words.every((w) => hay.includes(w))) continue;
    }
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) if (k !== "_id" && k !== "rank" && text(v)) fields[k] = text(v);
    const nameEn = cfg.nameFields.slice(1).map((f) => text(row[f])).find(Boolean) ?? null;
    out.push({ source: cfg.source, number, name, nameEn, status: first(row, cfg.statusFields) || null, fields, url: datasetUrl(cfg) });
  }
  return out;
}

/** Look a name or number up in the register, through the fetch the caller passes (the gated one). */
export async function lookup(cfg: RegisterConfig, query: string, fetchImpl: typeof fetch, limit = 10): Promise<RegisterRecord[]> {
  const res = await fetchImpl(lookupUrl(cfg, query, limit), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new DataGovError(`answered ${res.status}`, res.status);
  return parseLookup(cfg, query, await res.json());
}

/** A number written the way the registers print it: 58-012345-6. */
export function formatNumber(n: string): string {
  return /^\d{9}$/.test(n) ? `${n.slice(0, 2)}-${n.slice(2, 8)}-${n.slice(8)}` : n;
}

/**
 * The source note for one record: frontmatter that says what it is and when
 * it was read, the record quoted field by field, and the credit with the date.
 * `retrieved` is the fetch day (YYYY-MM-DD).
 */
export function sourceNote(rec: RegisterRecord, retrieved: string): { path: string; content: string; terms: SourceTerms } {
  const terms = REGISTER_TERMS[rec.source];
  const q = (s: string) => JSON.stringify(s);
  const fm = [
    "---",
    "type: source",
    `register: ${rec.source}`,
    `number: ${q(rec.number)}`,
    `title: ${q(rec.name || formatNumber(rec.number))}`,
    `retrieved: ${retrieved}`,
    `url: ${q(rec.url)}`,
    `licence: ${q(terms.rights)}`,
    `licence-light: ${terms.light}`,
    `terms: ${q(terms.termsUrl)}`,
    "---",
  ];
  const quote = Object.entries(rec.fields).map(([k, v]) => `> **${k.replace(/[*_`]/g, "")}:** ${v.replace(/\n+/g, " ")}`);
  const body = [
    `# ${rec.name || formatNumber(rec.number)}`,
    "",
    `${formatNumber(rec.number)}${rec.status ? ` · ${rec.status}` : ""}`,
    "",
    ...quote,
    "",
    `מקור: [${terms.he}](${rec.url}) · נשלף ${retrieved} · [תנאי השימוש](${terms.termsUrl})`,
    "",
    "הרשומה כפי שהמרשם הציג אותה ביום השליפה — לא נתון שמתעדכן.",
    "",
  ];
  const safe = (rec.name || rec.number).replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return { path: `Sources/${rec.source}/${safe} ${rec.number}.md`, content: [...fm, ...body].join("\n"), terms };
}
