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
 *     view: kanban           # table | cards | kanban | list | calendar
 *     where: status != "done" AND (rating >= 4 OR contains(tags, "fav"))
 *     groupBy: status        # kanban columns; sections in the other views
 *     sort: [-rating, title] # one or more columns ('-' or ' desc': descending)
 *     sortBy: rating         # the older, single-column form of `sort`
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
import { matchesFilter, parseFilter, type FilterNode } from "./databaseFilter";

export type DatabaseView = "table" | "cards" | "kanban" | "list" | "calendar";

export interface DatabaseSpec {
  source?: string;
  type?: string;
  /** `gallery` is the old name of `cards`. */
  view?: DatabaseView | "gallery";
  /** Filter expression (see databaseFilter.ts). */
  where?: string;
  groupBy?: string;
  /** Kanban columns to show even when no note is in them yet, in this order. */
  columns?: Array<string | number>;
  sort?: string | string[];
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

/** The spec's view, with old names mapped (`gallery` → `cards`). */
export function specView(spec: DatabaseSpec): DatabaseView {
  const v = spec.view;
  if (v === "gallery") return "cards";
  return v === "table" || v === "cards" || v === "kanban" || v === "list" || v === "calendar" ? v : "table";
}

export interface SortKey {
  key: string;
  desc: boolean;
}

/** `[-rating, "title asc"]`, `"rating desc, title"` or `-rating` → sort keys. */
export function parseSort(sort: string | string[] | undefined): SortKey[] {
  if (!sort) return [];
  const parts = (Array.isArray(sort) ? sort.map(String) : String(sort).split(",")).map((x) => x.trim()).filter(Boolean);
  return parts.map((x) => {
    const m = /^(.*?)\s+(asc|desc)$/i.exec(x);
    if (m) return { key: m[1].trim(), desc: m[2].toLowerCase() === "desc" };
    return x.startsWith("-") ? { key: x.slice(1).trim(), desc: true } : { key: x, desc: false };
  });
}

const rowFilter = (r: DatabaseRow) => ({
  fm: r.fm,
  file: { name: r.basename, path: r.path, folder: r.path.includes("/") ? r.path.slice(0, r.path.lastIndexOf("/")) : "" },
});

/** Filter, then sort (ties: by name). Pure, so the toolbar can re-run it on every keystroke. */
export function applyQuery(rows: readonly DatabaseRow[], q: { where?: FilterNode | null; sort?: SortKey[] }): DatabaseRow[] {
  const out = q.where ? rows.filter((r) => matchesFilter(q.where ?? null, rowFilter(r))) : [...rows];
  const keys = q.sort ?? [];
  out.sort((a, b) => {
    for (const { key, desc } of keys) {
      const av = compareValue(a.fm[key]);
      const bv = compareValue(b.fm[key]);
      // Missing values last, either direction.
      if (av === "" && bv !== "") return 1;
      if (bv === "" && av !== "") return -1;
      const d = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      if (d) return desc ? -d : d;
    }
    return a.basename.localeCompare(b.basename);
  });
  return out;
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
  const where = parseFilter(spec.where ?? "");
  if (!where.ok) throw new Error(`where: ${where.error} (at ${where.at + 1})`);
  return applyQuery(await loadDatabaseRows(spec), { where: where.tree, sort: parseSort(spec.sort ?? spec.sortBy) });
}

/** The notes under `source` (of `type`, when set), by name — before `where` and `sort`. */
export async function loadDatabaseRows(spec: DatabaseSpec): Promise<DatabaseRow[]> {
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

  return rows.sort((a, b) => a.basename.localeCompare(b.basename));
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
