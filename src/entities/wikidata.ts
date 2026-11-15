/**
 * Linking an entity to Wikidata (plan W12.E10): optional, by consent, in
 * the privacy ledger.
 *
 * - Nothing is sent until the user agrees, each time ("this once") or for
 *   the vault ("always for this vault", kept in the vault as
 *   `.lumen/entities/wikidata.json`, so it travels with the vault and
 *   nowhere else).
 * - What is sent: the entity's name, to `wbsearchentities` in Hebrew and in
 *   English (two GET requests to www.wikidata.org). Nothing from the notes.
 *   The browser's own User-Agent cannot be replaced, so the request names
 *   the app in `Api-User-Agent`, as Wikimedia asks of browser clients, with
 *   nothing about the user.
 * - The request goes through the privacy ledger (`ledgerFetch` with the
 *   user's consent, as the Sefaria and open-data sources do): it is listed
 *   as "Wikidata search: the entity name only", marked as consented, so a
 *   local-only AI policy lets this one request through and shows it.
 * - The chosen item's QID is written to the entity note's `wikidata`
 *   property. Wikidata's data is CC0 (public domain): the entity card says
 *   so next to the QID.
 * - In airplane mode there is no button and no command.
 */
import { splitFrontmatter, FRONTMATTER } from "./frontmatter";

export const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
export const WIKIDATA_LICENCE = "CC0 1.0";
/** How the ledger lists the request (privacyLedger.ts has the same rule for the host). */
export const LEDGER_REASON = "Wikidata search: the entity name only";
export const CONSENT_PATH = ".lumen/entities/wikidata.json";
/** Names the app only (Wikimedia's User-Agent policy, for browser clients). */
export const API_USER_AGENT = "lumen-md/1.0 (https://lumen-md.vercel.app; entity linking)";

export interface WikidataHit {
  id: string;
  label: string;
  description: string;
  /** The search language it came from. */
  lang: "he" | "en";
}

export const isQid = (s: unknown): s is string => typeof s === "string" && /^Q[1-9]\d*$/.test(s);

export function searchUrl(name: string, lang: "he" | "en", limit = 7): string {
  const q = new URLSearchParams({ action: "wbsearchentities", search: name, language: lang, uselang: lang, type: "item", limit: String(limit), format: "json", origin: "*" });
  return `${WIKIDATA_API}?${q}`;
}

/** Search in Hebrew and in English; one row per item, Hebrew first. `fetchImpl` is the ledger-wrapped fetch in the app. */
export async function searchWikidata(name: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<WikidataHit[]> {
  const out = new Map<string, WikidataHit>();
  for (const lang of ["he", "en"] as const) {
    const res = await fetchImpl(searchUrl(name, lang), { headers: { Accept: "application/json", "Api-User-Agent": API_USER_AGENT }, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) throw new Error(`Wikidata: HTTP ${res.status}`);
    const body = (await res.json()) as { search?: Array<{ id?: unknown; label?: unknown; description?: unknown }> };
    for (const s of body.search ?? []) {
      if (!isQid(s.id) || out.has(s.id)) continue;
      out.set(s.id, { id: s.id, label: typeof s.label === "string" ? s.label : s.id, description: typeof s.description === "string" ? s.description : "", lang });
    }
  }
  return [...out.values()];
}

/** The vault's standing consent ("always for this vault"), read from the vault. */
export function consentFromFile(text: string | null): boolean {
  if (!text) return false;
  try {
    return (JSON.parse(text) as { always?: unknown }).always === true;
  } catch {
    return false;
  }
}
export const consentFile = (at: Date = new Date()) => JSON.stringify({ always: true, since: at.toISOString().slice(0, 10), what: "the entity name only, to www.wikidata.org (wbsearchentities)" }, null, 2) + "\n";

/** The note with `wikidata: <qid>` in its front matter (added or replaced); the body and other properties byte for byte. */
export function withQid(text: string, qid: string): string {
  if (!isQid(qid)) throw new Error(`not a Wikidata item id: ${qid}`);
  const m = FRONTMATTER.exec(text);
  if (!m) return `---\nwikidata: ${qid}\n---\n${text}`;
  if (splitFrontmatter(text).broken) throw new Error("the note's front matter does not parse; fix it before linking");
  const lines = m[1].split(/\r?\n/);
  const at = lines.findIndex((l) => /^wikidata\s*:/.test(l));
  if (at >= 0) lines[at] = `wikidata: ${qid}`;
  else lines.push(`wikidata: ${qid}`);
  const eol = m[0].includes("\r\n") ? "\r\n" : "\n";
  // The closing "---" line as it was (its trailing spaces and line ending), then the body untouched.
  const closing = m[0].slice(m[0].lastIndexOf("---"));
  return `---${eol}${lines.join(eol)}${eol}${closing}${text.slice(m[0].length)}`;
}
