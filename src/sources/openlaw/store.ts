/**
 * The Open Book of Laws on this device (plan W11.H16): the user chooses an
 * export of gkour/israeli_law that they downloaded themselves, and Lumen
 * keeps it in the vault, in `.lumen/openlaw/`. Lumen never downloads it:
 * importing a file opens no network path (the privacy ledger has nothing to
 * record), and lookups afterwards are local.
 *
 * Layout, so a lookup reads one small file and not the whole corpus
 * (5,942 pages, ~25M tokens):
 *
 *   .lumen/openlaw/index.json   the manifest (dataset, licence, credit, the
 *                               file's sha256, the import date) and one entry
 *                               per law: id, name, Basic Law, url, shard
 *   .lumen/openlaw/s<k>.json    up to SHARD_SIZE laws' plain text, each shard
 *                               with the licence, rights and credit again
 *
 * Every stored text carries the CC BY-SA tag (W11.H16 acceptance "100%"),
 * in its shard and in the index; a note saved from it carries it in the
 * frontmatter (renderOpenLawNote).
 */
import { buildCorpus, parseLawQuery, parseOpenLawFile, OPEN_LAW_CREDIT, OPEN_LAW_DATASET, OPEN_LAW_LICENSE, OPEN_LAW_RIGHTS, type OpenLaw, type OpenLawHit } from "./book";
import { lawKey, matchLaw } from "../knesset/lawNames";
import { lawSections } from "../knesset/store";
import type { Rights } from "../open/rights";

export const OPEN_LAW_STORE = ".lumen/openlaw";
export const INDEX_PATH = `${OPEN_LAW_STORE}/index.json`;
export const SHARD_SIZE = 100;
export const INDEX_FORMAT = 1;

export interface OpenLawStorage {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
}

export interface OpenLawIndexEntry {
  id: number;
  name: string;
  isBasicLaw: boolean;
  url: string;
  shard: number;
}

/** The licence tag every stored file carries. */
export interface LicenceTag {
  dataset: string;
  license: string;
  rights: Rights;
  credit: string;
  official: false;
}

export interface OpenLawIndex extends LicenceTag {
  format: number;
  /** sha256 of the file the user imported: the local copy's revision. */
  sha256: string;
  fileName: string;
  imported: string;
  count: number;
  laws: OpenLawIndexEntry[];
}

export interface OpenLawShard extends LicenceTag {
  laws: Array<{ id: number; text: string }>;
}

export const LICENCE_TAG: LicenceTag = Object.freeze({
  dataset: OPEN_LAW_DATASET,
  license: OPEN_LAW_LICENSE,
  rights: OPEN_LAW_RIGHTS,
  credit: OPEN_LAW_CREDIT,
  official: false as const,
});

/** True when a stored object carries the full licence tag. */
export function hasLicenceTag(o: Partial<LicenceTag> | null | undefined): boolean {
  return !!o && o.dataset === OPEN_LAW_DATASET && o.license === OPEN_LAW_LICENSE && o.rights === OPEN_LAW_RIGHTS && o.credit === OPEN_LAW_CREDIT && o.official === false;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ImportProgress {
  done: number;
  total: number;
}

export class OpenLawImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenLawImportError";
  }
}

/** Gives the UI a turn between batches of work, and honours the abort. */
const breathe = (signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("aborted", "AbortError"));
    setTimeout(resolve, 0);
  });

/**
 * Import the file's text: parse, turn Wikisource's markup into numbered
 * sections, write the shards and then the index (the index last, so an
 * aborted import leaves the previous copy in use). Returns the new index.
 */
export async function importOpenLaw(
  text: string,
  storage: OpenLawStorage,
  o: {
    fileName?: string;
    now?: () => Date;
    signal?: AbortSignal;
    onProgress?: (p: ImportProgress) => void;
  } = {},
): Promise<OpenLawIndex> {
  let rows;
  try {
    rows = parseOpenLawFile(text);
  } catch (e) {
    throw new OpenLawImportError((e as Error).message);
  }
  if (!rows.length) throw new OpenLawImportError("the file has no laws in it");
  const sha256 = await sha256Hex(text);
  const total = rows.length;
  const laws: OpenLawIndexEntry[] = [];
  const seen = new Set<string>();
  for (let start = 0, shard = 0; start < total; start += SHARD_SIZE, shard++) {
    await breathe(o.signal);
    const corpus = buildCorpus(rows.slice(start, start + SHARD_SIZE)).map((l, i) => ({ ...l, id: start + i + 1 }));
    const kept = corpus.filter((l) => {
      // A page listed twice (a redirect exported with its target) is kept once.
      if (seen.has(l.name)) return false;
      seen.add(l.name);
      return true;
    });
    const body: OpenLawShard = {
      ...LICENCE_TAG,
      laws: kept.map((l) => ({ id: l.id, text: l.text })),
    };
    await storage.write(`${OPEN_LAW_STORE}/s${shard}.json`, JSON.stringify(body));
    for (const l of kept)
      laws.push({
        id: l.id,
        name: l.name,
        isBasicLaw: l.isBasicLaw,
        url: l.url,
        shard,
      });
    o.onProgress?.({ done: Math.min(total, start + SHARD_SIZE), total });
  }
  const index: OpenLawIndex = {
    format: INDEX_FORMAT,
    ...LICENCE_TAG,
    sha256,
    fileName: o.fileName ?? "",
    imported: (o.now?.() ?? new Date()).toISOString(),
    count: laws.length,
    laws,
  };
  await storage.write(INDEX_PATH, JSON.stringify(index));
  return index;
}

/** The index on this device, or null when nothing was imported (or it is not a valid, licence-tagged index). */
export async function loadOpenLawIndex(storage: OpenLawStorage): Promise<OpenLawIndex | null> {
  const raw = await storage.read(INDEX_PATH);
  if (!raw) return null;
  try {
    const idx = JSON.parse(raw) as OpenLawIndex;
    if (idx.format !== INDEX_FORMAT || !Array.isArray(idx.laws) || !hasLicenceTag(idx)) return null;
    return idx;
  } catch {
    return null;
  }
}

/** One law's text, from its shard; null when the shard is missing or not tagged. */
export async function openLawText(entry: OpenLawIndexEntry, storage: OpenLawStorage): Promise<string | null> {
  const raw = await storage.read(`${OPEN_LAW_STORE}/s${entry.shard}.json`);
  if (!raw) return null;
  try {
    const shard = JSON.parse(raw) as OpenLawShard;
    if (!hasLicenceTag(shard)) return null;
    return shard.laws.find((l) => l.id === entry.id)?.text ?? null;
  } catch {
    return null;
  }
}

export interface OpenLawMatch {
  entry: OpenLawIndexEntry;
  /** The section the query names ("סעיף 12 לחוק …"), or null for the whole law. */
  section: string | null;
}

// The same word folding as matchLaw (knesset/lawNames): a word of a name and a typed word meet when they
// are equal once one prefix group is stripped, so the stripped form is the inverted index's key.
const stripPrefix = (w: string) => w.replace(/^[והבלמכש]{1,2}(?=[א-ת]{3})/, "");
const wordsOfKey = (key: string) =>
  key
    .replace(/^basic:/, "")
    .split(" ")
    .filter(Boolean);
const wordIndexes = new WeakMap<OpenLawIndex, Map<string, number[]>>();

/** stripped word → the laws whose name has it; built once per index (6k–10k names). */
function wordIndex(index: OpenLawIndex): Map<string, number[]> {
  let m = wordIndexes.get(index);
  if (m) return m;
  m = new Map();
  index.laws.forEach((l, i) => {
    for (const w of new Set(wordsOfKey(lawKey(l.name)).map(stripPrefix))) {
      const list = m!.get(w);
      if (list) list.push(i);
      else m!.set(w, [i]);
    }
  });
  wordIndexes.set(index, m);
  return m;
}

/**
 * The law (and section) a query names, from the index only: no text is read.
 * matchLaw scores only names that hold every typed word, so it runs on the
 * names the inverted index gives for all of them: the same answer, without
 * folding every name on every keystroke.
 */
export function matchOpenLaw(query: string, index: OpenLawIndex | null): OpenLawMatch | null {
  if (!index?.laws.length) return null;
  const { law, section } = parseLawQuery(query);
  if (!/[א-ת]/.test(law)) return null;
  const typed = wordsOfKey(lawKey(law)).map(stripPrefix);
  if (!typed.length) return null;
  const words = wordIndex(index);
  let candidates: Set<number> | null = null;
  for (const w of typed) {
    const hits: number[] = words.get(w) ?? [];
    const prev: Set<number> | null = candidates;
    candidates = new Set(prev ? hits.filter((i) => prev.has(i)) : hits);
    if (!candidates.size) return null;
  }
  const m = matchLaw(
    law,
    [...(candidates ?? [])].map((i) => index.laws[i]),
  );
  return m ? { entry: m.law as OpenLawIndexEntry, section } : null;
}

/** The full lookup: the index, then the one shard the law is in. */
export async function lookupStored(query: string, index: OpenLawIndex | null, storage: OpenLawStorage): Promise<OpenLawHit | null> {
  const m = matchOpenLaw(query, index);
  return m ? hitFor(m.entry, m.section, storage) : null;
}

/** A law of the index (by id) and, when given, one of its sections; null when either is not in the copy. */
export async function hitFor(entry: OpenLawIndexEntry, sectionNumber: string | null, storage: OpenLawStorage): Promise<OpenLawHit | null> {
  const text = await openLawText(entry, storage);
  if (text === null) return null;
  const law: OpenLaw = {
    id: entry.id,
    name: entry.name,
    isBasicLaw: entry.isBasicLaw,
    text,
    url: entry.url,
  };
  const section = sectionNumber ? (lawSections(text).find((s) => s.number === sectionNumber) ?? null) : null;
  if (sectionNumber && !section) return null;
  return {
    law,
    section,
    rights: OPEN_LAW_RIGHTS,
    credit: OPEN_LAW_CREDIT,
    url: law.url,
  };
}
