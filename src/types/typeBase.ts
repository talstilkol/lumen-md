/**
 * A Base for every type (plan W12.T3), with typed relations and rollups
 * (W12.T6).
 *
 * Every type gets a virtual base at run time, built from its schema:
 * - a filter for the type (its notes and its child types' notes);
 * - columns: the name, then the pinned fields; then every rollup and every
 *   computed reverse relation (T6);
 * - views: table, cards, and a kanban grouped by the first select field.
 *
 * The base is ordinary Obsidian `.base` YAML (`typeBaseText`), so "Save as
 * .base" writes a real file. Relations and rollups are Lumen's `relations:` /
 * `rollups:` keys (W1.12), which Obsidian keeps but does not show.
 * Changing the schema changes the virtual base at once. A saved file never
 * changes without the user's approval: `savedBaseUpdate` proposes the new
 * text, and the caller asks.
 *
 * Typed relations (T6). A relation field `book.author → person`:
 * - on `book`, `relation.author` is the linked people;
 * - on `person`, the reverse (`books`, or `book_author` when unnamed) is
 *   computed from the books' `author:` and filtered to books. It is never
 *   written to a file, unless the field says `twoWay`, which makes the
 *   reverse an ordinary stored field of the target type.
 * - a rollup field (`{ type: rollup, relation: books, property: pages,
 *   function: sum }`) is count / sum / avg / min / max / earliest / latest /
 *   workdays (W10.C26) over the other side.
 */
import YAML from "yaml";
import { parseBase, runBase, sameBaseData, type BaseModel, type BaseResult, type BasesFilter, type RunOptions } from "../views/bases/base";
import type { BasesFile } from "../views/bases/values";
import type { FieldDef, Label } from "./typeSchema";
import { noteIsA, type ResolvedType, type TypeRegistry } from "./typeRegistry";

export interface TypeBaseOptions {
  /** Labels in this language first (`he` default). */
  lang?: "he" | "en";
}

/** A reverse relation another type's relation field gives this type (W12.T6). */
export interface InverseRelation {
  /** The relation name on this type (`books`). */
  name: string;
  /** The type that has the field (`book`), and the field (`author`). */
  fromType: string;
  field: string;
  /** Stored as a field of this type (twoWay) instead of computed. */
  stored: boolean;
  label?: Label;
}

const q = (s: string) => JSON.stringify(s);
const labelOf = (l: Label | undefined, lang: "he" | "en", fallback: string) => (lang === "he" ? (l?.he ?? l?.en) : (l?.en ?? l?.he)) ?? fallback;

/** The type and its child types, as `type:` names and tags a saved .base can test. */
function matchNames(reg: TypeRegistry, t: ResolvedType): { names: string[]; tags: string[] } {
  const names: string[] = [];
  const tags: string[] = [];
  for (const id of [t.id, ...reg.descendants(t.id)]) {
    const x = reg.get(id)!;
    for (const n of [x.id, x.label.he, x.label.en]) if (n && !names.includes(n)) names.push(n);
    if (x.tag && !tags.includes(x.tag)) tags.push(x.tag);
  }
  return { names, tags };
}

/** The `.base` filter for a type: `type:` holds one of its names, or the note has its tag (nested tags too). */
export function typeFilter(reg: TypeRegistry, typeId: string): BasesFilter {
  const t = reg.get(typeId);
  if (!t) throw new Error(`no type '${typeId}'`);
  const { names, tags } = matchNames(reg, t);
  const or: BasesFilter[] = [`list(note.type).containsAny(${names.map(q).join(", ")})`];
  for (const tag of tags) or.push(`file.hasTag(${q(tag)})`);
  return or.length === 1 ? or[0] : { or };
}

/** The reverse relations that point at this type or one of its parents (W12.T6). */
export function inverseRelations(reg: TypeRegistry, typeId: string): InverseRelation[] {
  const t = reg.get(typeId);
  if (!t) return [];
  const out: InverseRelation[] = [];
  for (const src of reg.types.values())
    for (const f of src.effective) {
      if (f.kind !== "relation" || !f.to || !t.chain.includes(f.to)) continue;
      // An inherited relation field is the parent's: list it once, under the type that declared it.
      if (src.declaredBy[f.name] !== src.id) continue;
      const name = f.inverse ?? `${src.id}_${f.name}`;
      if (out.some((x) => x.name === name)) continue;
      out.push({ name, fromType: src.id, field: f.name, stored: !!f.twoWay, ...(f.label ? { label: f.label } : {}) });
    }
  return out;
}

/** Property id of a field in a base: stored → `note.x`, formula → `formula.x`, rollup → `rollup.x`. */
export function fieldColumn(f: FieldDef): string {
  return f.kind === "formula" ? `formula.${f.name}` : f.kind === "rollup" ? `rollup.${f.name}` : `note.${f.name}`;
}

/** The base of a type as a plain object (what `typeBaseText` writes). */
export function typeBaseObject(reg: TypeRegistry, typeId: string, opts: TypeBaseOptions = {}): Record<string, unknown> {
  const lang = opts.lang ?? "he";
  const t = reg.get(typeId);
  if (!t) throw new Error(`no type '${typeId}'`);
  const fields = t.effective;
  const inverse = inverseRelations(reg, t.id);
  const formulas: Record<string, string> = {};
  const relations: Record<string, Record<string, unknown>> = {};
  const rollups: Record<string, Record<string, unknown>> = {};
  const properties: Record<string, { displayName: string }> = {};
  for (const f of fields) {
    if (f.kind === "formula" && f.formula) formulas[f.name] = f.formula;
    if (f.kind === "relation") relations[f.name] = { property: f.name, ...(f.to ? { filter: typeFilter(reg, f.to) } : {}) };
    if (f.label) properties[fieldColumn(f)] = { displayName: labelOf(f.label, lang, f.name) };
  }
  for (const inv of inverse) {
    if (inv.stored) relations[inv.name] = { property: inv.name, filter: typeFilter(reg, inv.fromType) };
    else relations[inv.name] = { property: inv.field, incoming: true, filter: typeFilter(reg, inv.fromType) };
    const from = reg.get(inv.fromType)!;
    properties[`relation.${inv.name}`] = { displayName: `${labelOf(from.label, lang, from.id)} (${labelOf(inv.label, lang, inv.field)})` };
  }
  for (const f of fields) {
    if (f.kind !== "rollup" || !f.relation) continue;
    if (!relations[f.relation]) continue; // reported by typeBaseProblems
    rollups[f.name] = { relation: f.relation, function: f.fn ?? "count", ...(f.property ? { property: f.property.includes(".") ? f.property : `note.${f.property}` } : {}) };
  }
  const pinned = fields.filter((f) => f.pinned && !(f.kind === "rollup" && !rollups[f.name]));
  const shown = pinned.length ? pinned : fields.filter((f) => !(f.kind === "rollup" && !rollups[f.name])).slice(0, 5);
  const order = ["file.name", ...shown.map(fieldColumn)];
  for (const f of fields) if (f.kind === "rollup" && rollups[f.name] && !order.includes(fieldColumn(f))) order.push(fieldColumn(f));
  for (const inv of inverse) if (!inv.stored) order.push(`relation.${inv.name}`);
  const title = labelOf(t.label, lang, t.id);
  const views: Array<Record<string, unknown>> = [
    { type: "table", name: lang === "he" ? `כל ה${title}` : `All ${title}`, order },
    { type: "cards", name: lang === "he" ? "כרטיסים" : "Cards", order: order.slice(0, 4), ...imageOf(fields) },
  ];
  const select = fields.find((f) => f.kind === "select");
  if (select) views.push({ type: "kanban", name: lang === "he" ? `לפי ${labelOf(select.label, lang, select.name)}` : `By ${labelOf(select.label, lang, select.name)}`, order: order.slice(0, 3), groupBy: { property: `note.${select.name}`, direction: "ASC" }, ...(select.options?.length ? { groupOrder: [...select.options, null] } : {}) });
  const out: Record<string, unknown> = { filters: typeFilter(reg, t.id) };
  if (Object.keys(formulas).length) out.formulas = formulas;
  if (Object.keys(properties).length) out.properties = properties;
  if (Object.keys(relations).length) out.relations = relations;
  if (Object.keys(rollups).length) out.rollups = rollups;
  out.views = views;
  return out;
}

/** A cover image for cards: the first url field named like an image. */
function imageOf(fields: readonly FieldDef[]): { image?: string } {
  const f = fields.find((x) => (x.kind === "url" || x.kind === "text") && /^(image|cover|thumbnail|poster|תמונה|כריכה|שער)$/i.test(x.name));
  return f ? { image: `note.${f.name}` } : {};
}

/** The type's base as `.base` YAML (Obsidian's syntax), for the virtual base and "Save as .base". */
export function typeBaseText(reg: TypeRegistry, typeId: string, opts: TypeBaseOptions = {}): string {
  const head = `# The base of the type '${typeId}' (.lumen/types/${typeId}.yaml), made by Lumen.\n`;
  return head + YAML.stringify(typeBaseObject(reg, typeId, opts), { lineWidth: 0 });
}

/** Problems the base of a type would have (a rollup over a relation that does not exist). */
export function typeBaseProblems(reg: TypeRegistry, typeId: string): string[] {
  const t = reg.get(typeId);
  if (!t) return [`no type '${typeId}'`];
  const names = new Set([...t.effective.filter((f) => f.kind === "relation").map((f) => f.name), ...inverseRelations(reg, t.id).map((i) => i.name)]);
  return t.effective.filter((f) => f.kind === "rollup" && !names.has(f.relation!)).map((f) => `${t.source}: fields.${f.name}: no relation '${f.relation}' on ${t.id} (relations: ${[...names].join(", ") || "none"})`);
}

/** The parsed model of the type's base. */
export function typeBaseModel(reg: TypeRegistry, typeId: string, opts: TypeBaseOptions = {}): BaseModel {
  const p = parseBase(typeBaseText(reg, typeId, opts));
  if (!p.ok) throw new Error(`type base of ${typeId}: ${p.error}`);
  return p.base;
}

/**
 * Run the type's virtual base in the app. The notes are chosen by the
 * registry (exactly the notes the type has, including `type: "[[book]]"`,
 * any letter case and label spellings), then the base runs over them
 * without its own filter; relations still resolve over every file.
 */
export function runTypeBase(reg: TypeRegistry, typeId: string, files: readonly BasesFile[], opts: RunOptions & TypeBaseOptions = {}): BaseResult {
  const model = typeBaseModel(reg, typeId, opts);
  const id = reg.get(typeId)!.id;
  const mine = new Set(files.filter((f) => noteIsA(reg, f, id)).map((f) => f.path));
  // Filter by path inside the run, so relations and `this` see the whole vault.
  return runBase({ ...model, filters: undefined }, files, { ...opts, only: mine });
}

/**
 * The text a saved `.base` of the type would get after the schema changed,
 * or null when it is current. Nothing is written: the caller shows the
 * change and writes only after the user approves.
 */
export function savedBaseUpdate(savedText: string, reg: TypeRegistry, typeId: string, opts: TypeBaseOptions = {}): string | null {
  const next = typeBaseText(reg, typeId, opts);
  try {
    return sameBaseData(savedText, next) ? null : next;
  } catch {
    return next;
  }
}

/** The path "Save as .base" proposes: `<label>.base` at the vault root. */
export function typeBasePath(reg: TypeRegistry, typeId: string, opts: TypeBaseOptions = {}): string {
  const t = reg.get(typeId);
  const name = labelOf(t?.label, opts.lang ?? "he", typeId).replace(/[\\/:*?"<>|#^[\]]+/g, "-");
  return `${name}.base`;
}

/**
 * "Save as .base" (W12.T3): a new file is written; an existing file with
 * other text is replaced only when `confirm` says yes. Returns the path, or
 * null when the user declined.
 */
export async function saveTypeBase(text: string, path: string, deps: { read(p: string): Promise<string>; write(p: string, t: string): Promise<void>; confirm(path: string): Promise<boolean> }): Promise<string | null> {
  let old: string | null;
  try {
    old = await deps.read(path);
  } catch {
    // why: no file yet — a new file needs no approval
    old = null;
  }
  if (old !== null && old !== text && !(await deps.confirm(path))) return null;
  if (old !== text) await deps.write(path, text);
  return path;
}
