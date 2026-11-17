/**
 * Typed objects in the UI (plan W12.T2), the pure part: the field form of
 * the properties panel, new notes of a type from its template, and the
 * Object Studio's writes (a new type, a new field, renaming a field in
 * every note of the type through the review screen, undone in one step).
 *
 * Everything a form writes is one frontmatter key through
 * properties/frontmatter.ts (only that value changes). A value that does not
 * fit its field is marked, never removed (checkFieldValue).
 */
import { isMap, isScalar, parseDocument, stringify } from "yaml";
import { renameProperty, setProperty, type PropertyValue } from "../properties/frontmatter";
import { expandTemplate } from "../editor/templateVars";
import { checkFieldValue, newObjectText, type ValueProblem } from "./fieldValues";
import { fieldsOfNote, noteIsA, typesOfNote, type EffectiveField, type NoteLike, type TypeRegistry } from "./typeRegistry";
import { FIELD_KINDS, normTypeId, typeFilePath, typeToYaml, type FieldDef, type FieldKind, type Label } from "./typeSchema";
import { compareNames } from "../i18n/collate";

export interface FormField {
  field: EffectiveField;
  /** The frontmatter key as the note writes it (its own case), or the field name when absent. */
  key: string;
  value: unknown;
  present: boolean;
  problem: ValueProblem | null;
  /** formula / rollup: shown, not edited. */
  computed: boolean;
}

/** The form of a note: its types' fields in order, with values and problems. */
export function formFields(reg: TypeRegistry, note: NoteLike): { types: string[]; fields: FormField[]; unknown: string[] } {
  const t = typesOfNote(reg, note);
  const keys = new Map(Object.keys(note.fm).map((k) => [k.normalize("NFC").toLowerCase(), k]));
  const fields = fieldsOfNote(reg, note).fields.map((f) => {
    const k = keys.get(f.name.normalize("NFC").toLowerCase());
    const value = k === undefined ? undefined : note.fm[k];
    const computed = f.kind === "formula" || f.kind === "rollup";
    return { field: f, key: k ?? f.name, value, present: k !== undefined, problem: checkFieldValue(f, value), computed };
  });
  return { types: t.types.map((x) => x.id), fields, unknown: t.unknown };
}

/** The notes a relation field may link: only notes of its target type (or a child type). */
export function relationCandidates(reg: TypeRegistry, field: FieldDef, notes: ReadonlyArray<NoteLike & { path: string }>): string[] {
  if (field.kind !== "relation" || !field.to) return [];
  return notes
    .filter((n) => noteIsA(reg, n, field.to!))
    .map((n) => n.path.slice(n.path.lastIndexOf("/") + 1).replace(/\.(md|markdown)$/i, ""))
    .sort((a, b) => compareNames(a, b));
}

/**
 * The frontmatter value for what was typed in a field's input. Text that
 * does not parse for the kind is written as typed (and then marked), never
 * dropped: the person's input is kept.
 */
export function inputValue(kind: FieldKind, raw: string | string[] | boolean, opts: { multiple?: boolean } = {}): PropertyValue {
  if (kind === "checkbox") return raw === true || raw === "true";
  if (Array.isArray(raw)) return raw.map((x) => (kind === "relation" ? asLink(x) : x)).filter((x) => x !== "");
  const s = String(raw);
  if (s.trim() === "") return kind === "multi-select" || (kind === "relation" && opts.multiple) ? [] : null;
  if (kind === "number") {
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) && /^-?[\d.,]+$/.test(s.trim()) ? n : s;
  }
  if (kind === "relation") return opts.multiple ? s.split(",").map((x) => asLink(x)).filter(Boolean) : asLink(s);
  if (kind === "multi-select") return s.split(",").map((x) => x.trim()).filter(Boolean);
  return s;
}

const asLink = (s: string) => {
  const t = s.trim();
  if (!t) return "";
  return /^\[\[.*\]\]$/.test(t) ? t : `[[${t}]]`;
};

/** Write one field of the form into the note (only that key changes). */
export function writeField(text: string, f: FormField, raw: string | string[] | boolean): string {
  return setProperty(text, f.key, inputValue(f.field.kind, raw, { multiple: f.field.multiple }));
}

/**
 * A new note of a type (W12.T2): `type:` and the defaults in the
 * frontmatter, and the body from the type's template (the template engine's
 * {{title}}, {{date}}, {{time}}, {{hebrewDate}}), else a heading.
 */
export function newTypedNote(reg: TypeRegistry, typeId: string, opts: { title: string; templateBody?: string; now?: Date; locale?: string; values?: Record<string, unknown> }): { ok: true; text: string } | { ok: false; problems: ValueProblem[] } {
  const t = reg.get(typeId);
  if (!t) return { ok: false, problems: [{ field: "type", code: "kind", message: `no type '${typeId}'` }] };
  const tpl = opts.templateBody ?? (t.template && !/\.(md|markdown)$/i.test(t.template) ? t.template : "# {{title}}\n");
  const body = expandTemplate(tpl, { title: opts.title, now: opts.now, locale: opts.locale });
  const made = newObjectText(reg, t.id, { values: opts.values, body });
  return made.ok ? { ok: true, text: made.text } : made;
}

/** The template note a type names (`template: Templates/Book.md`), if it names one. */
export function templatePathOf(reg: TypeRegistry, typeId: string): string | null {
  const t = reg.get(typeId)?.template;
  return t && /\.(md|markdown)$/i.test(t) ? t : null;
}

/* ─── Object Studio (W12.T2) ──────────────────────────────────────────── */

/** A new type file: `.lumen/types/<id>.yaml`. */
export function newTypeFile(id: string, label: Label, opts: { tag?: string; extends?: string; fields?: FieldDef[] } = {}): { path: string; text: string } {
  const tid = normTypeId(id);
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(tid)) throw new Error(`'${id}' is not a type id (letters, digits, - and _)`);
  return { path: typeFilePath(tid), text: typeToYaml({ label, tag: opts.tag, extends: opts.extends, fields: opts.fields ?? [] }) };
}

/** A YAML key as written: plain when it can be, else double-quoted. */
const yamlKey = (k: string) => (/^[\p{L}\p{N}_][\p{L}\p{N}_ -]*$/u.test(k) && !/ $/.test(k) ? k : JSON.stringify(k));

/** A flow map of a field spec: `{ type: select, options: [a, b] }`. */
function flowSpec(spec: Record<string, unknown>): string {
  return stringify(spec, { flowCollectionPadding: true, collectionStyle: "flow", lineWidth: 0 }).trim();
}

const keyName = (k: unknown) => String((k as { value?: unknown })?.value ?? k);

/**
 * Add a field to a type file. A block `fields:` map gets one new line after
 * its last field, so the rest of the file stays byte for byte (comments,
 * quoting, flow maps).
 */
export function addFieldToTypeText(text: string, name: string, kind: FieldKind, extra: { options?: string[]; to?: string; label?: Label; pinned?: boolean } = {}): string {
  if (!(FIELD_KINDS as readonly string[]).includes(kind)) throw new Error(`unknown field type '${kind}'`);
  const doc = parseDocument(text);
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  const fields = doc.get("fields", true);
  if (fields !== undefined && fields !== null && !isMap(fields) && !(isScalar(fields) && (fields.value === null || fields.value === ""))) throw new Error("fields is not a map in this type file");
  if (isMap(fields) && fields.items.some((p) => keyName(p.key).toLowerCase() === name.toLowerCase())) throw new Error(`field '${name}' already exists`);
  const spec: Record<string, unknown> = { type: kind, ...(extra.label ? { label: extra.label } : {}), ...(extra.pinned ? { pinned: true } : {}), ...(extra.options ? { options: extra.options } : {}), ...(extra.to ? { to: extra.to } : {}) };
  const line = `${yamlKey(name)}: ${flowSpec(spec)}`;
  if (isMap(fields) && !fields.flow && fields.items.length && fields.range) {
    const first = fields.items[0].key as { range?: [number, number, number] };
    const indent = first.range ? text.slice(text.lastIndexOf("\n", first.range[0] - 1) + 1, first.range[0]) : "  ";
    const end = fields.range[1];
    const before = text.slice(0, end);
    const nl = before.endsWith("\n") ? "" : "\n";
    return `${before}${nl}${indent}${line}\n${text.slice(end).replace(/^\n/, "")}`;
  }
  // No fields yet (or a flow map): write the map anew.
  if (isMap(fields)) fields.set(name, doc.createNode(spec, { flow: true }));
  else doc.set("fields", doc.createNode({ [name]: spec }));
  return doc.toString({ lineWidth: 0 });
}

/** Rename a field in its type file: the key only, the rest byte for byte. */
export function renameFieldInTypeText(text: string, from: string, to: string): string {
  const doc = parseDocument(text);
  const fields = doc.get("fields", true);
  if (!isMap(fields)) throw new Error("this type file has no fields map");
  const pair = fields.items.find((p) => keyName(p.key) === from);
  if (!pair) throw new Error(`no field '${from}' in this type file`);
  if (fields.items.some((p) => keyName(p.key) === to)) throw new Error(`field '${to}' already exists`);
  const range = (pair.key as { range?: [number, number, number] }).range;
  if (!range) throw new Error(`cannot place the field '${from}' in this file`);
  return text.slice(0, range[0]) + yamlKey(to) + text.slice(range[1]);
}

export interface FileChange {
  path: string;
  before: string;
  after: string;
}

/**
 * Renaming a field (W12.T2): the type file, and every note of the type (or
 * a child type) that has the key — the key only, its value and the rest of
 * the note as written. Nothing is written here: the caller stages these
 * changes in the review screen.
 */
export function planFieldRename(reg: TypeRegistry, typeId: string, from: string, to: string, typeFile: { path: string; text: string }, notes: ReadonlyArray<{ path: string; text: string; note: NoteLike }>): { changes: FileChange[]; skipped: Array<{ path: string; reason: string }> } {
  const t = reg.get(typeId);
  if (!t) throw new Error(`no type '${typeId}'`);
  if (t.declaredBy[from] && t.declaredBy[from] !== t.id) throw new Error(`'${from}' is inherited from ${t.declaredBy[from]}; rename it there`);
  const changes: FileChange[] = [{ path: typeFile.path, before: typeFile.text, after: renameFieldInTypeText(typeFile.text, from, to) }];
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const n of notes) {
    if (!noteIsA(reg, n.note, t.id)) continue;
    const key = Object.keys(n.note.fm).find((k) => k === from);
    if (!key) continue;
    try {
      const after = renameProperty(n.text, from, to);
      if (after !== n.text) changes.push({ path: n.path, before: n.text, after });
    } catch (e) {
      skipped.push({ path: n.path, reason: (e as Error).message });
    }
  }
  return { changes, skipped };
}

/**
 * Undo an applied rename in one step (W12.T2: one Ctrl+Z): every file that
 * still has the text the rename wrote goes back to its text before; a file
 * changed since is left alone and reported.
 */
export async function undoFileChanges(changes: readonly FileChange[], io: { read(path: string): Promise<string | null>; write(path: string, text: string): Promise<void> }): Promise<{ restored: string[]; changedSince: string[] }> {
  const restored: string[] = [];
  const changedSince: string[] = [];
  for (const c of changes) {
    const now = await io.read(c.path);
    if (now !== c.after) {
      changedSince.push(c.path);
      continue;
    }
    await io.write(c.path, c.before);
    restored.push(c.path);
  }
  return { restored, changedSince };
}
