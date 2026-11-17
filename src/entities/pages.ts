/**
 * Entity pages and Bases (plan W12.E6).
 *
 * - `entityPage`: an entity's fields, its outgoing and incoming relations
 *   grouped by predicate, and every mention in the vault with its paragraph
 *   (the name or an alias, with or without a Hebrew prefix, or a link to
 *   the entity's note). Each edge links to its source paragraph
 *   (`[[note#^id]]`) and says whether that paragraph still exists.
 * - `entityBase`: an Obsidian Bases file per type, listing the type's notes
 *   with their aliases and relation properties, so Bases and Obsidian show
 *   "אנשים", "חוקים", "מקורות" with no Lumen code.
 */
import { stringify } from "yaml";
import { ENTITY_ROOT, PREDICATES, TYPE_INFO, type Edge, type Entity, type EntityType } from "./model";
import { paragraphByAnchor, splitParagraphs } from "./paragraphs";
import { edgeSourceState, type SourceState } from "./provenance";

export interface PageEdge {
  edge: Edge;
  /** The entity at the other end. */
  other: string;
  /** `[[note#^anchor]]`, Obsidian's block link. */
  link: string;
  source: SourceState;
}

export interface PageMention {
  note: string;
  anchor: string | null;
  /** The paragraph's text, for context. */
  paragraph: string;
  /** Offsets of the name inside `paragraph`. */
  start: number;
  end: number;
}

export interface EntityPageModel {
  entity: Entity;
  outgoing: Array<{ predicate: string; edges: PageEdge[] }>;
  incoming: Array<{ predicate: string; edges: PageEdge[] }>;
  mentions: PageMention[];
}

const PREFIX_RE = "(?:[והבכלמש]{1,3})?";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A regex for the entity's names in text: whole words, an optional Hebrew prefix, or a wiki link to its note. */
export function mentionPattern(e: Pick<Entity, "name" | "aliases">): RegExp {
  const names = [e.name, ...e.aliases].filter((n) => n.trim()).sort((a, b) => b.length - a.length).map(esc);
  const alt = names.join("|");
  return new RegExp(`\\[\\[${esc(e.name)}(?:[#|][^\\]]*)?\\]\\]|(?<![\\p{L}\\p{M}])${PREFIX_RE}(?:${alt})(?![\\p{L}\\p{M}])`, "gu");
}

export function entityPage(entity: Entity, edges: readonly Edge[], notes: ReadonlyMap<string, string>, opts: { maxMentions?: number } = {}): EntityPageModel {
  const group = (side: "out" | "in") => {
    const by = new Map<string, PageEdge[]>();
    for (const e of edges) {
      if ((side === "out" ? e.subject : e.object) !== entity.id) continue;
      const pe: PageEdge = {
        edge: e,
        other: side === "out" ? e.object : e.subject,
        link: `[[${e.provenance.note.replace(/\.md$/i, "")}#^${e.provenance.anchor}]]`,
        source: edgeSourceState(e.provenance, notes.get(e.provenance.note) ?? null),
      };
      (by.get(e.predicate) ?? by.set(e.predicate, []).get(e.predicate)!).push(pe);
    }
    const order = PREDICATES.map((p) => p.id);
    return [...by].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)).map(([predicate, list]) => ({ predicate, edges: list }));
  };
  const re = mentionPattern(entity);
  const mentions: PageMention[] = [];
  const max = opts.maxMentions ?? 5000;
  outer: for (const [path, content] of notes) {
    if (path.startsWith(`${ENTITY_ROOT}/`) || !path.endsWith(".md")) continue;
    re.lastIndex = 0;
    if (!re.test(content)) continue;
    for (const p of splitParagraphs(content)) {
      re.lastIndex = 0;
      for (const m of p.text.matchAll(re)) {
        mentions.push({ note: path, anchor: p.anchor, paragraph: p.text, start: m.index!, end: m.index! + m[0].length });
        if (mentions.length >= max) break outer;
      }
    }
  }
  return { entity, outgoing: group("out"), incoming: group("in"), mentions };
}

/** Whether an edge's block link reaches a paragraph that exists. */
export const edgeLinkExists = (e: Edge, notes: ReadonlyMap<string, string>): boolean => {
  const c = notes.get(e.provenance.note);
  return c !== undefined && paragraphByAnchor(c, e.provenance.anchor) !== null;
};

/** The Bases file for one type: `ישויות/<folder>.base`. */
export function entityBase(type: EntityType): { path: string; content: string } {
  const info = TYPE_INFO[type];
  const rels = PREDICATES.filter((p) => !p.domain || p.domain.includes(type)).map((p) => `note.${p.id}`);
  const base = {
    filters: { and: [`file.inFolder("${ENTITY_ROOT}/${info.folder}")`, `note["entity-type"] == "${type}"`] },
    views: [{ type: "table", name: info.he, order: ["file.name", "note.aliases", ...rels] }],
  };
  return { path: `${ENTITY_ROOT}/${info.folder}.base`, content: stringify(base, { lineWidth: 0 }) };
}
