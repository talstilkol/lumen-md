/**
 * Airtable (plan W13.F2), with no network: either a table's CSV (a view →
 * Download CSV; one file per table) or a base saved from Airtable's Web API
 * to a local JSON file (`{ baseName, schema: { tables }, records }`, the
 * shape `GET /v0/meta/bases/{id}/tables` and `GET /v0/{base}/{table}`
 * return). lumen-md never calls the API itself.
 *
 * Each table becomes a folder with a note per record (named by the primary
 * field, the first column of a CSV) whose properties are the record's
 * cells, and a `.base` file next to it that shows them as a table, columns
 * in Airtable's order.
 *
 *  - numbers, true / false (checkbox: `checked` in CSV), dates stay typed;
 *  - multiple selects and collaborators → lists; a linked record → a
 *    `[[Record]]` link when that record is in the import;
 *  - attachments: Airtable keeps them on its servers — the link stays a URL
 *    (nothing is downloaded) and the report says how many;
 *  - long text (`multilineText`, `richText`) stays a property, as Airtable
 *    shows it in the grid.
 */
import { stringify } from "yaml";
import { claimPath, safeName, stemOf } from "./names";
import { withFrontmatter, type Props } from "./frontmatter";
import { parseCsv } from "./notion";
import { emptyVault, type ConvertedVault } from "./types";
import { swallowed } from "../../lib/logger";

interface Field {
  id?: string;
  name: string;
  type?: string;
}

interface Table {
  id: string;
  name: string;
  primaryFieldId?: string;
  fields: Field[];
}

interface ApiRecord {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
}

/** Does this JSON look like a base saved from Airtable's API? */
export function looksLikeAirtable(json: unknown): boolean {
  const j = json as { schema?: { tables?: unknown }; records?: unknown };
  return !!j && typeof j === "object" && Array.isArray(j.schema?.tables) && !!j.records && typeof j.records === "object";
}

/** RFC 4180 rows with `sep` as the separator (quoted fields, doubled quotes, newlines inside quotes). */
function parseDelimited(text: string, sep: string): string[][] {
  const s = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f !== ""));
}

/** CSV rows; `;` when the header row uses it more than `,` (a European locale's Excel). */
function csvRows(text: string): string[][] {
  const head = text.split(/\r?\n/, 1)[0] ?? "";
  return (head.match(/;/g) ?? []).length > (head.match(/,/g) ?? []).length ? parseDelimited(text, ";") : parseCsv(text);
}

/** A CSV cell → a typed property value. */
export function csvValue(cell: string): unknown {
  const s = cell.trim();
  if (!s) return undefined;
  if (s === "checked" || s === "true" || s === "TRUE") return true;
  if (s === "false" || s === "FALSE") return false;
  if (/^-?\d+(\.\d+)?$/.test(s) && !/^0\d/.test(s) && s.length < 16) return Number(s);
  // Airtable writes dates as 2024-01-15 or 1/15/2024 (US); ISO kept, others as text.
  return s;
}

/** The `.base` for one table: its folder's notes, the columns in the table's order. */
function tableBase(title: string, folder: string, columns: string[]): string {
  const [first, ...rest] = columns;
  const doc = {
    filters: { and: [`file.inFolder(${JSON.stringify(folder)})`, 'file.ext == "md"'] },
    properties: { "file.name": { displayName: first ?? "Name" }, ...Object.fromEntries(rest.map((c) => [`note.${c}`, { displayName: c }])) },
    views: [{ type: "table", name: title, order: ["file.name", ...rest.map((c) => `note.${c}`)] }],
  };
  return `# ${title} — imported from Airtable\n${stringify(doc, { lineWidth: 0 })}`;
}

interface Row {
  name: string;
  props: Props;
}

function writeTable(vault: ConvertedVault, taken: Set<string>, folder: string, title: string, columns: string[], rows: Row[], importFolder: string): void {
  const dir = `${folder ? `${folder}/` : ""}${safeName(title, "Table")}`;
  for (const r of rows) {
    const path = claimPath(taken, `${dir}/${safeName(r.name.replace(/[[\]#|^]/g, ""))}.md`);
    vault.notes.set(path, withFrontmatter(r.props, ""));
  }
  vault.notes.set(claimPath(taken, `${dir}.base`), tableBase(title, importFolder ? `${importFolder}/${dir}` : dir, columns));
}

/** Airtable API values → properties (linked records by their title, attachments as URLs). */
function apiValue(v: unknown, field: Field, titles: Map<string, string>, remote: { n: number }): unknown {
  if (v === null || v === undefined || v === "") return undefined;
  const type = field.type ?? "";
  if (type === "multipleRecordLinks" && Array.isArray(v)) return v.map((id) => (titles.has(String(id)) ? `[[${titles.get(String(id))}]]` : String(id)));
  if (type === "multipleAttachments" && Array.isArray(v)) {
    remote.n += v.length;
    return v.map((a) => (a as { url?: string }).url ?? (a as { filename?: string }).filename).filter(Boolean);
  }
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? ((x as { name?: string; email?: string }).name ?? (x as { email?: string }).email ?? JSON.stringify(x)) : x));
  if (typeof v === "object") {
    const o = v as { name?: string; email?: string; text?: string; value?: string; label?: string };
    return o.name ?? o.text ?? o.value ?? o.label ?? o.email ?? undefined;
  }
  return v;
}

export function convertAirtable(files: Map<string, Uint8Array>, opts: { folder?: string } = {}): ConvertedVault {
  const vault = emptyVault();
  const taken = new Set<string>();
  const dec = new TextDecoder();
  // CSV: every table read first, so a cell naming a record of another table becomes a link to it.
  const csvTables: { title: string; columns: string[]; rows: string[][] }[] = [];
  for (const [p, data] of files) {
    if (!/\.csv$/i.test(p)) continue;
    const rows = csvRows(dec.decode(data));
    if (rows.length < 2) {
      vault.skipped.push({ path: p, reason: "empty" });
      continue;
    }
    // Airtable names a download `<Table>-<View>.csv`; the table is the folder.
    csvTables.push({ title: stemOf(p).replace(/-Grid view$/i, "").trim() || "Table", columns: rows[0].map((c, i) => c.trim() || `Column ${i + 1}`), rows: rows.slice(1) });
  }
  const recordTitles = new Set(csvTables.flatMap((t) => t.rows.map((r) => (r[0] ?? "").trim()).filter(Boolean)));
  const cellValue = (cell: string): unknown => {
    const s = cell.trim();
    if (recordTitles.has(s)) return [`[[${s}]]`];
    // A multiple select or a list of linked records: Airtable joins them with "," (no space; a sentence has ", ").
    if (s.includes(",") && !/,\s/.test(s) && !/^-?[\d,.]+$/.test(s)) return s.split(",").map((x) => (recordTitles.has(x.trim()) ? `[[${x.trim()}]]` : x.trim()));
    return csvValue(s);
  };
  for (const t of csvTables) {
    const out: Row[] = t.rows.map((r, i) => ({ name: r[0]?.trim() || `${t.title} ${i + 1}`, props: Object.fromEntries(t.columns.slice(1).map((c, k) => [c, cellValue(r[k + 1] ?? "")])) }));
    writeTable(vault, taken, "", t.title, t.columns, out, opts.folder ?? "");
  }
  for (const [p, data] of files) {
    if (/\.csv$/i.test(p)) continue;
    if (/\.json$/i.test(p)) {
      let json: { baseName?: string; schema: { tables: Table[] }; records: Record<string, { records?: ApiRecord[] } | ApiRecord[]> };
      try {
        json = JSON.parse(dec.decode(data));
      } catch (e) {
        swallowed("import/airtable: a file is not JSON; it is listed as skipped", e);
        vault.skipped.push({ path: p, reason: "unreadable" });
        continue;
      }
      if (!looksLikeAirtable(json)) {
        vault.skipped.push({ path: p, reason: "unreadable" });
        continue;
      }
      const base = safeName(json.baseName ?? stemOf(p), "Airtable");
      const recordsOf = (t: Table): ApiRecord[] => {
        const r = json.records[t.id] ?? json.records[t.name];
        return Array.isArray(r) ? r : (r?.records ?? []);
      };
      // Every record's title first, so links between tables resolve whichever comes first.
      const titles = new Map<string, string>();
      for (const t of json.schema.tables) {
        const primary = t.fields.find((f) => f.id === t.primaryFieldId) ?? t.fields[0];
        for (const r of recordsOf(t)) titles.set(r.id, String(r.fields[primary?.name ?? ""] ?? r.id).trim() || r.id);
      }
      for (const t of json.schema.tables) {
        const primary = t.fields.find((f) => f.id === t.primaryFieldId) ?? t.fields[0];
        const others = t.fields.filter((f) => f !== primary && f.type !== "button");
        const remote = { n: 0 };
        const out: Row[] = recordsOf(t).map((r) => ({
          name: titles.get(r.id) ?? r.id,
          props: { ...Object.fromEntries(others.map((f) => [f.name, apiValue(r.fields[f.name], f, titles, remote)])), created: r.createdTime },
        }));
        writeTable(vault, taken, base, t.name, [primary?.name ?? "Name", ...others.map((f) => f.name)], out, opts.folder ?? "");
        if (remote.n) vault.warnings.push({ path: `${base}/${safeName(t.name, "Table")}.base`, reason: "remoteAttachment", detail: String(remote.n) });
      }
      continue;
    }
    if (/(^|\/)\.DS_Store$/.test(p)) vault.skipped.push({ path: p, reason: "appFolder" });
    else vault.skipped.push({ path: p, reason: "unsupported", detail: "CSV" });
  }
  return vault;
}
