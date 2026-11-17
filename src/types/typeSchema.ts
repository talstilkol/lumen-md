/**
 * Typed objects (plan W12.T1, decision N1): a type is a plain YAML file in
 * the vault, `.lumen/types/<id>.yaml`. The notes it types stay ordinary
 * Markdown with ordinary frontmatter, so Obsidian reads the same files; the
 * type only says which keys a note of that kind has, their kinds, defaults
 * and order. Nothing here writes a note.
 *
 *   label: { he: ספר, en: Book }
 *   tag: book                  # a note with this tag is a ספר (also `type: book`)
 *   extends: work              # one parent at most, like Tana's "Extend"
 *   fields:                    # in display order
 *     author:  { type: relation, to: person, pinned: true }
 *     pages:   { type: number, default: 0 }
 *     status:  { type: select, options: [to-read, reading, done], default: to-read, pinned: true }
 *     read_on: { type: hebrew-date }
 *     ppu:     { type: formula, formula: "price / pages" }
 *
 * A note is of type `book` when its frontmatter says `type: book` (or a list
 * that holds it, or the type's Hebrew or English label), or when it carries
 * the type's `tag:` (nested tags count: `book/novel`).
 *
 * Formula fields are Bases expressions (src/views/bases, built on the
 * formula engine's tree, limits and errors in src/views/formula), because a
 * type's Base is saved as a `.base` file that Obsidian must run as well.
 * This is the existing engine, not a second one.
 *
 * The schema is also built from code (`typeDefFromObject`), so other
 * features can ship their own types — the entity graph's seven entity types
 * (W12.E1) are types like any other, and a vault file with the same id
 * replaces the built-in one.
 */
import YAML from "yaml";
import { parseBases } from "../views/bases/catalogue";

/** The folder of the vault's type files. */
export const TYPES_DIR = ".lumen/types";

export const FIELD_KINDS = ["text", "number", "date", "hebrew-date", "select", "multi-select", "relation", "checkbox", "url", "formula", "rollup"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const ROLLUP_FNS = ["count", "sum", "avg", "min", "max", "earliest", "latest", "workdays"] as const;
export type RollupFn = (typeof ROLLUP_FNS)[number];

/** Frontmatter keys a type may not declare: they say what a note is, not what it holds. */
export const RESERVED_FIELDS = new Set(["type", "tags", "tag", "aliases", "alias", "cssclasses"]);

export interface Label {
  he?: string;
  en?: string;
}

export interface FieldDef {
  /** The frontmatter key. */
  name: string;
  kind: FieldKind;
  label?: Label;
  /** A default for new notes of the type (never written into existing notes). */
  default?: unknown;
  /** Pinned fields are the type's Base columns and stay on top of the form. */
  pinned: boolean;
  /** select / multi-select: the allowed values. */
  options?: string[];
  /** relation: the target type id. */
  to?: string;
  /** relation: several links (a list), else one. */
  multiple?: boolean;
  /**
   * relation: the computed reverse field on the target type (`books` on
   * `person` for `book.author → person`). Never written to a file, unless
   * `twoWay` is set (W12.T6).
   */
  inverse?: string;
  /** relation: the user asked for both directions to be written. */
  twoWay?: boolean;
  /** formula: a Bases expression. */
  formula?: string;
  /** rollup (W12.T6): a function over `property` of the notes of the relation field `relation`. */
  relation?: string;
  property?: string;
  fn?: RollupFn;
}

export interface TypeDef {
  /** The type id: the file's base name (`book` for `.lumen/types/book.yaml`). */
  id: string;
  label: Label;
  /** Tag that activates the type, without `#`. */
  tag?: string;
  extends?: string;
  /** The type's own fields, in file order (inherited ones are added by the registry). */
  fields: FieldDef[];
  /** Fields declared `null` or `remove: true`: the registry refuses them when inherited. */
  removed: string[];
  /** Body of a new note of the type (W12.T2), or the path of a template note. */
  template?: string;
  /** Where it came from: the vault path, or `builtin:<feature>`. */
  source: string;
  origin: "vault" | "builtin";
}

export type TypeParse = { ok: true; type: TypeDef; warnings: string[] } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

/** A type id: letters (any script), digits, `-` and `_`. Lower-cased. */
export function normTypeId(s: string): string {
  return s.trim().replace(/^#/, "").normalize("NFC").toLowerCase();
}

const ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;

/** `.lumen/types/book.yaml` → `book`; null when the path is not a type file. */
export function typeIdFromPath(path: string): string | null {
  const m = /^\.lumen\/types\/([^/]+)\.ya?ml$/i.exec(path.replace(/\\/g, "/").replace(/^\/+/, ""));
  if (!m) return null;
  const id = normTypeId(m[1]);
  return ID_RE.test(id) ? id : null;
}

export function typeFilePath(id: string): string {
  return `${TYPES_DIR}/${id}.yaml`;
}

function readLabel(v: unknown): Label {
  if (typeof v === "string") return /[֐-׿]/.test(v) ? { he: v } : { en: v };
  if (!isRecord(v)) return {};
  const out: Label = {};
  if (typeof v.he === "string" && v.he.trim()) out.he = v.he.trim();
  if (typeof v.en === "string" && v.en.trim()) out.en = v.en.trim();
  return out;
}

const KIND_ALIASES: Record<string, FieldKind> = {
  string: "text",
  multiselect: "multi-select",
  multi: "multi-select",
  list: "multi-select",
  tags: "multi-select",
  bool: "checkbox",
  boolean: "checkbox",
  hebrewdate: "hebrew-date",
  "hebrew_date": "hebrew-date",
  link: "relation",
  datetime: "date",
};

function readKind(v: unknown): FieldKind | null {
  const s = String(v ?? "text").trim().toLowerCase();
  if ((FIELD_KINDS as readonly string[]).includes(s)) return s as FieldKind;
  return KIND_ALIASES[s] ?? null;
}

/** One field from its YAML value (`{ type: number }`, or just `number`). */
function readField(name: string, raw: unknown, where: string, warnings: string[]): FieldDef {
  const spec = typeof raw === "string" ? { type: raw } : raw;
  if (!isRecord(spec)) throw new Error(`${where}: a field is a kind (text, number, …) or a map with type:`);
  const kind = readKind(spec.type ?? spec.kind);
  if (!kind) throw new Error(`${where}: unknown field type '${String(spec.type)}' (one of ${FIELD_KINDS.join(", ")})`);
  const f: FieldDef = { name, kind, pinned: spec.pinned === true };
  const label = readLabel(spec.label);
  if (label.he || label.en) f.label = label;
  if ("default" in spec && spec.default !== null && spec.default !== undefined) f.default = spec.default instanceof Date ? spec.default.toISOString().slice(0, 10) : spec.default;
  if (kind === "select" || kind === "multi-select") {
    const opts = Array.isArray(spec.options) ? spec.options : [];
    f.options = [...new Set(opts.filter((x) => x !== null && x !== undefined).map((x) => String(x)))];
    if (!f.options.length) warnings.push(`${where}: a ${kind} field has no options; any value is accepted`);
  }
  if (kind === "relation") {
    if (typeof spec.to !== "string" || !spec.to.trim()) throw new Error(`${where}: a relation needs to: <type>`);
    f.to = normTypeId(spec.to);
    f.multiple = spec.multiple === true;
    if (typeof spec.inverse === "string" && spec.inverse.trim()) f.inverse = spec.inverse.trim();
    if (spec.twoWay === true || spec.two_way === true) f.twoWay = true;
    if (f.twoWay && !f.inverse) throw new Error(`${where}: twoWay needs inverse: <field on ${f.to}>`);
  }
  if (kind === "formula") {
    if (typeof spec.formula !== "string" || !spec.formula.trim()) throw new Error(`${where}: a formula field needs formula: <expression>`);
    const p = parseBases(spec.formula);
    if (!p.ok) throw new Error(`${where}: ${p.error.message}`);
    f.formula = spec.formula.trim();
    if ("default" in f) {
      warnings.push(`${where}: a formula field has no default; ignored`);
      delete f.default;
    }
  }
  if (kind === "rollup") {
    if (typeof spec.relation !== "string" || !spec.relation.trim()) throw new Error(`${where}: a rollup needs relation: <relation field>`);
    f.relation = spec.relation.trim();
    const fn = String(spec.function ?? spec.fn ?? "count").toLowerCase();
    if (!(ROLLUP_FNS as readonly string[]).includes(fn)) throw new Error(`${where}: function is one of ${ROLLUP_FNS.join(", ")}`);
    f.fn = fn as RollupFn;
    if (typeof spec.property === "string" && spec.property.trim()) f.property = spec.property.trim().replace(/^note\./, "");
    else if (fn !== "count") throw new Error(`${where}: ${fn} needs property: <field of the related notes>`);
    if ("default" in f) delete f.default;
  }
  return f;
}

/** A type from a plain object (a parsed file, or a built-in type in code). Never throws. */
export function typeDefFromObject(id: string, raw: unknown, source: string, origin: "vault" | "builtin" = "builtin"): TypeParse {
  const warnings: string[] = [];
  const tid = normTypeId(id);
  if (!ID_RE.test(tid)) return { ok: false, error: `${source}: '${id}' is not a type id (letters, digits, - and _)` };
  if (raw === null || raw === undefined) raw = {};
  if (!isRecord(raw)) return { ok: false, error: `${source}: a type file is a YAML map (label:, tag:, extends:, fields:)` };
  try {
    const t: TypeDef = { id: tid, label: readLabel(raw.label ?? raw.name), fields: [], removed: [], source, origin };
    if (typeof raw.tag === "string" && raw.tag.trim()) t.tag = raw.tag.trim().replace(/^#/, "");
    if (raw.extends !== undefined && raw.extends !== null) {
      if (Array.isArray(raw.extends)) {
        if (raw.extends.length > 1) throw new Error(`${source}: extends takes one parent type, not ${raw.extends.length}`);
        if (raw.extends.length === 1) t.extends = normTypeId(String(raw.extends[0]));
      } else if (typeof raw.extends === "string" && raw.extends.trim()) t.extends = normTypeId(raw.extends);
      else throw new Error(`${source}: extends is one type id`);
      if (t.extends === tid) throw new Error(`${source}: a type cannot extend itself`);
    }
    if (typeof raw.template === "string") t.template = raw.template;
    const fields = raw.fields ?? {};
    // A list of `{ name, type }` is accepted too (keeps order the same way).
    const entries: Array<[string, unknown]> = Array.isArray(fields)
      ? fields.map((x, i) => (isRecord(x) && typeof x.name === "string" ? ([x.name, x] as [string, unknown]) : ([`#${i}`, x] as [string, unknown])))
      : isRecord(fields)
        ? Object.entries(fields)
        : (() => {
            throw new Error(`${source}: fields is a map of name: kind`);
          })();
    const seen = new Set<string>();
    for (const [rawName, spec] of entries) {
      const name = rawName.trim();
      const where = `${source}: fields.${name}`;
      if (!name || name.startsWith("#")) throw new Error(`${where}: a field needs a name`);
      const key = name.normalize("NFC").toLowerCase();
      if (seen.has(key)) throw new Error(`${where}: declared twice`);
      seen.add(key);
      if (RESERVED_FIELDS.has(key)) throw new Error(`${where}: '${name}' is reserved (it says what the note is)`);
      if (spec === null || (isRecord(spec) && spec.remove === true)) {
        t.removed.push(name);
        continue;
      }
      t.fields.push(readField(name, spec, where, warnings));
    }
    for (const f of t.fields)
      if (f.kind === "rollup" && !t.fields.some((g) => g.name === f.relation && g.kind === "relation") && !t.extends)
        warnings.push(`${source}: fields.${f.name}: no relation field '${f.relation}' on this type (an inverse relation is resolved by the registry)`);
    return { ok: true, type: t, warnings };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Parse `.lumen/types/<id>.yaml`. Never throws. */
export function parseTypeFile(path: string, text: string): TypeParse {
  const id = typeIdFromPath(path);
  if (!id) return { ok: false, error: `${path}: not a type file (.lumen/types/<id>.yaml)` };
  let raw: unknown;
  try {
    const doc = YAML.parseDocument(text, { prettyErrors: false });
    if (doc.errors.length) return { ok: false, error: `${path}: ${doc.errors[0].message}` };
    raw = doc.toJS();
  } catch (e) {
    return { ok: false, error: `${path}: ${(e as Error).message}` };
  }
  return typeDefFromObject(id, raw, path, "vault");
}

/** The YAML of a type, for a new type file (Object Studio, W12.T2). */
export function typeToYaml(t: Pick<TypeDef, "label" | "tag" | "extends" | "fields" | "template">): string {
  const fields: Record<string, unknown> = {};
  for (const f of t.fields) {
    const spec: Record<string, unknown> = { type: f.kind };
    if (f.label) spec.label = f.label;
    if (f.pinned) spec.pinned = true;
    if (f.default !== undefined) spec.default = f.default;
    if (f.options) spec.options = f.options;
    if (f.to) spec.to = f.to;
    if (f.multiple) spec.multiple = true;
    if (f.inverse) spec.inverse = f.inverse;
    if (f.twoWay) spec.twoWay = true;
    if (f.formula) spec.formula = f.formula;
    if (f.relation) spec.relation = f.relation;
    if (f.property) spec.property = f.property;
    if (f.fn) spec.function = f.fn;
    fields[f.name] = spec;
  }
  const out: Record<string, unknown> = {};
  if (t.label.he || t.label.en) out.label = t.label;
  if (t.tag) out.tag = t.tag;
  if (t.extends) out.extends = t.extends;
  out.fields = fields;
  if (t.template) out.template = t.template;
  return YAML.stringify(out, { lineWidth: 0 });
}
