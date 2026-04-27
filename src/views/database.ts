/**
 * Database engine — turns a folder of markdown notes into a queryable
 * collection by reading each file's YAML frontmatter and rendering it
 * as Table / Kanban / Gallery / Calendar.
 *
 * Spec lives inside a fenced ```database block:
 *
 *     ```database
 *     source: books/         # folder under workspace root, or "" for whole vault
 *     type: book             # filter rows where frontmatter.type === "book"
 *     view: kanban           # table | kanban | gallery | calendar
 *     groupBy: status        # column for kanban
 *     sortBy: rating         # column for sort (prefix '-' for descending)
 *     fields: [title, author, rating]   # which columns to show in table/gallery
 *     dateField: due         # which frontmatter key is the date for calendar
 *     ```
 *
 * The query runs over OPFS — every .md / .markdown file under `source`
 * is scanned, frontmatter parsed, and the matching rows returned. The
 * engine is intentionally cheap (no inverted index): a workspace under
 * a few hundred notes rebuilds in <100ms.
 */

import YAML from "yaml";
import {
  isOPFSAvailable,
  listWorkspace,
  readWorkspaceFile,
} from "../storage/workspace";
import { extractFrontmatter } from "../renderer/pipeline";

export type DatabaseView = "table" | "kanban" | "gallery" | "calendar";

export interface DatabaseSpec {
  source?: string;
  type?: string;
  view?: DatabaseView;
  groupBy?: string;
  sortBy?: string;
  fields?: string[];
  dateField?: string;
  /** Column that holds an image URL — used in gallery cards. */
  cover?: string;
  /** Optional custom title for the rendered block. */
  title?: string;
}

export interface DatabaseRow {
  /** Workspace path of the source file. */
  path: string;
  /** Filename minus extension, used as a default title. */
  basename: string;
  /** Parsed frontmatter; empty object when none. */
  fm: Record<string, unknown>;
}

export function parseDatabaseSpec(source: string): {
  spec: DatabaseSpec | null;
  error?: string;
} {
  const trimmed = source.trim();
  if (!trimmed) return { spec: null, error: "(empty database spec)" };
  try {
    const parsed = YAML.parse(trimmed);
    if (!parsed || typeof parsed !== "object") {
      return { spec: null, error: "Database spec must be a YAML object." };
    }
    return { spec: parsed as DatabaseSpec };
  } catch (e) {
    return { spec: null, error: (e as Error).message };
  }
}

/**
 * Run the query against the workspace and return matching rows.
 * Returns an empty array (not throw) when OPFS is unavailable so the
 * block degrades gracefully in restricted environments.
 */
export async function runDatabaseQuery(spec: DatabaseSpec): Promise<DatabaseRow[]> {
  if (!isOPFSAvailable()) return [];
  const sourceRoot = (spec.source ?? "").replace(/^\/+|\/+$/g, "");
  const all = await listWorkspace({ includeAssets: false });
  const candidates = all.filter((f) => {
    if (!/\.(md|markdown)$/i.test(f.path)) return false;
    if (sourceRoot && !f.path.toLowerCase().startsWith(sourceRoot.toLowerCase() + "/") && f.path.toLowerCase() !== sourceRoot.toLowerCase()) {
      return false;
    }
    return true;
  });

  const rows: DatabaseRow[] = [];
  for (const file of candidates) {
    let body: string;
    try {
      body = await readWorkspaceFile(file.path);
    } catch {
      continue;
    }
    const fm = extractFrontmatter(body) ?? {};
    if (spec.type && fm.type !== spec.type) continue;
    rows.push({
      path: file.path,
      basename: file.name.replace(/\.(md|markdown)$/i, ""),
      fm,
    });
  }

  // Sorting: prefix '-' means descending.
  if (spec.sortBy) {
    const desc = spec.sortBy.startsWith("-");
    const key = desc ? spec.sortBy.slice(1) : spec.sortBy;
    rows.sort((a, b) => {
      const av = compareValue(a.fm[key]);
      const bv = compareValue(b.fm[key]);
      if (av < bv) return desc ? 1 : -1;
      if (av > bv) return desc ? -1 : 1;
      return a.basename.localeCompare(b.basename);
    });
  }

  return rows;
}

function compareValue(v: unknown): string | number {
  if (v == null) return "";
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  return String(v).toLowerCase();
}

/**
 * Group rows by the `groupBy` column. Empty / missing values land in the
 * special "_" bucket so the Kanban view can render them under "(none)".
 */
export function groupRows(
  rows: DatabaseRow[],
  groupBy: string,
): Map<string, DatabaseRow[]> {
  const out = new Map<string, DatabaseRow[]>();
  for (const r of rows) {
    const v = r.fm[groupBy];
    const key = v == null || v === "" ? "_" : String(v);
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(r);
  }
  return out;
}

/** Friendly display string for a frontmatter value (handles arrays / dates). */
export function displayValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => displayValue(x)).join(", ");
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Pick the columns to show in table / gallery. Falls back to the union of
 * all frontmatter keys (excluding internal `type`) so a user who didn't
 * specify `fields:` still gets useful output.
 */
export function resolveFields(
  rows: DatabaseRow[],
  spec: DatabaseSpec,
): string[] {
  if (spec.fields && spec.fields.length > 0) return spec.fields;
  const keys = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r.fm)) {
      if (k === "type") continue;
      keys.add(k);
    }
  }
  return [...keys].slice(0, 6);
}
