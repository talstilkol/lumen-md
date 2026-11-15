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
 *     Better BibTeX, or what OpenAlex returned): cite keys or DOIs.
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

const normDoi = (v: string): string => v.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:/i, "").toLowerCase();

/** Build the citation graph of the vault's source notes and libraries. */
export function buildCitationGraph(notes: readonly CitingNote[], libraries: readonly CslLibrary[], now = new Date().toISOString()): CitationGraph {
  const entities = new Map<string, Entity>();
  const keyToId = new Map<string, string>();
  const doiToId = new Map<string, string>();
  const nameToId = new Map<string, string>();
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
    const id = keyToId.get(key.toLowerCase()) ?? addSource(key, baseName(n.path));
    nameToId.set(baseName(n.path).toLowerCase(), id);
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
    const key = typeof n.fm.citekey === "string" && n.fm.citekey.trim() ? n.fm.citekey.trim() : baseName(n.path);
    const from = keyToId.get(key.toLowerCase())!;
    for (const p of splitParagraphs(n.body)) {
      if (p.kind === "heading") continue;
      for (const k of citedKeys(p.text)) {
        const to = keyToId.get(k.toLowerCase());
        if (to) addEdge(from, to, { note: n.path, anchor: p.anchor ?? "", quote: `@${k}`, paragraphHash: p.hash });
        else unresolved.push({ from: n.path, key: k, where: "note" });
      }
      for (const m of p.text.matchAll(/(?<!!)\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
        const to = nameToId.get(baseName(m[1].trim()).toLowerCase());
        if (to) addEdge(from, to, { note: n.path, anchor: p.anchor ?? "", quote: m[0], paragraphHash: p.hash });
      }
    }
  }

  // 3: references of library items (keys or DOIs).
  for (const lib of libraries)
    for (const item of lib.items) {
      const refs = Array.isArray(item.references) ? item.references : [];
      const from = keyToId.get(String(item["citation-key"] ?? item.id).toLowerCase())!;
      for (const r of refs) {
        if (typeof r !== "string" || !r.trim()) continue;
        const to = keyToId.get(r.trim().toLowerCase()) ?? doiToId.get(normDoi(r));
        if (to) addEdge(from, to, { note: lib.path, anchor: "", quote: r, paragraphHash: paragraphHash(r) });
        else unresolved.push({ from: lib.path, key: r, where: "references" });
      }
    }

  return { entities: [...entities.values()], edges: [...edges.values()], unresolved };
}

/** Rows of the alternative table: who cites whom, with where it was seen. */
export function citationRows(g: CitationGraph): Array<{ citing: string; cited: string; where: string; quote: string }> {
  const name = new Map(g.entities.map((e) => [e.id, e.name]));
  return g.edges
    .map((e) => ({ citing: name.get(e.subject) ?? e.subject, cited: name.get(e.object) ?? e.object, where: e.provenance.note, quote: e.provenance.quote }))
    .sort((a, b) => a.citing.localeCompare(b.citing) || a.cited.localeCompare(b.cited));
}
