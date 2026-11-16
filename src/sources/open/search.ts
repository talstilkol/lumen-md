/**
 * One search over every open source the user turned on (plan W7.24):
 * Sefaria (W5.1), the Knesset (W7.5), data.gov.il and the CBS (W7.6) and
 * the Ben-Yehuda library (W7.7).
 *
 *  - Local first: references are parsed, saved laws and the downloaded
 *    library are searched on the device, as the user types. Nothing is sent.
 *  - Online only on request ("search online"), only for sources that are on
 *    and only after the user confirms; every request goes through the
 *    gated, ledgered fetch.
 *  - Every result carries its rights (sources/open/rights), and the rights
 *    choose what goes into the note: a full copy with its attribution, or a
 *    link only — never a full copy of link-only content.
 */

import { mayCopy, REGISTER_TERMS, RIGHTS_URL, type Rights, type SourceTerms } from "./rights";
import type { OpenSourceId } from "./gate";
import { parseSourceRef, type SourceRef } from "../sefaria/refs";
import { matchLaw, searchTermOf } from "../knesset/lawNames";
import { lawCitation, type SavedLaw } from "../knesset/store";
import { recordUrl, searchLaws } from "../knesset/odata";
import { plain, quoteBlock as workQuote, workUrl, type Library, type Work } from "../benyehuda/library";
import { searchDatasets, type DatasetHit } from "../datagov/api";
import { formatNumber, lookup, registerNumber, type RegisterConfig, type RegisterRecord } from "../registers/ckanRegister";
import { AMUTOT } from "../amutot/register";
import { COMPANIES } from "../companies/register";
import { parseYalkutRef, yalkutUrl, type YalkutRef } from "../reshumot/yalkut";

export type Kind = "verse" | "law" | "work" | "dataset" | "series" | "register" | "gazette";

export const KINDS: readonly Kind[] = ["verse", "law", "work", "dataset", "series", "register", "gazette"];

export interface OpenResult {
  /** Unique within one search. */
  key: string;
  source: OpenSourceId;
  kind: Kind;
  title: string;
  detail: string;
  rights: Rights;
  /** Where the item lives (shown, and the link a link-only insert uses). */
  url: string;
  /** True when the item came from this device (no request was made). */
  local: boolean;
  payload: { ref?: SourceRef; lawId?: number; lawName?: string; savedLaw?: SavedLaw; work?: Work; dataset?: DatasetHit; seriesId?: string; record?: RegisterRecord; yalkut?: YalkutRef };
  /** R12.19: the register's licence light and terms of use, shown with the result. */
  terms?: SourceTerms;
}

export interface LocalSources {
  enabled: Record<OpenSourceId, boolean>;
  laws: readonly SavedLaw[];
  library: Library | null;
}

/** CBS series Lumen knows by name (the id is what the series API takes). */
export const KNOWN_SERIES: ReadonlyArray<{ id: string; name: string; words: string[] }> = [{ id: "120010", name: "מדד המחירים לצרכן — מדד כללי", words: ["מדד", "המחירים", "לצרכן", "יוקר", "אינפלציה", "cpi"] }];

const normWords = (q: string) => plain(q).toLowerCase().split(/\s+/).filter(Boolean);

/** Results that need no network: a reference, saved laws, the downloaded library, known series. */
export function searchLocal(query: string, src: LocalSources, kind: Kind | null = null): OpenResult[] {
  const q = query.trim();
  if (!q) return [];
  const out: OpenResult[] = [];
  const want = (k: Kind) => !kind || kind === k;
  if (src.enabled.sefaria && want("verse")) {
    const ref = parseSourceRef(q);
    if (ref)
      out.push({
        key: `sefaria:${ref.key}`,
        source: "sefaria",
        kind: "verse",
        title: ref.he,
        detail: ref.tref,
        // Sefaria licenses each version; until the text is fetched the result is treated as link-only, and the
        // insert applies each version's own licence (sources/sefaria/license).
        rights: "link-only",
        url: ref.url,
        local: true,
        payload: { ref },
      });
  }
  if (src.enabled.knesset && want("law") && src.laws.length) {
    const m = matchLaw(
      q,
      src.laws.map((l) => l.law),
    );
    if (m) {
      const saved = src.laws.find((l) => l.law.id === m.law.id)!;
      out.push({ key: `knesset:${m.law.id}`, source: "knesset", kind: "law", title: m.law.name, detail: saved.text ? "סעיף 6" : "", rights: "section-6", url: recordUrl("KNS_IsraelLaw", m.law.id), local: true, payload: { lawId: m.law.id, lawName: m.law.name, savedLaw: saved } });
    }
  }
  if (src.enabled.benyehuda && want("work") && src.library) {
    for (const h of src.library.search(q, 5))
      out.push({ key: `benyehuda:${h.work.id}`, source: "benyehuda", kind: "work", title: plain(h.work.title), detail: h.work.authors, rights: "public-domain", url: workUrl(h.work), local: true, payload: { work: h.work } });
  }
  if (src.enabled.registers && want("gazette")) {
    // R12.19: a Yalkut HaPirsumim reference is a link; nothing is fetched.
    const y = parseYalkutRef(q);
    const terms = REGISTER_TERMS.reshumot;
    if (y) out.push({ key: `reshumot:${y.issue}:${y.page ?? ""}`, source: "registers", kind: "gazette", title: `ילקוט הפרסומים ${y.issue}${y.page ? `, עמ׳ ${y.page}` : ""}`, detail: terms.he, rights: terms.rights, url: yalkutUrl(y.issue), local: true, payload: { yalkut: y }, terms });
  }
  if (src.enabled.datagov && want("series")) {
    const words = normWords(q);
    for (const s of KNOWN_SERIES) {
      if (words.includes(s.id) || words.filter((w) => s.words.some((x) => x === w || x.startsWith(w))).length >= Math.min(2, words.length))
        out.push({ key: `cbs:${s.id}`, source: "datagov", kind: "series", title: s.name, detail: `CBS ${s.id}`, rights: "cbs-licence", url: `https://apis.cbs.gov.il/series/data/list?id=${s.id}&format=json&download=false`, local: true, payload: { seriesId: s.id } });
    }
  }
  return out;
}

/** Online results, for the sources that are on. `fetchImpl` is the gated fetch. */
export async function searchOnline(query: string, enabled: Record<OpenSourceId, boolean>, fetchImpl: typeof fetch, kind: Kind | null = null): Promise<OpenResult[]> {
  const q = query.trim();
  const out: OpenResult[] = [];
  const jobs: Array<Promise<void>> = [];
  if (enabled.knesset && (!kind || kind === "law")) {
    const term = searchTermOf(q);
    if (term)
    jobs.push(
      searchLaws(term, fetchImpl).then((laws) => {
        const best = matchLaw(q, laws);
        const ordered = best ? [laws.find((l) => l.id === best.law.id)!, ...laws.filter((l) => l.id !== best.law.id)] : laws;
        for (const l of ordered.slice(0, 5)) out.push({ key: `knesset:${l.id}`, source: "knesset", kind: "law", title: l.name, detail: l.validity ?? "", rights: "section-6", url: recordUrl("KNS_IsraelLaw", l.id), local: false, payload: { lawId: l.id, lawName: l.name } });
      }),
    );
  }
  // W10.C28: free text in Sefaria's library (a reference is answered locally, above): the text search, its hits as verses.
  if (enabled.sefaria && (!kind || kind === "verse") && q && !parseSourceRef(q)) {
    jobs.push(
      searchSefariaText(q, fetchImpl).then((hits) => {
        for (const h of hits) out.push({ key: `sefaria:${h.ref.key}`, source: "sefaria", kind: "verse", title: h.ref.he, detail: h.snippet, rights: "link-only", url: h.ref.url, local: false, payload: { ref: h.ref } });
      }),
    );
  }
  if (enabled.datagov && (!kind || kind === "dataset")) {
    jobs.push(
      searchDatasets(q, fetchImpl).then((hits) => {
        for (const h of hits.slice(0, 5)) out.push({ key: `datagov:${h.name}`, source: "datagov", kind: "dataset", title: h.title, detail: h.organization ?? "", rights: "gov-open", url: `https://data.gov.il/dataset/${encodeURIComponent(h.name)}`, local: false, payload: { dataset: h } });
      }),
    );
  }
  if (enabled.registers && (!kind || kind === "register")) {
    // R12.19: a nine-digit number goes only to the register it belongs to; a name to both.
    const n = registerNumber(q);
    const registers: RegisterConfig[] = [AMUTOT, COMPANIES].filter((c) => !n || c.numberPrefixes.includes(n.slice(0, 2)));
    for (const cfg of registers)
      jobs.push(
        lookup(cfg, q, fetchImpl, 5).then((recs) => {
          const terms = REGISTER_TERMS[cfg.source];
          for (const r of recs.slice(0, 5))
            out.push({ key: `${cfg.source}:${r.number}`, source: "registers", kind: "register", title: r.name || formatNumber(r.number), detail: [formatNumber(r.number), r.status].filter(Boolean).join(" · "), rights: terms.rights, url: r.url, local: false, payload: { record: r }, terms });
        }),
      );
  }
  await Promise.all(jobs);
  return out;
}

export const SEFARIA_SEARCH = "https://www.sefaria.org/api/search-wrapper";

/**
 * Sefaria's text search (POST /api/search-wrapper, an Elasticsearch query over
 * the library): the query, and only the query, is sent. Each hit's `ref` is
 * parsed into a reference Lumen knows; others are dropped. The snippet is the
 * highlight with its markup removed (never rendered as HTML).
 */
export async function searchSefariaText(query: string, fetchImpl: typeof fetch, size = 5): Promise<Array<{ ref: SourceRef; snippet: string }>> {
  const res = await fetchImpl(SEFARIA_SEARCH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, type: "text", field: "naive_lemmatizer", size: size * 2, slop: 10, source_proj: ["ref", "heRef"] }) });
  if (!res.ok) throw new Error(`Sefaria search: HTTP ${res.status}`);
  const json = (await res.json()) as { hits?: { hits?: Array<{ _id?: string; _source?: { ref?: unknown; heRef?: unknown }; highlight?: Record<string, unknown> }> } };
  const out: Array<{ ref: SourceRef; snippet: string }> = [];
  const seen = new Set<string>();
  for (const h of json.hits?.hits ?? []) {
    const raw = typeof h._source?.ref === "string" ? h._source.ref : typeof h._id === "string" ? h._id.replace(/\s*\(.*\)\s*$/, "") : "";
    const ref = raw ? parseSourceRef(raw) : null;
    if (!ref || seen.has(ref.key)) continue;
    seen.add(ref.key);
    const hl = Object.values(h.highlight ?? {}).flat().find((x): x is string => typeof x === "string") ?? "";
    out.push({ ref, snippet: hl.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 200) });
    if (out.length >= size) break;
  }
  return out;
}

/** Local and online results together, without duplicates (a saved law beats the same law online). */
export function merge(local: readonly OpenResult[], online: readonly OpenResult[]): OpenResult[] {
  const seen = new Set(local.map((r) => r.key));
  return [...local, ...online.filter((r) => !seen.has(r.key))];
}

/**
 * What a result becomes in a note, by its rights: the content with its
 * attribution when the rights allow a copy, otherwise a link and the
 * attribution. `content` is the text the source gave (null when there is none).
 */
export function insertionFor(r: OpenResult, content: string | null): string {
  if (r.source === "knesset" && r.payload.lawId !== undefined) return lawCitation({ id: r.payload.lawId, name: r.payload.lawName ?? r.title });
  if (mayCopy(r.rights) && content) {
    if (r.kind === "work" && r.payload.work) return workQuote(r.payload.work, content);
    return `${content}\n\n${attributionFor(r)}`;
  }
  return `[${r.title}](${r.url}) — ${attributionFor(r)}`;
}

/** The credit line every insertion carries. */
export function attributionFor(r: OpenResult): string {
  const deed = RIGHTS_URL[r.rights];
  const mark = RIGHTS_LABEL_HE[r.rights];
  const where = { sefaria: "Sefaria", knesset: "הכנסת", datagov: r.kind === "series" ? 'הלמ"ס' : "data.gov.il", benyehuda: "פרויקט בן־יהודה", registers: r.terms?.he ?? "data.gov.il" }[r.source];
  return `מקור: [${where}](${r.url}) · ${deed ? `[${mark}](${deed})` : mark}`;
}

/** The badge text of each right, in Hebrew (the dialog shows the UI language's own, from i18n). */
export const RIGHTS_LABEL_HE: Record<Rights, string> = {
  "public-domain": "רשות הציבור",
  cc0: "CC0",
  "cc-by": "CC BY",
  "cc-by-sa": "CC BY-SA",
  "section-6": "סעיף 6 (חקיקה ודברי הכנסת)",
  "cbs-licence": 'רישיון הלמ"ס',
  "gov-open": "data.gov.il",
  "link-only": "קישור בלבד",
};
