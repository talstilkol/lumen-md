/**
 * The type registry (plan W12.T1): every type with its single-parent
 * inheritance resolved, and — for a note — the types it has and its
 * effective fields. Pure: it reads type definitions and a note's
 * frontmatter and tags (the vault index already has both), and writes
 * nothing. A note's data is its frontmatter, as before.
 *
 * Inheritance, as Tana's "Extend":
 * - a child inherits every field of its parent, in the parent's order;
 * - it may add fields (after the inherited ones) and change an inherited
 *   field's default, label, options or pinning;
 * - it may not remove an inherited field, nor change its kind: either is
 *   an error on the child, and the inherited field stays.
 *
 * Errors never drop a note's data: a note whose type was deleted keeps
 * every key, and is listed with the unknown type name.
 */
import { normTypeId, parseTypeFile, typeIdFromPath, type FieldDef, type TypeDef } from "./typeSchema";
import { tagMatches } from "../views/bases/evalHelpers";

export interface ResolvedType extends TypeDef {
  /** This type, then its parent, up to the root. */
  chain: string[];
  /** Inherited fields first (parent order, overrides applied in place), then this type's new ones. */
  effective: FieldDef[];
  /** Field name → the type that first declared it. */
  declaredBy: Record<string, string>;
  /** Problems with this type (its file still loads where it can). */
  errors: string[];
}

export interface TypeRegistry {
  /** Every loaded type by id, in id order. */
  readonly types: ReadonlyMap<string, ResolvedType>;
  /** Problems that are not one type's own (duplicate ids, shared labels or tags, unreadable files). */
  readonly errors: readonly string[];
  /** Notices (a vault type replacing a built-in one, warnings from the files). */
  readonly notices: readonly string[];
  get(id: string): ResolvedType | undefined;
  /** A `type:` value (id, or Hebrew / English label) → the type id; null when unknown or ambiguous. */
  resolveName(name: string): string | null;
  /** The types that extend `id`, at any depth (not `id` itself). */
  descendants(id: string): string[];
}

export interface NoteLike {
  /** The note's frontmatter. */
  fm: Record<string, unknown>;
  /** Its tags without `#` (frontmatter and inline, as the vault index has them). */
  tags?: readonly string[];
}

export interface NoteTypes {
  /** The note's types, in the order they apply: `type:` values first, then tags. */
  types: ResolvedType[];
  /** `type:` values that name no type (a deleted or misspelled one): reported, nothing removed. */
  unknown: string[];
}

export interface EffectiveField extends FieldDef {
  /** The note's type this field came through. */
  via: string;
}

export interface NoteFields {
  fields: EffectiveField[];
  /** The same field name with different kinds in two of the note's types: the first type wins. */
  conflicts: Array<{ field: string; kept: { type: string; kind: string }; dropped: { type: string; kind: string } }>;
}

const lower = (s: string) => s.normalize("NFC").toLowerCase();

/** A registry from type definitions (files and built-ins). A vault type replaces a built-in one with the same id. */
export function buildTypeRegistry(defs: readonly TypeDef[], extraErrors: readonly string[] = [], extraNotices: readonly string[] = []): TypeRegistry {
  const errors: string[] = [...extraErrors];
  const notices: string[] = [...extraNotices];
  const byId = new Map<string, TypeDef>();
  // Vault types after built-ins, each group by source, so the result does not depend on input order.
  const ordered = [...defs].sort((a, b) => (a.origin === b.origin ? (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) : a.origin === "builtin" ? -1 : 1));
  for (const d of ordered) {
    const had = byId.get(d.id);
    if (!had) byId.set(d.id, d);
    else if (had.origin === "builtin" && d.origin === "vault") {
      byId.set(d.id, d);
      notices.push(`${d.source} replaces the built-in type '${d.id}' (${had.source})`);
    } else errors.push(`type '${d.id}' is declared twice: ${had.source} and ${d.source}; using ${had.source}`);
  }
  const resolved = new Map<string, ResolvedType>();
  const visiting = new Set<string>();
  const resolve = (id: string): ResolvedType | undefined => {
    const hit = resolved.get(id);
    if (hit) return hit;
    const d = byId.get(id);
    if (!d) return undefined;
    const r: ResolvedType = { ...d, chain: [id], effective: [], declaredBy: {}, errors: [] };
    visiting.add(id);
    let parent: ResolvedType | undefined;
    if (d.extends) {
      if (visiting.has(d.extends)) r.errors.push(`${d.source}: extends ${d.extends}, which extends ${id} again (a cycle); the parent is ignored`);
      else if (!byId.has(d.extends)) r.errors.push(`${d.source}: extends unknown type '${d.extends}'; the parent is ignored`);
      else {
        parent = resolve(d.extends);
        if (parent && parent.chain.includes(id)) {
          r.errors.push(`${d.source}: extends ${d.extends}, which extends ${id} again (a cycle); the parent is ignored`);
          parent = undefined;
        }
      }
    }
    visiting.delete(id);
    const fields: FieldDef[] = parent ? parent.effective.map((f) => ({ ...f })) : [];
    if (parent) {
      r.chain = [id, ...parent.chain];
      Object.assign(r.declaredBy, parent.declaredBy);
    }
    const index = new Map(fields.map((f, i) => [lower(f.name), i]));
    for (const name of d.removed) {
      if (index.has(lower(name))) r.errors.push(`${d.source}: fields.${name}: inherited from ${r.declaredBy[fields[index.get(lower(name))!].name]}; an inherited field cannot be removed`);
      else notices.push(`${d.source}: fields.${name}: removes nothing (no inherited field of that name)`);
    }
    for (const f of d.fields) {
      const at = index.get(lower(f.name));
      if (at === undefined) {
        index.set(lower(f.name), fields.length);
        fields.push({ ...f });
        r.declaredBy[f.name] = id;
        continue;
      }
      const base = fields[at];
      if (base.kind !== f.kind) {
        r.errors.push(`${d.source}: fields.${f.name}: inherited as ${base.kind} from ${r.declaredBy[base.name]}; a child cannot change it to ${f.kind}`);
        continue;
      }
      // An override: what the child says wins, the rest is inherited.
      const merged: FieldDef = { ...base, name: base.name };
      if (f.default !== undefined) merged.default = f.default;
      if (f.label) merged.label = { ...base.label, ...f.label };
      if (f.pinned) merged.pinned = true;
      if (f.options && f.options.length) merged.options = f.options;
      if (f.to && f.to !== base.to) r.errors.push(`${d.source}: fields.${f.name}: inherited as a relation to ${base.to}; a child cannot point it at ${f.to}`);
      fields[at] = merged;
    }
    r.effective = fields;
    resolved.set(id, r);
    return r;
  };
  for (const id of [...byId.keys()].sort()) resolve(id);
  const types = new Map([...resolved.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));

  // Names: id, then labels. A label two types share names neither.
  const names = new Map<string, string | null>();
  for (const t of types.values()) names.set(lower(t.id), t.id);
  for (const t of types.values())
    for (const l of [t.label.he, t.label.en]) {
      if (!l) continue;
      const k = lower(l);
      const had = names.get(k);
      if (had === undefined) names.set(k, t.id);
      else if (had !== t.id && !types.has(k)) {
        if (had !== null) errors.push(`the label '${l}' names two types (${had} and ${t.id}); use the id in type:`);
        names.set(k, null);
      }
    }
  const tags = new Map<string, string>();
  for (const t of types.values()) {
    if (!t.tag) continue;
    const k = lower(t.tag);
    const had = tags.get(k);
    if (had) errors.push(`the tag #${t.tag} activates two types (${had} and ${t.id}); a note with it gets both`);
    else tags.set(k, t.id);
  }
  for (const t of types.values()) for (const f of t.effective) if (f.kind === "relation" && f.to && !types.has(f.to)) t.errors.push(`${t.source}: fields.${f.name}: relation to unknown type '${f.to}'`);

  const children = new Map<string, string[]>();
  for (const t of types.values()) if (t.chain.length > 1) children.set(t.chain[1], [...(children.get(t.chain[1]) ?? []), t.id]);
  return {
    types,
    errors,
    notices,
    get: (id) => types.get(normTypeId(id)),
    resolveName(name) {
      const k = lower(normTypeId(String(name).replace(/^\[\[|\]\]$/g, "")));
      return names.get(k) ?? null;
    },
    descendants(id) {
      const out: string[] = [];
      const walk = (x: string) => {
        for (const c of children.get(x) ?? []) {
          if (out.includes(c)) continue;
          out.push(c);
          walk(c);
        }
      };
      walk(normTypeId(id));
      return out;
    },
  };
}

/** A registry from the vault's `.lumen/types/*.yaml` files, plus built-in types (W12.E1's entity types). */
export function loadTypeRegistry(files: Iterable<{ path: string; text: string }>, builtins: readonly TypeDef[] = []): TypeRegistry {
  const defs: TypeDef[] = [...builtins];
  const errors: string[] = [];
  const notices: string[] = [];
  for (const f of files) {
    if (typeIdFromPath(f.path) === null) continue;
    const p = parseTypeFile(f.path, f.text);
    if (p.ok) {
      defs.push(p.type);
      notices.push(...p.warnings);
    } else errors.push(p.error);
  }
  return buildTypeRegistry(defs, errors, notices);
}

/** The `type:` values of a frontmatter: a text, or a list of texts. */
export function typeValues(fm: Record<string, unknown>): string[] {
  const v = fm.type;
  const list = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v];
  return list.map((x) => String(x ?? "").trim()).filter(Boolean);
}

/** The note's types (W12.T1): by `type:` (id or label), then by tag; each once. */
export function typesOfNote(reg: TypeRegistry, note: NoteLike): NoteTypes {
  const out: ResolvedType[] = [];
  const unknown: string[] = [];
  const add = (id: string) => {
    const t = reg.types.get(id);
    if (t && !out.includes(t)) out.push(t);
  };
  for (const v of typeValues(note.fm)) {
    const id = reg.resolveName(v);
    if (id) add(id);
    else unknown.push(v);
  }
  if (note.tags && note.tags.length) for (const t of reg.types.values()) if (t.tag && note.tags.some((g) => tagMatches(g, t.tag!))) add(t.id);
  return { types: out, unknown };
}

/** Is the note of type `id`, directly or through a child type (a ספר is a יצירה when ספר extends יצירה)? */
export function noteIsA(reg: TypeRegistry, note: NoteLike, id: string): boolean {
  const want = normTypeId(id);
  return typesOfNote(reg, note).types.some((t) => t.chain.includes(want));
}

/** The note's effective fields: every field of every type it has, each name once. */
export function fieldsOfNote(reg: TypeRegistry, note: NoteLike): NoteFields {
  const fields: EffectiveField[] = [];
  const conflicts: NoteFields["conflicts"] = [];
  const at = new Map<string, number>();
  for (const t of typesOfNote(reg, note).types)
    for (const f of t.effective) {
      const k = lower(f.name);
      const i = at.get(k);
      if (i === undefined) {
        at.set(k, fields.length);
        fields.push({ ...f, via: t.id });
      } else if (fields[i].kind !== f.kind) conflicts.push({ field: f.name, kept: { type: fields[i].via, kind: fields[i].kind }, dropped: { type: t.id, kind: f.kind } });
    }
  return { fields, conflicts };
}
