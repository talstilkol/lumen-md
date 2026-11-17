/**
 * Embedded queries (plan W2.12): a ```query block runs a search with the
 * operators of plan 11.3 (tag:, path:, "phrase", /regex/, -term, words)
 * and shows the matching notes as a list or a table, kept up to date as the
 * vault changes.
 *
 *     ```query
 *     tag:project -tag:done
 *     view: table
 *     sort: modified desc
 *     limit: 20
 *     ```
 *
 * Lines of the form `option: value` (view, sort, limit) set how it shows;
 * `chart: bar` (plan W12.V1) draws the result as a chart instead, with
 * `chart-x:`, `chart-y:`, `chart-series:` and `chart-aggregate:` (see
 * `splitChartOptions`, which a ```dataview block uses too);
 * every other line is part of the query. Pure: the block component feeds it
 * the vault's notes (or search hits) and renders what comes back.
 */

import { matchesOps, noteTags, parseQuery } from "./queryOps";
import { compareNames } from "../i18n/collate";

export type QueryView = "list" | "table";
export type QuerySortKey = "name" | "modified" | "path" | "relevance";

export interface EmbeddedQuery {
  /** The search, in 11.3 syntax. */
  query: string;
  view: QueryView;
  sort: { key: QuerySortKey; desc: boolean };
  limit: number;
  /** Options that could not be read, shown to the reader. */
  problems: string[];
  /** W12.V1: draw the rows as a chart. */
  chart?: QueryChart;
}

/** A chart over query rows (W12.V1). `x` / `y` / `series` name a column (`folder`, `tags`, `modified`, `name`, or a Dataview header). */
export interface QueryChart {
  kind: string;
  x?: string;
  y?: string;
  series?: string;
  aggregate?: string;
}

const CHART_OPTION = /^\s*chart(?:-(x|y|series|aggregate))?\s*:\s*(.*?)\s*$/i;

/** The chart lines of a block taken out, the rest of the source kept as it was. */
export function splitChartOptions(src: string): { rest: string; chart?: QueryChart } {
  let chart: QueryChart | undefined;
  const opts: Partial<QueryChart> = {};
  const rest: string[] = [];
  for (const line of src.split(/\r?\n/)) {
    const m = CHART_OPTION.exec(line);
    if (!m) {
      rest.push(line);
      continue;
    }
    if (!m[1]) chart = { kind: m[2].toLowerCase() || "bar" };
    else opts[m[1].toLowerCase() as "x" | "y" | "series" | "aggregate"] = m[2];
  }
  if (chart) chart = { ...chart, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v)) };
  return { rest: rest.join("\n"), chart };
}

const OPTION = /^\s*(view|sort|limit)\s*:\s*(.*?)\s*$/i;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

export function parseEmbeddedQuery(src: string): EmbeddedQuery {
  const q: EmbeddedQuery = { query: "", view: "list", sort: { key: "relevance", desc: false }, limit: DEFAULT_LIMIT, problems: [] };
  const words: string[] = [];
  const split = splitChartOptions(src);
  if (split.chart) q.chart = split.chart;
  for (const line of split.rest.split(/\r?\n/)) {
    const m = OPTION.exec(line);
    if (!m) {
      if (line.trim() && !line.trim().startsWith("//")) words.push(line.trim());
      continue;
    }
    const key = m[1].toLowerCase();
    const value = m[2].toLowerCase();
    if (key === "view") {
      if (value === "list" || value === "table") q.view = value;
      else q.problems.push(line.trim());
    } else if (key === "limit") {
      const n = Number(value);
      if (Number.isInteger(n) && n > 0) q.limit = Math.min(n, MAX_LIMIT);
      else q.problems.push(line.trim());
    } else {
      const [k, dir] = value.split(/\s+/);
      if (k === "name" || k === "modified" || k === "path" || k === "relevance") {
        q.sort = { key: k, desc: dir ? dir === "desc" : k === "modified" };
        if (dir && dir !== "asc" && dir !== "desc") q.problems.push(line.trim());
      } else q.problems.push(line.trim());
    }
  }
  q.query = words.join(" ");
  return q;
}

export interface QueryNote {
  path: string;
  name: string;
  content: string;
  modified: number;
}

export interface QueryRow {
  path: string;
  name: string;
  folder: string;
  modified: number;
  tags: string[];
  snippet: string | null;
}

export interface QueryHit {
  path: string;
  name: string;
  snippet: string | null;
}

/**
 * Turn search hits (ranked by the index, operators applied) into rows,
 * sorted and limited as the block asks. `notes` gives each hit's text and
 * time; the note holding the block is left out, so a block never lists
 * its own note.
 */
export function rowsFor(q: EmbeddedQuery, hits: readonly QueryHit[], notes: ReadonlyMap<string, QueryNote>, self: string | null): QueryRow[] {
  const rows: QueryRow[] = [];
  for (const h of hits) {
    if (h.path === self) continue;
    const n = notes.get(h.path);
    rows.push({
      path: h.path,
      name: h.name.replace(/\.md$/i, ""),
      folder: h.path.includes("/") ? h.path.slice(0, h.path.lastIndexOf("/")) : "",
      modified: n?.modified ?? 0,
      tags: n ? noteTags(n.content) : [],
      snippet: h.snippet,
    });
  }
  const { key, desc } = q.sort;
  if (key !== "relevance") {
    const sign = desc ? -1 : 1;
    rows.sort((a, b) => {
      const c = key === "modified" ? a.modified - b.modified : compareNames(key === "name" ? a.name : a.path, key === "name" ? b.name : b.path);
      return sign * c || (a.path < b.path ? -1 : 1);
    });
  }
  return rows.slice(0, q.limit);
}

/**
 * The same query without the index: every note that passes the operators
 * and contains every free word. For the tests and for a vault the index
 * hasn't reached yet; the block itself asks the index (ranked BM25).
 */
export function filterNotes(q: EmbeddedQuery, notes: readonly QueryNote[]): QueryHit[] {
  const { text, ops, invalid } = parseQuery(q.query);
  if (invalid.length) return [];
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const out: QueryHit[] = [];
  for (const n of notes) {
    const lower = n.content.toLowerCase();
    const m = { content: n.content, lower, pathLower: n.path.toLowerCase(), nameLower: n.name.toLowerCase(), tags: noteTags(n.content) };
    if (ops.length && !matchesOps(ops, m)) continue;
    if (!words.every((w) => lower.includes(w) || m.nameLower.includes(w))) continue;
    out.push({ path: n.path, name: n.name, snippet: null });
  }
  return out;
}
