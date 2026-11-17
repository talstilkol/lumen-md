/**
 * An approved entity is a plain note (plan W12.E1): `ישויות/<folder>/<name>.md`
 * with YAML front matter Obsidian reads natively — `aliases` is Obsidian's
 * own alias property, `entity-type` the type, and each approved relation a
 * list property of `[[wiki links]]` named after its predicate, so the
 * Properties view, Bases, Dataview and the graph see them without Lumen.
 * The provenance of each relation stays in `.lumen/entities/edges.jsonl`.
 */
import { splitFrontmatter } from "./frontmatter";
import { stringify } from "yaml";
import { ENTITY_ROOT, TYPE_INFO, entityId, entityNotePath, isEntityType, isPredicate, type Edge, type Entity } from "./model";
import { compareNames } from "../i18n/collate";

export const TYPE_PROP = "entity-type";

export interface EntityNote {
  path: string;
  content: string;
}

/** The note for `e`, with its outgoing approved relations as properties. */
export function entityNote(e: Entity, outgoing: readonly Edge[] = [], nameOf: (id: string) => string | undefined = () => undefined): EntityNote {
  // `type:` is what the typed-object registry and its Bases read (W12.T3, entities/types.ts).
  const props: Record<string, unknown> = { type: e.type, [TYPE_PROP]: e.type };
  if (e.aliases.length) props.aliases = [...e.aliases];
  if (e.qid) props.wikidata = e.qid;
  const rel = new Map<string, string[]>();
  for (const x of outgoing) {
    if (x.subject !== e.id || x.status !== "approved") continue;
    const target = nameOf(x.object);
    if (!target) continue;
    const list = rel.get(x.predicate) ?? [];
    const link = `[[${target}]]`;
    if (!list.includes(link)) list.push(link);
    rel.set(x.predicate, list);
  }
  for (const [k, v] of [...rel].sort(([a], [b]) => compareNames(a, b))) props[k] = v;
  const yaml = stringify(props, { lineWidth: 0 }).trimEnd();
  return { path: entityNotePath(e), content: `---\n${yaml}\n---\n\n# ${e.name}\n` };
}

/** The entity a note is, or null when it is not an entity note. */
export function parseEntityNote(path: string, content: string): Entity | null {
  const { props, broken } = splitFrontmatter(content);
  if (broken) return null;
  const type = props[TYPE_PROP];
  if (!isEntityType(type)) return null;
  const base = path.split("/").pop()!.replace(/\.md$/i, "");
  const aliases = Array.isArray(props.aliases) ? props.aliases.filter((a): a is string => typeof a === "string") : typeof props.aliases === "string" ? [props.aliases] : [];
  const e: Entity = { id: entityId(type, base), type, name: base, aliases };
  if (typeof props.wikidata === "string" && /^Q\d+$/.test(props.wikidata)) e.qid = props.wikidata;
  return e;
}

/** The relation properties of an entity note: predicate → linked note names. */
export function relationProps(content: string): Record<string, string[]> {
  const { props } = splitFrontmatter(content);
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!isPredicate(k)) continue;
    const list = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string");
    out[k] = list.map((s) => s.replace(/^\[\[|\]\]$/g, "").split("|")[0]);
  }
  return out;
}

export const isEntityPath = (path: string) => path.startsWith(`${ENTITY_ROOT}/`) && Object.values(TYPE_INFO).some((t) => path.startsWith(`${ENTITY_ROOT}/${t.folder}/`));
