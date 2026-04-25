import Papa from "papaparse";

export type ColType = "number" | "date" | "boolean" | "string";

export interface DataColumn {
  key: string;
  name: string;
  type: ColType;
  /** number of non-null cells */
  filled: number;
  /** distinct value count */
  distinct: number;
  /** for numbers */
  min?: number;
  max?: number;
  /** for dates */
  minDate?: number;
  maxDate?: number;
}

export interface DataSet {
  columns: DataColumn[];
  rows: Array<Record<string, unknown>>;
  rawColumns: string[];
}

const NUM_RE = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function inferType(values: unknown[]): ColType {
  let num = 0;
  let dat = 0;
  let bool = 0;
  let total = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    total++;
    if (typeof v === "number" && Number.isFinite(v)) {
      num++;
      continue;
    }
    if (typeof v === "boolean") {
      bool++;
      continue;
    }
    const s = String(v).trim();
    if (NUM_RE.test(s)) {
      num++;
      continue;
    }
    if (ISO_DATE_RE.test(s) || !Number.isNaN(Date.parse(s))) {
      // be conservative: only count as date if it's not also a number
      if (!NUM_RE.test(s)) dat++;
      continue;
    }
    if (s === "true" || s === "false") {
      bool++;
      continue;
    }
  }
  if (total === 0) return "string";
  if (num / total > 0.9) return "number";
  if (dat / total > 0.85) return "date";
  if (bool / total > 0.95) return "boolean";
  return "string";
}

export function coerce(value: unknown, type: ColType): unknown {
  if (value === null || value === undefined || value === "") return null;
  if (type === "number") {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const n = Number(String(value).trim());
    return Number.isFinite(n) ? n : null;
  }
  if (type === "date") {
    if (typeof value === "number") return value;
    const t = Date.parse(String(value));
    return Number.isFinite(t) ? t : null;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    const s = String(value).trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
    return null;
  }
  return String(value);
}

export function parseCSV(text: string, delimiter?: string): DataSet {
  const result = Papa.parse<Record<string, unknown>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    delimiter,
    transformHeader: (h) => h.trim(),
  });
  const rawColumns =
    (result.meta.fields ?? []).map((c) => c.trim()).filter(Boolean) ??
    Object.keys(result.data[0] ?? {});
  return buildDataset(rawColumns, result.data);
}

export function parseJSONTable(text: string): DataSet {
  const trimmed = text.trim();
  if (!trimmed) return { columns: [], rows: [], rawColumns: [] };
  const parsed: unknown = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error("Expected a JSON array of objects.");
  }
  const rows = parsed as Array<Record<string, unknown>>;
  const cols = new Set<string>();
  for (const row of rows) {
    if (row && typeof row === "object") {
      for (const k of Object.keys(row)) cols.add(k);
    }
  }
  return buildDataset([...cols], rows);
}

function buildDataset(
  rawColumns: string[],
  rows: Array<Record<string, unknown>>,
): DataSet {
  const columns: DataColumn[] = rawColumns.map((name) => {
    const raw = rows.map((r) => r?.[name]);
    const type = inferType(raw);
    const distinct = new Set<unknown>();
    let filled = 0;
    let min = Infinity;
    let max = -Infinity;
    let minDate = Infinity;
    let maxDate = -Infinity;
    for (const v of raw) {
      const c = coerce(v, type);
      if (c === null) continue;
      filled++;
      distinct.add(c);
      if (type === "number" && typeof c === "number") {
        if (c < min) min = c;
        if (c > max) max = c;
      } else if (type === "date" && typeof c === "number") {
        if (c < minDate) minDate = c;
        if (c > maxDate) maxDate = c;
      }
    }
    return {
      key: name,
      name,
      type,
      filled,
      distinct: distinct.size,
      ...(type === "number" && Number.isFinite(min) ? { min, max } : {}),
      ...(type === "date" && Number.isFinite(minDate) ? { minDate, maxDate } : {}),
    };
  });

  const coercedRows = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of columns) out[c.key] = coerce(r?.[c.key], c.type);
    return out;
  });

  return { columns, rows: coercedRows, rawColumns };
}
