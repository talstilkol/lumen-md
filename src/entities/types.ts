/**
 * The seven entity types as built-in typed-object types (plan W12.T3 with
 * W12.E1): each gets its own Base, the "All <type>" entry in ⌘K and the
 * field form, from the registry, with nothing written to the vault.
 *
 * An approved entity note says `type: <id>` (entities/notes.ts), which is
 * how the registry and its Bases find it; `entity-type` stays for older
 * notes and the exports. Fields:
 * - `wikidata`: the item's QID once the user links it (W12.E10);
 * - one relation field per predicate whose subject may be this type and
 *   whose object is one type (`born_in` → place): a list of `[[links]]`,
 *   which is how approved relations are written. Predicates whose object
 *   may be several types (`author`: a person or an organization) stay plain
 *   properties.
 * `aliases` is Obsidian's own property, reserved by the registry.
 *
 * `source` is also the reading list's type (W12.X2): one built-in type with
 * the reading list's fields (status, progress, citekey, …, and its #source
 * tag) and the entity fields, so the two features never declare it twice.
 */
import { ENTITY_TYPES, PREDICATES, type EntityType } from "./model";
import { typeDefFromObject, type TypeDef } from "../types/typeSchema";
import { SOURCE_TYPE_OBJECT } from "../reading/sourceType";

/** Plural labels: the type's Base and its ⌘K entry ("All People", "כל האנשים"). */
const PLURAL: Record<EntityType, { he: string; en: string }> = {
  person: { he: "אנשים", en: "People" },
  place: { he: "מקומות", en: "Places" },
  organization: { he: "ארגונים", en: "Organizations" },
  event: { he: "אירועים", en: "Events" },
  law: { he: "חוקים", en: "Laws" },
  source: { he: "מקורות", en: "Sources" },
  concept: { he: "מושגים", en: "Concepts" },
};

export const ENTITY_TYPES_FEATURE = "entities";

export function entityTypeObject(type: EntityType): Record<string, unknown> {
  const fields: Record<string, unknown> = { wikidata: { type: "text", label: { he: "Wikidata", en: "Wikidata" }, pinned: true } };
  for (const p of PREDICATES) {
    if (p.domain && !p.domain.includes(type)) continue;
    if (!p.range || p.range.length !== 1) continue;
    fields[p.id] = { type: "relation", to: p.range[0], multiple: true, label: { he: p.he, en: p.en } };
  }
  if (type === "source") return { label: PLURAL[type], tag: SOURCE_TYPE_OBJECT.tag, fields: { ...SOURCE_TYPE_OBJECT.fields, ...fields } };
  return { label: PLURAL[type], fields };
}

/** The built-in defs (never fails: a def that does not parse is a bug, and throws). */
export function entityTypeDefs(): TypeDef[] {
  return ENTITY_TYPES.map((type) => {
    const p = typeDefFromObject(type, entityTypeObject(type), `builtin:${ENTITY_TYPES_FEATURE}`);
    if (!p.ok) throw new Error(p.error);
    return p.type;
  });
}
