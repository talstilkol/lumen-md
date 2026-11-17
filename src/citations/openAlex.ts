/**
 * Optional reference lookup in OpenAlex (plan W12.X3): the works a DOI
 * cites, as DOIs, to fill `references:` of library items. Off by default:
 * without the user's consent for this lookup no request is made at all.
 * With it, only the DOIs go out, to api.openalex.org, which the privacy
 * ledger lists (category "research", so a local-only policy blocks it like
 * the other research services).
 *
 * API: https://docs.openalex.org/ — `GET /works/doi:<doi>?select=referenced_works`
 * gives OpenAlex work ids; `GET /works?filter=openalex:W1|W2&select=id,doi`
 * turns them into DOIs (at most 50 ids per request, as the API allows).
 */

export const OPENALEX_API = "https://api.openalex.org";

export interface OpenAlexOptions {
  /** The user turned the lookup on for this request. Without it, nothing is sent. */
  consent: boolean;
  fetch?: typeof fetch;
  /** OpenAlex asks for a contact address in `mailto` for its polite pool; only when the user gave one. */
  mailto?: string;
}

const doiOf = (v: unknown): string | null => (typeof v === "string" && v ? v.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase() : null);

/** The DOIs of the works `doi` cites, per OpenAlex; [] without consent (and no request). */
export async function openAlexReferences(doi: string, opts: OpenAlexOptions): Promise<string[]> {
  if (!opts.consent) return [];
  const f = opts.fetch ?? fetch;
  const mail = opts.mailto ? `&mailto=${encodeURIComponent(opts.mailto)}` : "";
  const res = await f(`${OPENALEX_API}/works/doi:${encodeURIComponent(doi.trim())}?select=referenced_works${mail}`);
  if (!res.ok) return [];
  const work = (await res.json()) as { referenced_works?: unknown };
  const ids = (Array.isArray(work.referenced_works) ? work.referenced_works : [])
    .map((w) => (typeof w === "string" ? w.split("/").pop()! : ""))
    .filter((w) => /^W\d+$/.test(w));
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).join("|");
    const r = await f(`${OPENALEX_API}/works?filter=openalex:${batch}&select=id,doi&per-page=50${mail}`);
    if (!r.ok) continue;
    const page = (await r.json()) as { results?: Array<{ doi?: unknown }> };
    for (const w of page.results ?? []) {
      const d = doiOf(w.doi);
      if (d) out.push(d);
    }
  }
  return out;
}
