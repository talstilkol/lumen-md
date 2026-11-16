/**
 * What the entity graph view shows (plan W12.E7, with W12.X3's citations),
 * read from the vault: the entity notes under `ישויות/` (W12.E1), the
 * approved edges of `.lumen/entities/edges.jsonl`, and the citation graph
 * (`cites` edges from `[@key]` in source notes, links between source notes,
 * and `references:` of CSL-JSON library items). One list of entities and
 * one of edges, so the view's filters (and its "Citations only") work on
 * both together.
 *
 * Read on this device; nothing is fetched.
 */
import { buildCitationGraph, type CitingNote, type CslLibrary } from "../citations/citationGraph";
import { isLibraryFile, ZOTERO_FILE } from "../citations/library";
import { splitFrontmatter } from "./frontmatter";
import { entityId, type Edge, type Entity } from "./model";
import { isEntityPath, parseEntityNote } from "./notes";
import { EDGES_PATH, readEdges } from "./store";
import type { NoteInfo } from "./view";
import { loadEntityFiles, type EntityVault } from "./vaultIo";

export interface EntityGraphData {
  entities: Entity[];
  edges: Edge[];
  notes: Map<string, NoteInfo>;
  /** The note to open for an entity: its entity note, or the source note it came from. */
  noteOf: Map<string, string>;
  /** `[@key]` citations and references that match no source. */
  unresolved: number;
  /** The notes' text as read (W12.E6: an entity's page shows each mention with its paragraph). */
  texts: ReadonlyMap<string, string>;
}

const tagsOf = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\s]+/) : []).filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().replace(/^#/, ""));

const isSource = (fm: Record<string, unknown>): boolean => (Array.isArray(fm.type) ? fm.type : [fm.type]).some((x) => typeof x === "string" && x.trim().toLowerCase() === "source");

/** The CSL-JSON library files among `texts` (BibTeX has no references, so it adds no citation edge). */
export function cslLibraries(texts: ReadonlyMap<string, string>): CslLibrary[] {
  const out: CslLibrary[] = [];
  for (const [path, text] of texts) {
    if (!(path === ZOTERO_FILE || isLibraryFile(path)) || /\.bib$/i.test(path)) continue;
    try {
      const data = JSON.parse(text) as unknown;
      const items = (Array.isArray(data) ? data : ((data as { items?: unknown[] })?.items ?? [])).filter((x): x is CslLibrary["items"][number] => !!x && typeof x === "object" && "title" in x);
      if (items.length) out.push({ path, items });
    } catch {
      /* why: a broken library file adds nothing; the cite dialog reports it */
    }
  }
  return out;
}

/** The graph of `files` (vault path → text) and the CSL `libraries`. */
export function graphFromFiles(files: ReadonlyMap<string, string>, libraries: readonly CslLibrary[] = []): EntityGraphData {
  const entities = new Map<string, Entity>();
  const noteOf = new Map<string, string>();
  const notes = new Map<string, NoteInfo>();
  const citing: CitingNote[] = [];
  for (const [path, text] of files) {
    if (!path.endsWith(".md")) continue;
    const { props, body, broken } = splitFrontmatter(text);
    if (broken) continue;
    const date = typeof props.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(props.date) ? props.date.slice(0, 10) : undefined;
    notes.set(path, { tags: tagsOf(props.tags), ...(date ? { date } : {}) });
    if (isEntityPath(path)) {
      const e = parseEntityNote(path, text);
      if (e && !entities.has(e.id)) (entities.set(e.id, e), noteOf.set(e.id, path));
    }
    if (isSource(props)) {
      citing.push({ path, fm: props, body });
      const key = typeof props.citekey === "string" && props.citekey.trim() ? props.citekey.trim() : path.split("/").pop()!.replace(/\.md$/i, "");
      const id = entityId("source", key);
      if (!noteOf.has(id)) noteOf.set(id, path);
    }
  }
  const edges = new Map<string, Edge>();
  for (const e of readEdges(files.get(EDGES_PATH) ?? "").edges) if (e.status === "approved") edges.set(e.id, e);
  const cites = buildCitationGraph(citing, libraries);
  // An entity note wins over the citation graph's entity of the same id (it has the user's name and aliases).
  for (const e of cites.entities) if (!entities.has(e.id)) entities.set(e.id, e);
  for (const e of cites.edges) if (!edges.has(e.id)) edges.set(e.id, e);
  return { entities: [...entities.values()], edges: [...edges.values()], notes, noteOf, unresolved: cites.unresolved.length, texts: files };
}

/** Read the vault and build the graph (the app's workspace, or `vault` in tests). */
export async function loadEntityGraph(vault?: EntityVault): Promise<EntityGraphData> {
  const ws = vault ?? ((await import("../storage/workspace")) as unknown as EntityVault);
  const files = await loadEntityFiles(ws);
  const libs = new Map<string, string>();
  for (const { path } of await ws.listWorkspace({ includeHidden: true })) {
    if (path !== ZOTERO_FILE && !isLibraryFile(path)) continue;
    libs.set(path, await ws.readWorkspaceFile(path).catch(() => ""));
  }
  return graphFromFiles(files, cslLibraries(libs));
}
