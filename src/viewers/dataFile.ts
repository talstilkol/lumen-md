/**
 * A data file opened as a table of records (plan W12.F5): CSV, TSV, JSON (an
 * array of objects), YAML (a list of mappings) and XLSX (read only).
 *
 * Editing writes back to the same file and changes as little as it can:
 * - CSV/TSV: the parser keeps every record's character range, so an edited
 *   cell rewrites that one record and every other byte of the file stays as
 *   it was (quoting, line endings, a missing final newline).
 * - YAML: the `yaml` package's document model is edited in place, so
 *   comments and the other entries keep their formatting.
 * - JSON: re-serialized with the indentation the file had.
 */
import YAML from "yaml";

export type DataFormat = "csv" | "tsv" | "json" | "yaml" | "xlsx";

export interface DataTable {
  format: DataFormat;
  columns: string[];
  rows: string[][];
  /** False for XLSX, and for JSON/YAML whose records hold nested values we would flatten. */
  editable: boolean;
  /** Why the table is read only, when it is. */
  readOnlyReason?: string;
}

export function dataFormatOf(path: string): DataFormat | null {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase();
  if (ext === "yml") return "yaml";
  return ext === "csv" || ext === "tsv" || ext === "json" || ext === "yaml" || ext === "xlsx" ? ext : null;
}

/* ─── delimited text (RFC 4180) ──────────────────────────────────────── */

export interface DelimitedRecord {
  fields: string[];
  /** Each field as written in the file (quotes included), so an edit can leave the other fields' bytes alone. */
  raws: string[];
  /** [start, end) of the record in the text, line ending excluded. */
  start: number;
  end: number;
}

/** Parse CSV/TSV keeping each record's range. Quoted fields may hold the delimiter, quotes ("") and line breaks. */
export function parseDelimited(text: string, delimiter: string): DelimitedRecord[] {
  const out: DelimitedRecord[] = [];
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  while (i < n) {
    const start = i;
    const fields: string[] = [];
    const raws: string[] = [];
    let field = "";
    for (;;) {
      const fieldStart = i;
      if (text[i] === '"') {
        i++;
        for (;;) {
          if (i >= n) break;
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              field += '"';
              i += 2;
              continue;
            }
            i++;
            break;
          }
          field += text[i++];
        }
        // Anything after the closing quote up to the delimiter is kept, as spreadsheets do.
        while (i < n && text[i] !== delimiter && text[i] !== "\n" && text[i] !== "\r") field += text[i++];
      } else {
        while (i < n && text[i] !== delimiter && text[i] !== "\n" && text[i] !== "\r") field += text[i++];
      }
      fields.push(field);
      raws.push(text.slice(fieldStart, i));
      field = "";
      if (i < n && text[i] === delimiter) {
        i++;
        continue;
      }
      break;
    }
    const end = i;
    if (text[i] === "\r") i++;
    if (text[i] === "\n") i++;
    // A blank line is not a record.
    if (!(fields.length === 1 && fields[0] === "" && end === start)) out.push({ fields, raws, start, end });
  }
  return out;
}

export function quoteField(value: string, delimiter: string): string {
  return value.includes(delimiter) || /["\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The text with record `index` (0 = header) replaced; nothing else changes. */
export function replaceRecord(text: string, records: readonly DelimitedRecord[], index: number, fields: readonly string[], delimiter: string): string {
  const r = records[index];
  // Untouched fields keep their bytes (their quoting included); only a changed field is re-quoted.
  const line = fields.map((f, k) => (r.fields[k] === f && r.raws[k] !== undefined ? r.raws[k] : quoteField(f, delimiter))).join(delimiter);
  return text.slice(0, r.start) + line + text.slice(r.end);
}

/* ─── JSON / YAML ─────────────────────────────────────────────────────── */

const cellOf = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function tableFromRecords(format: DataFormat, list: unknown[]): DataTable {
  const columns: string[] = [];
  for (const item of list) if (isRecord(item)) for (const k of Object.keys(item)) if (!columns.includes(k)) columns.push(k);
  const nested = list.some((item) => isRecord(item) && Object.values(item).some((v) => v !== null && typeof v === "object"));
  return {
    format,
    columns,
    rows: list.map((item) => columns.map((c) => (isRecord(item) ? cellOf(item[c]) : ""))),
    editable: !nested,
    readOnlyReason: nested ? "nested" : undefined,
  };
}

/** Type a cell edit back: a number stays a number, true/false a boolean, empty is null in JSON. */
function typed(value: string, previous: unknown): unknown {
  if (typeof previous === "number" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  if (typeof previous === "boolean" && (value === "true" || value === "false")) return value === "true";
  if (previous === null && value === "") return null;
  return value;
}

export class DataFileError extends Error {}

/** Parse a text data file into a table. */
export function parseDataText(format: Exclude<DataFormat, "xlsx">, text: string): DataTable {
  if (format === "csv" || format === "tsv") {
    const recs = parseDelimited(text, format === "csv" ? "," : "\t");
    const header = recs[0]?.fields ?? [];
    const width = Math.max(header.length, ...recs.map((r) => r.fields.length));
    const columns = Array.from({ length: width }, (_, k) => header[k] ?? "");
    return { format, columns, rows: recs.slice(1).map((r) => Array.from({ length: width }, (_, k) => r.fields[k] ?? "")), editable: true };
  }
  let value: unknown;
  try {
    value = format === "json" ? JSON.parse(text) : YAML.parse(text);
  } catch (e) {
    throw new DataFileError((e as Error).message);
  }
  if (!Array.isArray(value)) throw new DataFileError(format === "json" ? "not an array of objects" : "not a list of mappings");
  return tableFromRecords(format, value);
}

/**
 * The file's new text after cell (row, column) is set to `value`. Rows are
 * 0-based data rows (the CSV header is not a row). Returns null when the
 * format is read only.
 */
export function writeCell(format: DataFormat, text: string, row: number, column: string, value: string, columns: readonly string[]): string | null {
  if (format === "csv" || format === "tsv") {
    const delimiter = format === "csv" ? "," : "\t";
    const recs = parseDelimited(text, delimiter);
    const rec = recs[row + 1];
    if (!rec) return null;
    const k = columns.indexOf(column);
    const fields = [...rec.fields];
    while (fields.length <= k) fields.push("");
    fields[k] = value;
    return replaceRecord(text, recs, row + 1, fields, delimiter);
  }
  if (format === "yaml") {
    const doc = YAML.parseDocument(text);
    const prev = doc.getIn([row, column]);
    doc.setIn([row, column], typed(value, prev));
    return doc.toString();
  }
  if (format === "json") {
    const list = JSON.parse(text) as Array<Record<string, unknown>>;
    if (!isRecord(list[row])) return null;
    list[row][column] = typed(value, list[row][column]);
    const indent = /^\[\s*\n([ \t]+)/.exec(text)?.[1] ?? "";
    const out = JSON.stringify(list, null, indent.includes("\t") ? "\t" : indent.length || undefined);
    return text.endsWith("\n") ? out + "\n" : out;
  }
  return null;
}
