/**
 * Field values against a type (plan W12.T1/T2): which frontmatter values do
 * not fit their field, and the frontmatter of a new note of a type.
 *
 * A value that does not fit is reported, never changed or removed: the
 * properties form marks it (W12.T2), MCP's create_object refuses it
 * (W12.T4). Everything a type stores is a frontmatter key; nothing here
 * creates another place for data.
 */
import YAML from "yaml";
import { parseWikiLink } from "../views/bases/values";
import type { FieldDef } from "./typeSchema";
import { fieldsOfNote, typesOfNote, type TypeRegistry } from "./typeRegistry";

export type ValueProblemCode = "kind" | "option" | "list" | "date" | "url" | "link" | "computed" | "target";

export interface ValueProblem {
  field: string;
  code: ValueProblemCode;
  message: string;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** `2026-11-15`, or a full ISO date-time; checks the day exists. */
export function isIsoDate(v: unknown): boolean {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (typeof v !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(v.trim());
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && (m[4] === undefined || (Number(m[4]) < 24 && Number(m[5]) < 60));
}

export function isUrl(v: unknown): boolean {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v.trim());
    return /^(https?|mailto|ftp|obsidian|zotero|file):$/.test(u.protocol);
  } catch {
    return false;
  }
}

/** A `[[link]]` (or a Markdown-free note name the way Obsidian writes a link property). */
export function linkTarget(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const l = parseWikiLink(v.trim());
  return l && l.path ? l.path : null;
}

/** The problem with one value for a field, or null when it fits (an empty value always fits). */
export function checkFieldValue(field: FieldDef, value: unknown): ValueProblem | null {
  const p = (code: ValueProblemCode, message: string): ValueProblem => ({ field: field.name, code, message });
  if (field.kind === "formula" || field.kind === "rollup")
    return value === undefined ? null : p("computed", `${field.name} is computed (${field.kind}); a stored value is not used`);
  if (isEmpty(value)) return null;
  switch (field.kind) {
    case "text":
      return typeof value === "string" || typeof value === "number" ? null : p("kind", `${field.name} is text`);
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : p("kind", `${field.name} is a number`);
    case "checkbox":
      return typeof value === "boolean" ? null : p("kind", `${field.name} is true or false`);
    case "date":
    case "hebrew-date":
      return isIsoDate(value) ? null : p("date", `${field.name} is a date (YYYY-MM-DD)`);
    case "url":
      return isUrl(value) ? null : p("url", `${field.name} is a web address`);
    case "select": {
      if (typeof value !== "string" && typeof value !== "number") return p("kind", `${field.name} is one value`);
      return field.options?.length && !field.options.includes(String(value)) ? p("option", `${field.name}: '${String(value)}' is not one of ${field.options.join(", ")}`) : null;
    }
    case "multi-select": {
      if (!Array.isArray(value)) return p("list", `${field.name} is a list`);
      const bad = value.filter((x) => typeof x !== "string" && typeof x !== "number");
      if (bad.length) return p("kind", `${field.name} holds values, not lists or maps`);
      const off = field.options?.length ? value.map(String).filter((x) => !field.options!.includes(x)) : [];
      return off.length ? p("option", `${field.name}: ${off.map((x) => `'${x}'`).join(", ")} not among ${field.options!.join(", ")}`) : null;
    }
    case "relation": {
      if (field.multiple) {
        const list = Array.isArray(value) ? value : [value];
        return list.every((x) => linkTarget(x) !== null) ? null : p("link", `${field.name} is a list of [[links]] to ${field.to}`);
      }
      if (Array.isArray(value)) return value.length === 1 && linkTarget(value[0]) ? null : p("list", `${field.name} is one [[link]] to ${field.to}`);
      return linkTarget(value) ? null : p("link", `${field.name} is a [[link]] to ${field.to}`);
    }
  }
  return null;
}

/** Every problem of a note's frontmatter against its types (W12.T2 marks them; nothing is removed). */
export function checkNote(reg: TypeRegistry, note: { fm: Record<string, unknown>; tags?: readonly string[] }): ValueProblem[] {
  const out: ValueProblem[] = [];
  const keys = new Map(Object.keys(note.fm).map((k) => [k.normalize("NFC").toLowerCase(), k]));
  for (const f of fieldsOfNote(reg, note).fields) {
    const k = keys.get(f.name.normalize("NFC").toLowerCase());
    const problem = checkFieldValue(f, k === undefined ? undefined : note.fm[k]);
    if (problem) out.push(problem);
  }
  return out;
}

/** The frontmatter keys of a new note of the type: `type:`, then every stored field's default (computed fields are not stored). */
export function defaultsOf(reg: TypeRegistry, typeId: string): Record<string, unknown> {
  const t = reg.get(typeId);
  if (!t) throw new Error(`no type '${typeId}'`);
  const fm: Record<string, unknown> = { type: t.id };
  for (const f of t.effective) {
    if (f.kind === "formula" || f.kind === "rollup") continue;
    fm[f.name] = f.default !== undefined ? structuredClone(f.default) : f.kind === "multi-select" || (f.kind === "relation" && f.multiple) ? [] : f.kind === "checkbox" ? false : null;
  }
  return fm;
}

export type NewObject = { ok: true; text: string; fm: Record<string, unknown> } | { ok: false; problems: ValueProblem[] };

/**
 * The text of a new note of a type (W12.T2 templates, W12.T4 create_object):
 * defaults, then `values` over them, checked against the schema. A value
 * that does not fit, or a key the type does not have, is a problem and no
 * text is made.
 */
export function newObjectText(reg: TypeRegistry, typeId: string, opts: { values?: Record<string, unknown>; body?: string; allowExtra?: boolean } = {}): NewObject {
  const t = reg.get(typeId);
  if (!t) return { ok: false, problems: [{ field: "type", code: "kind", message: `no type '${typeId}'` }] };
  const fm = defaultsOf(reg, t.id);
  const problems: ValueProblem[] = [];
  const byKey = new Map(t.effective.map((f) => [f.name.normalize("NFC").toLowerCase(), f]));
  for (const [k, v] of Object.entries(opts.values ?? {})) {
    if (k === "type") continue;
    const f = byKey.get(k.normalize("NFC").toLowerCase());
    if (!f) {
      if (!opts.allowExtra) problems.push({ field: k, code: "kind", message: `${t.id} has no field '${k}' (fields: ${t.effective.map((x) => x.name).join(", ")})` });
      else fm[k] = v;
      continue;
    }
    const problem = checkFieldValue(f, v);
    if (problem) problems.push(problem);
    else fm[f.name] = v;
  }
  if (problems.length) return { ok: false, problems };
  const yaml = YAML.stringify(fm, { lineWidth: 0 }).replace(/: null$/gm, ":");
  const body = opts.body ?? "";
  return { ok: true, fm, text: `---\n${yaml}---\n${body && !body.startsWith("\n") ? "\n" : ""}${body}` };
}

/** Does the linked note have the relation's target type (W12.T2's picker, W12.T6)? */
export function relationTargetOk(reg: TypeRegistry, field: FieldDef, target: { fm: Record<string, unknown>; tags?: readonly string[] } | null): boolean {
  if (field.kind !== "relation" || !field.to) return true;
  if (!target) return false;
  return typesOfNote(reg, target).types.some((t) => t.chain.includes(field.to!));
}
