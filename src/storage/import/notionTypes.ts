/**
 * A Notion database becomes a type (plan W12.T7): each imported database
 * gets a `.lumen/types/<id>.yaml` (W12.T1) whose fields are its columns,
 * with a kind guessed from the column's values as the importer typed them
 * (src/storage/import/notion.ts `typeColumn`): checkbox, number, date,
 * relation, select, url or text. A relation whose links lead to the rows of
 * another imported database becomes `relation → <that type>`.
 *
 * Formulas and rollups. Notion's own exports carry only their values. When
 * the export also holds a Notion API database object (a `.json` with
 * `"object": "database"`, as API-based backups write), its formula
 * expressions go through the Bases parser with Notion's functions (W6.46,
 * src/views/bases/notion.ts) — `prop("Price")` becomes `note["Price"]` —
 * and its rollups become rollup fields; a formula that does not parse stays
 * as its values, with a warning.
 *
 * Every column gets a line in the report: kept, converted (with what
 * changed), or lost (with why). Pure.
 */

import { parseBases } from "../../views/bases/catalogue";
import { normTypeId, RESERVED_FIELDS, ROLLUP_FNS, typeDefFromObject, typeToYaml, type FieldKind, type RollupFn } from "../../types/typeSchema";

export type ColumnStatus = "kept" | "converted" | "lost";

export interface ColumnReport {
  column: string;
  status: ColumnStatus;
  kind: FieldKind | null;
  /** What changed or why it was lost (empty when kept as it was). */
  note: string;
}

type Cell = string | number | boolean | string[] | null;

export interface NotionDbInput {
  title: string;
  /** The rows' folder, relative to the import folder. */
  folder: string;
  /** The first is the title column. */
  columns: string[];
  /** One typed column of values per column (the importer's typeColumn). */
  typed: Cell[][];
  /** Columns the HTML export marks as formulas or rollups. */
  computed?: string[];
  /** The Notion API schema of this database, when the export holds one. */
  schema?: NotionSchema;
}

export interface NotionSchema {
  /** Property name → its API definition. */
  properties: Record<string, { type: string; formula?: { expression?: string }; rollup?: { relation_property_name?: string; rollup_property_name?: string; function?: string } }>;
}

export interface DatabaseTypeResult {
  id: string;
  yaml: string;
  report: ColumnReport[];
}

/** A type id for a database: its title, as a type id (letters of any script, digits, - and _). */
export function databaseTypeId(title: string, taken: ReadonlySet<string>): string {
  const base = normTypeId(title).replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "notion-db";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

const ROLLUP_MAP: Record<string, RollupFn> = {
  count: "count",
  count_all: "count",
  count_values: "count",
  sum: "sum",
  average: "avg",
  min: "min",
  max: "max",
  earliest_date: "earliest",
  latest_date: "latest",
};

/** Notion's `prop("Name")` → Bases `note["Name"]`; null when the result does not parse. */
export function notionFormulaToBases(expr: string): string | null {
  const out = expr.replace(/\bprop\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g, (_, name: string) => `note[${JSON.stringify(name.replace(/\\"/g, '"'))}]`);
  const p = parseBases(out);
  return p.ok ? out : null;
}

const isLinkList = (v: Cell) => Array.isArray(v) && v.every((x) => /^\[\[[^\]]+\]\]$/.test(x));
const linkTarget = (s: string) => s.replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0].trim();

/**
 * The type of one database. `rowsOf(folder)` names the row notes of every
 * imported database (to find a relation's target type); `typeOfFolder` maps
 * a database folder to its type id.
 */
export function databaseType(
  db: NotionDbInput,
  id: string,
  ctx: {
    typeOfRow?: (name: string) => string | null;
    /** Review Z7-L4: every type that has a row of this name (two databases can share one); preferred over typeOfRow. */
    typesOfRow?: (name: string) => readonly string[];
  },
): DatabaseTypeResult {
  const report: ColumnReport[] = [];
  const fields: Record<string, unknown> = {};
  const computed = new Set(db.computed ?? []);
  report.push({ column: db.columns[0], status: "kept", kind: null, note: "the note's name" });
  db.columns.forEach((col, i) => {
    if (i === 0) return;
    const values = (db.typed[i] ?? []).filter((v) => v !== null);
    const api = db.schema?.properties[col];
    const name = col.trim();
    if (RESERVED_FIELDS.has(name.toLowerCase())) {
      report.push({ column: col, status: "converted", kind: null, note: `kept as the note's \`${name}\` property; a type can't declare ${name}` });
      return;
    }
    // A formula / rollup with its definition (API schema).
    if (api?.type === "formula" && api.formula?.expression) {
      const f = notionFormulaToBases(api.formula.expression);
      if (f) {
        fields[name] = { type: "formula", formula: f };
        report.push({ column: col, status: "kept", kind: "formula", note: f === api.formula.expression ? "" : `formula as ${f}` });
      } else {
        fields[name] = { type: kindOfValues(values).kind };
        report.push({ column: col, status: "converted", kind: kindOfValues(values).kind, note: `the formula ${api.formula.expression} has no Bases equivalent; its values were kept` });
      }
      return;
    }
    if (api?.type === "rollup" && api.rollup?.relation_property_name) {
      const fn = ROLLUP_MAP[String(api.rollup.function ?? "count")];
      if (fn && (ROLLUP_FNS as readonly string[]).includes(fn)) {
        fields[name] = { type: "rollup", relation: api.rollup.relation_property_name, function: fn, ...(fn !== "count" ? { property: api.rollup.rollup_property_name } : {}) };
        report.push({ column: col, status: "kept", kind: "rollup", note: `${fn} of ${api.rollup.relation_property_name}${fn !== "count" ? `.${api.rollup.rollup_property_name}` : ""}` });
      } else {
        const k = kindOfValues(values).kind;
        fields[name] = { type: k };
        report.push({ column: col, status: "converted", kind: k, note: `the rollup function ${api.rollup.function} has no equivalent; its values were kept` });
      }
      return;
    }
    if (!values.length) {
      fields[name] = { type: "text" };
      report.push({ column: col, status: "kept", kind: "text", note: "empty in every row" });
      return;
    }
    if (values.every(isLinkList)) {
      const names = (values as string[][]).flat().map(linkTarget);
      // Z7-L4: the column's target is the one database that has a row for every link (the intersection), so a name
      // that two databases share does not decide it alone; with no single one, the links stay a list.
      const candidates = names.map((n) => new Set(ctx.typesOfRow ? ctx.typesOfRow(n) : [ctx.typeOfRow?.(n) ?? null].filter((x): x is string => !!x)));
      const outside = candidates.some((c) => c.size === 0);
      const common = outside ? [] : [...(candidates[0] ?? [])].filter((t) => candidates.every((c) => c.has(t)));
      const to = common.length === 1 ? common[0] : null;
      const targets = new Set<string | null>(outside ? [null] : common);
      if (to) {
        fields[name] = { type: "relation", to, multiple: true };
        report.push({ column: col, status: "kept", kind: "relation", note: `relation → ${to}` });
      } else {
        // No single type to point at: a list field that keeps the [[links]] as they are.
        fields[name] = { type: "multi-select" };
        report.push({ column: col, status: "converted", kind: "multi-select", note: targets.has(null) ? "links to pages outside the imported databases: kept as a list of [[links]]" : "links to rows of more than one database: kept as a list of [[links]]" });
      }
      return;
    }
    const { kind, options } = kindOfValues(values);
    fields[name] = { type: kind, ...(options ? { options } : {}) };
    if (computed.has(col)) report.push({ column: col, status: "converted", kind, note: "a Notion formula or rollup: its values came across as " + kind + "; the formula is not in Notion's export" });
    else report.push({ column: col, status: "kept", kind, note: "" });
  });
  const parsed = typeDefFromObject(id, { label: /[֐-׿]/.test(db.title) ? { he: db.title } : { en: db.title }, fields }, `import:notion/${db.folder}`, "vault");
  if (!parsed.ok) {
    // Never silently: the whole type falls back to text fields, and the report says why.
    const plain: Record<string, unknown> = {};
    for (const c of db.columns.slice(1)) if (!RESERVED_FIELDS.has(c.trim().toLowerCase())) plain[c.trim()] = { type: "text" };
    const fallback = typeDefFromObject(id, { label: { en: db.title }, fields: plain }, `import:notion/${db.folder}`, "vault");
    return {
      id,
      yaml: fallback.ok ? typeToYaml(fallback.type) : "",
      report: report.map((r, i) => (i === 0 ? r : { ...r, status: "converted" as const, kind: "text" as const, note: `kept as text: ${parsed.error}` })),
    };
  }
  return { id, yaml: typeToYaml(parsed.type), report };
}

function kindOfValues(values: Cell[]): { kind: FieldKind; options?: string[] } {
  if (values.every((v) => typeof v === "boolean")) return { kind: "checkbox" };
  if (values.every((v) => typeof v === "number")) return { kind: "number" };
  if (values.every((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v))) return { kind: "date" };
  if (values.every((v) => typeof v === "string" && /^https?:\/\/\S+$/.test(v))) return { kind: "url" };
  const strings = values.filter((v): v is string => typeof v === "string");
  const distinct = [...new Set(strings)];
  // A short list of repeated values reads as Notion's select.
  if (strings.length === values.length && strings.length >= 2 && distinct.length <= 12 && distinct.length < strings.length && distinct.every((s) => s.length <= 40 && !s.includes(", "))) return { kind: "select", options: distinct };
  return { kind: "text" };
}

/** A report as Markdown lines (for the import report). */
export function reportLines(title: string, id: string, report: readonly ColumnReport[]): string[] {
  return [`### ${title} → \`${id}\``, "", "| column | | kind | note |", "| --- | --- | --- | --- |", ...report.map((r) => `| ${r.column.replace(/\|/g, "\\|")} | ${r.status} | ${r.kind ?? ""} | ${r.note.replace(/\|/g, "\\|")} |`)];
}
