/**
 * Citation graph (plan W12.X3): who cites whom, as `cites` edges of the
 * entity graph (W12.E1's predicate P2860), so the graph view (W12.E7) draws
 * them and its table lists them.
 *
 * Edges come from three places, all already in the vault:
 *  1. `[@key]` citations (pandoc syntax, W5.x) in a source note's text: the
 *     source (`type: source` with `citekey:`, W12.X2) cites the cited key;
 *  2. links from a source note to another source note (`[[Other]]`);
 *  3. `references:` of an item in a CSL-JSON library (Zotero's export via
 *     Better BibTeX, or what OpenAlex returned): cite keys or DOIs;
 *  4. `references:` of a source note (what "Fill references from OpenAlex"
 *     writes, or typed by hand): cite keys or DOIs. The provenance is the
 *     note with the property as its anchor (`references`) and the entry
 *     word for word. A pair a library already gave keeps that edge.
 *
 * Every source is a `source` entity whose id is `source:<citekey>` (or the
 * note's name when it has no key). Every edge carries provenance: the note
 * or library file, the paragraph's anchor and hash when it is from a note,
 * and the cited text word for word. Nothing here touches the network; the
 * optional OpenAlex lookup is in openAlex.ts, off by default.
 */
import type { CslItem } from "./csl";
import { entityId, type Edge, type Entity } from "../entities/model";
import { paragraphHash, splitParagraphs } from "../entities/paragraphs";
import { compareCodePoints } from "../i18n/collate";

export const CITATION_EXTRACTOR = "citations@1";

/** A note of the vault, with its frontmatter already parsed. */
export interface CitingNote {
  path: string;
  fm: Record<string, unknown>;
  /** The body (after the frontmatter). */
  body: string;
}

/** A CSL-JSON library file and its items. */
export interface CslLibrary {
  path: string;
  items: readonly (CslItem & { references?: unknown })[];
}

export interface CitationGraph {
  entities: Entity[];
  edges: Edge[];
  /** Citations whose key is in neither the library nor a source note. */
  unresolved: Array<{ from: string; key: string; where: string }>;
}

const isSource = (fm: Record<string, unknown>): boolean => {
  const types = Array.isArray(fm.type) ? fm.type : [fm.type];
  return types.some((t) => typeof t === "string" && t.trim().toLowerCase() === "source");
};

const baseName = (path: string): string => path.split("/").pop()!.replace(/\.md$/i, "");

/** `[@a; @b, p. 3]`, `[-@a]`, `@a` in text (pandoc's citation syntax): the keys, in order. */
export function citedKeys(text: string): string[] {
  const out: string[] = [];
  // Bracketed groups first, then bare @key in running text (not in an e-mail address).
  for (const m of text.matchAll(/\[([^\][]*@[^\][]*)\]/g)) for (const k of m[1].matchAll(/(?:^|[\s;])-?@(\w(?:[\w:.#$%&+?<>~/-]*\w)?)/g)) out.push(k[1]);
  const rest = text.replace(/\[[^\][]*@[^\][]*\]/g, " ");
  for (const k of rest.matchAll(/(?<![\w.@])@([A-Za-z](?:[\w:.#$%&+?<>~/-]*\w)?)/g)) out.push(k[1]);
  return out;
}

const normDoi = (v: string): string => v.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").toLowerCase();

/** A source note's own DOI: `doi:` (any case), or a doi.org `url:`. */
const noteDoi = (fm: Record<string, unknown>): string | undefined => {
  for (const [k, v] of Object.entries(fm)) {
    if (typeof v !== "string" || !v.trim()) continue;
    const key = k.toLowerCase();
    if (key === "doi" || (key === "url" && /^https?:\/\/(dx\.)?doi\.org\//i.test(v.trim()))) {
      const d = normDoi(v);
      if (/^10\.\d{4,9}\/\S+$/.test(d)) return d;
    }
  }
  return undefined;
};

/** The property whose entries are a source note's references. */
export const REFERENCES_ANCHOR = "references";

/**
 * Every edge's anchor fits the entity model's rule (`[A-Za-z0-9-]+`,
 * schema.ts), and is a pure function of the vault's text:
 *  - a paragraph with a `^id` keeps it;
 *  - a paragraph without one gets `p-` + the first 12 hex digits of its
 *    sha256, the id the review queue writes when such an edge is approved
 *    (review.ts finds the paragraph by its hash and adds this `^id`);
 *  - a library item's `references:` entry: `references-` + the item's cite
 *    key (characters outside the rule become `-`), or its position in the
 *    file when its key has none of them.
 */
export const paragraphAnchor = (p: { anchor: string | null; hash: string }): string => p.anchor ?? `p-${p.hash.replace(/^sha256:/, "").slice(0, 12)}`;

export function libraryAnchor(key: string, index: number): string {
  const slug = key.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${REFERENCES_ANCHOR}-${slug || `item${index + 1}`}`;
}

/** Build the citation graph of the vault's source notes and libraries. */
export function buildCitationGraph(notes: readonly CitingNote[], libraries: readonly CslLibrary[], now = new Date().toISOString()): CitationGraph {
  const entities = new Map<string, Entity>();
  const keyToId = new Map<string, string>();
  const doiToId = new Map<string, string>();
  const nameToId = new Map<string, string>();
  const noteToId = new Map<string, string>();
  const addSource = (key: string, name: string, doi?: string): string => {
    const id = entityId("source", key);
    if (!entities.has(id)) entities.set(id, { id, type: "source", name, aliases: key !== name ? [key] : [] });
    keyToId.set(key.toLowerCase(), id);
    if (doi) doiToId.set(normDoi(doi), id);
    return id;
  };
  for (const lib of libraries)
    for (const item of lib.items) {
      const key = String(item["citation-key"] ?? item.id);
      addSource(key, item.title?.trim() || key, item.DOI);
    }
  const sourceNotes = notes.filter((n) => isSource(n.fm));
  for (const n of sourceNotes) {
    const key = typeof n.fm.citekey === "string" && n.fm.citekey.trim() ? n.fm.citekey.trim() : baseName(n.path);
    const doi = noteDoi(n.fm);
    // The same work as a library item: by its cite key, else by its DOI.
    const id = keyToId.get(key.toLowerCase()) ?? (doi ? doiToId.get(doi) : undefined) ?? addSource(key, baseName(n.path), doi);
    if (doi && !doiToId.has(doi)) doiToId.set(doi, id);
    nameToId.set(baseName(n.path).toLowerCase(), id);
    noteToId.set(n.path, id);
  }

  const edges = new Map<string, Edge>();
  const unresolved: CitationGraph["unresolved"] = [];
  const addEdge = (subject: string, object: string, prov: Omit<Edge["provenance"], "extractor" | "model" | "date">): void => {
    if (subject === object) return;
    const id = `cites:${subject}>${object}`;
    if (edges.has(id)) return; // one edge per pair; the first place it was seen is its provenance
    edges.set(id, { id, subject, predicate: "cites", object, confidence: 1, status: "approved", provenance: { ...prov, extractor: CITATION_EXTRACTOR, model: null, date: now } });
  };

  // 1 and 2: the text of each source note, paragraph by paragraph.
  for (const n of sourceNotes) {
    const from = noteToId.get(n.path)!;
    for (const p of splitParagraphs(n.body)) {
      if (p.kind === "heading") continue;
      for (const k of citedKeys(p.text)) {
        const to = keyToId.get(k.toLowerCase());
        if (to) addEdge(from, to, { note: n.path, anchor: paragraphAnchor(p), quote: `@${k}`, paragraphHash: p.hash });
        else unresolved.push({ from: n.path, key: k, where: "note" });
      }
      for (const m of p.text.matchAll(/(?<!!)\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
        const to = nameToId.get(baseName(m[1].trim()).toLowerCase());
        if (to) addEdge(from, to, { note: n.path, anchor: paragraphAnchor(p), quote: m[0], paragraphHash: p.hash });
      }
    }
  }

  // 3: references of library items (keys or DOIs).
  for (const lib of libraries)
    for (const [index, item] of lib.items.entries()) {
      const refs = Array.isArray(item.references) ? item.references : [];
      const itemKey = String(item["citation-key"] ?? item.id);
      const from = keyToId.get(itemKey.toLowerCase())!;
      const anchor = libraryAnchor(itemKey, index);
      for (const r of refs) {
        if (typeof r !== "string" || !r.trim()) continue;
        const to = keyToId.get(r.trim().toLowerCase()) ?? doiToId.get(normDoi(r));
        if (to) addEdge(from, to, { note: lib.path, anchor, quote: r, paragraphHash: paragraphHash(r) });
        else unresolved.push({ from: lib.path, key: r, where: "references" });
      }
    }

  // 4: references: of source notes (after the libraries, so a pair a library gave keeps its edge).
  for (const n of sourceNotes) {
    const raw = n.fm.references;
    const refs = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
    const from = noteToId.get(n.path)!;
    for (const r of refs) {
      if (typeof r !== "string" || !r.trim()) continue;
      const to = keyToId.get(r.trim().toLowerCase()) ?? doiToId.get(normDoi(r));
      if (to) addEdge(from, to, { note: n.path, anchor: REFERENCES_ANCHOR, quote: r, paragraphHash: paragraphHash(r) });
      else unresolved.push({ from: n.path, key: r, where: "references" });
    }
  }

  return { entities: [...entities.values()], edges: [...edges.values()], unresolved };
}

/** Rows of the alternative table: who cites whom, with where it was seen. */
export function citationRows(g: CitationGraph): Array<{ citing: string; cited: string; where: string; quote: string }> {
  const name = new Map(g.entities.map((e) => [e.id, e.name]));
  return g.edges
    .map((e) => ({ citing: name.get(e.subject) ?? e.subject, cited: name.get(e.object) ?? e.object, where: e.provenance.note, quote: e.provenance.quote }))
    .sort((a, b) => compareCodePoints(a.citing, b.citing) || compareCodePoints(a.cited, b.cited));
}
