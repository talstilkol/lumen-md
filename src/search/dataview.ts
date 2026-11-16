/**
 * A subset of Obsidian Dataview's query language (plan W2.12), so the
 * ```dataview blocks in vaults that come from Obsidian render here too:
 *
 *   LIST [expr] | TABLE [WITHOUT ID] expr [AS "name"], … | TASK
 *   [FROM #tag | "folder" | [[note]] | -source, combined with AND / OR / ( )]
 *   then, in any order and as often as written:
 *   WHERE expr · SORT expr [ASC|DESC], … · LIMIT n · GROUP BY expr [AS name] · FLATTEN expr [AS name]
 *
 * Expressions: numbers, "strings", true/false/null, fields (`status`,
 * `file.name`, `file.mtime`, nested `a.b`), comparisons (= != < > <= >=),
 * + - * /, and / or / !, and the common functions (contains, icontains,
 * startswith, endswith, length, lower, upper, date, default, choice, round,
 * number, string, regexmatch, join, list, dateformat, split, replace, sum,
 * min, max, …), and `(x) => …` inside filter, map, any, all, none and sort.
 * `file.tasks`, `file.day` and `this` (the note the block is in) as in Dataview.
 *
 * A hand-written tokenizer, parser and interpreter: no eval, no Function,
 * nothing from the query reaches JavaScript as code (a static check in the
 * tests holds this). DOM-free and pure: notes in, rows out.
 */

import { DataviewError, DataviewLimitError, type Expr, type Source, type DvQuery } from "./dataviewParse";
import { tasksOf, taskValue } from "./dataviewTasks";
import { formatDate, isoWeek } from "./dataviewDates";
export { DataviewError, DataviewLimitError, parseDataview, type Expr, type Source, type DvQuery } from "./dataviewParse";

/**
 * Bounds of one run (review 11, M3): at most MAX_ROWS rows from a FLATTEN,
 * at most EVAL_BUDGET expression evaluations in all, and no text longer than
 * MAX_TEXT made by padleft / padright. Past one, runDataview throws a
 * DataviewLimitError instead of holding the main thread.
 */
export const MAX_ROWS = 100_000;
export const EVAL_BUDGET = 2_000_000;
export const MAX_TEXT = 100_000;
/** Evaluations left in the current run (none outside runDataview: `evaluate` alone is unbounded). */
let evalLeft = Infinity;

/* ─── Values ─────────────────────────────────────────────────────── */

export class DateValue {
  constructor(readonly ms: number) {}
  toString(): string {
    const d = new Date(this.ms);
    const iso = d.toISOString();
    return d.getUTCHours() || d.getUTCMinutes() ? iso.slice(0, 16).replace("T", " ") : iso.slice(0, 10);
  }
}

export interface LinkValue {
  link: string;
  /** Shown text. */
  display: string;
}

export type Value = null | boolean | number | string | DateValue | LinkValue | Value[] | { [k: string]: Value };

const isLink = (v: Value): v is LinkValue => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof DateValue) && typeof (v as LinkValue).link === "string" && typeof (v as LinkValue).display === "string" && Object.keys(v).length === 2;

/** A note as the queries see it. */
export interface DvNote {
  path: string;
  /** Basename with extension. */
  name: string;
  content: string;
  modified: number;
  created?: number;
}

/* ─── Front matter and inline fields ─────────────────────────────── */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function scalar(raw: string): Value {
  const s = raw.trim();
  if (!s) return null;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s === "true" || s === "false") return s === "true";
  if (s === "null" || s === "~") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  if (ISO_DATE.test(s)) {
    const ms = Date.parse(s.length === 10 ? s + "T00:00:00Z" : s.replace(" ", "T"));
    if (!Number.isNaN(ms)) return new DateValue(ms);
  }
  const wiki = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(s);
  if (wiki) return { link: wiki[1], display: wiki[2] ?? wiki[1] };
  if (s.startsWith("[") && s.endsWith("]")) {
    return s
      .slice(1, -1)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map(scalar);
  }
  return s;
}

/** Front matter `key: value` (scalars, inline lists, `- item` lists, one level of nesting). */
export function frontMatter(content: string): Record<string, Value> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  const out: Record<string, Value> = {};
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z\p{L}_][\w\p{L}\- ]*?)\s*:(?:\s+(.*))?$/u.exec(lines[i]);
    if (!kv) continue;
    const key = kv[1];
    const rest = (kv[2] ?? "").trim();
    if (rest) {
      out[key] = scalar(rest.replace(/\s+#.*$/, ""));
      continue;
    }
    const list: Value[] = [];
    const obj: Record<string, Value> = {};
    let j = i + 1;
    for (; j < lines.length; j++) {
      const item = /^\s+-\s+(.*)$/.exec(lines[j]);
      const sub = /^\s+([A-Za-z\p{L}_][\w\p{L}\-]*)\s*:\s*(.*)$/u.exec(lines[j]);
      if (item) list.push(scalar(item[1]));
      else if (sub) obj[sub[1]] = scalar(sub[2]);
      else if (!lines[j].trim()) continue;
      else break;
    }
    out[key] = list.length ? list : Object.keys(obj).length ? obj : null;
    i = j - 1;
  }
  return out;
}

/** Dataview inline fields: `key:: value` on its own line, or `[key:: value]` / `(key:: value)` in text. */
export function inlineFields(content: string): Record<string, Value> {
  const out: Record<string, Value> = {};
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").replace(/^([ \t]*)(```|~~~)[^\n]*\n[\s\S]*?(?:\n\1\2[^\n]*|(?![\s\S]))/gm, "");
  const add = (k: string, v: string) => {
    const key = k.trim();
    if (!key || key in out) return;
    out[key] = scalar(v);
  };
  for (const m of body.matchAll(/^[ \t]*(?:[-*+][ \t]+)?([\p{L}\w][\p{L}\w \-]*?)::[ \t]*(.*)$/gmu)) add(m[1], m[2]);
  for (const m of body.matchAll(/[[(]([\p{L}\w][\p{L}\w \-]*?)::\s*([^\])]*)[\])]/gu)) add(m[1], m[2]);
  return out;
}

/** Tags in front matter and `#tags` in the text (outside code), with their `#`. */
export function dvTags(content: string): string[] {
  const fm = frontMatter(content);
  const out = new Set<string>();
  const fmTags = fm.tags ?? fm.tag;
  const push = (t: string) => {
    const v = t.trim().replace(/^#+/, "");
    if (v) out.add("#" + v);
  };
  if (Array.isArray(fmTags)) fmTags.forEach((t) => typeof t === "string" && push(t));
  else if (typeof fmTags === "string") fmTags.split(/[,\s]+/).forEach(push);
  const body = content
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .replace(/^([ \t]*)(```|~~~)[^\n]*\n[\s\S]*?(?:\n\1\2[^\n]*|(?![\s\S]))/gm, " ")
    .replace(/`+[^`\n]*`+/g, " ");
  for (const m of body.matchAll(/(^|[\s([{>"',;])#([\p{L}\p{M}\p{N}_/-]*[\p{L}\p{M}_][\p{L}\p{M}\p{N}_/-]*)/gu)) push(m[2]);
  return [...out];
}

/** Outgoing wiki-link targets. */
function outlinks(content: string): string[] {
  // A [[link]] in code (a ```dataview block's FROM [[note]]) is not a link.
  const text = content.replace(/^([ \t>]*)(```|~~~)[^\n]*\n[\s\S]*?(?:\n\1\2[^\n]*|(?![\s\S]))/gm, " ").replace(/`+[^`\n]*`+/g, " ");
  return [...text.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)].map((m) => m[1].trim());
}

/** The page object of a note: its fields, and `file`. */
export function pageOf(note: DvNote, self?: DvNote): Record<string, Value> {
  const name = note.name.replace(/\.md$/i, "");
  const folder = note.path.includes("/") ? note.path.slice(0, note.path.lastIndexOf("/")) : "";
  const tags = dvTags(note.content);
  const file: Record<string, Value> = {
    name,
    path: note.path,
    folder,
    link: { link: note.path, display: name },
    mtime: new DateValue(note.modified),
    ctime: new DateValue(note.created ?? note.modified),
    mday: new DateValue(Math.floor(note.modified / 86_400_000) * 86_400_000),
    size: note.content.length,
    ext: (/\.([^.]+)$/.exec(note.name)?.[1] ?? "").toLowerCase(),
    tags,
    etags: tags,
    outlinks: outlinks(note.content).map((l) => ({ link: l, display: l })),
  };
  const fields = { ...inlineFields(note.content), ...frontMatter(note.content) };
  // file.day: the date in the note's name (daily notes), else its `date` field.
  const day = /(\d{4}-\d{2}-\d{2})/.exec(name)?.[1];
  const dayValue = day ? scalar(day) : fields.date instanceof DateValue ? fields.date : null;
  if (dayValue) file.day = dayValue;
  // Parsed now (cheap test first), so a cached page does not keep the note's text.
  file.tasks = HAS_TASK.test(note.content) ? tasksOf(note.content).map((t) => taskValue(t, note.path, scalar)) : [];
  const page: Record<string, Value> = {};
  for (const [k, v] of Object.entries(fields)) {
    page[k] = v;
    // Dataview also answers a field by its lower-case, dash-separated name.
    const norm = k.toLowerCase().replace(/\s+/g, "-");
    if (!(norm in page)) page[norm] = v;
  }
  page.file = file;
  return self ? { ...page, this: pageOf(self) } : page;
}

const HAS_TASK = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[.\]/m;

/**
 * The pages of the last runs, by path: a save re-reads only the note that
 * changed (W2.12 "update after a save < 100 ms"). Keyed by modified time,
 * size and a hash of the text, so an edit that keeps the time is still seen;
 * the text itself is not kept.
 */
const PAGES = new Map<string, { stamp: string; page: Record<string, Value> }>();
const PAGE_CACHE_MAX = 50_000;

function stampOf(n: DvNote): string {
  let h = 0x811c9dc5;
  const s = n.content;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return `${n.name}|${n.modified}|${n.created ?? ""}|${s.length}|${h >>> 0}`;
}

function cachedPage(n: DvNote): Record<string, Value> {
  const stamp = stampOf(n);
  const hit = PAGES.get(n.path);
  if (hit && hit.stamp === stamp) return hit.page;
  const page = pageOf(n);
  if (PAGES.size >= PAGE_CACHE_MAX) PAGES.clear();
  PAGES.set(n.path, { stamp, page });
  return page;
}


/* ─── Evaluation ─────────────────────────────────────────────────── */

function truthy(v: Value): boolean {
  if (v === null || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function toNum(v: Value): number | null {
  if (typeof v === "number") return v;
  if (v instanceof DateValue) return v.ms;
  if (typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v.trim())) return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

export function show(v: Value): string {
  if (v === null) return "";
  if (Array.isArray(v)) return v.map(show).join(", ");
  if (v instanceof DateValue) return v.toString();
  if (isLink(v)) return v.display;
  if (typeof v === "object") return Object.entries(v).map(([k, x]) => `${k}: ${show(x)}`).join(", ");
  return String(v);
}

/** Order of two values (numbers, dates, then text; null first). */
export function compare(a: Value, b: Value): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  const na = toNum(a);
  const nb = toNum(b);
  if (na !== null && nb !== null && typeof a !== "string" && typeof b !== "string") return na - nb;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof DateValue && typeof b === "string") {
    const d = scalar(b);
    if (d instanceof DateValue) return a.ms - d.ms;
  }
  if (b instanceof DateValue && typeof a === "string") {
    const d = scalar(a);
    if (d instanceof DateValue) return d.ms - b.ms;
  }
  return show(a).localeCompare(show(b), undefined, { numeric: true, sensitivity: "base" });
}

function equal(a: Value, b: Value): boolean {
  if (isLink(a) || isLink(b)) return linkKey(a) === linkKey(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (a === null || b === null) return a === b;
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  return compare(a, b) === 0 && (typeof a !== "string" || typeof b !== "string" || a.toLowerCase() === b.toLowerCase());
}

function linkKey(v: Value): string {
  const s = isLink(v) ? v.link : show(v);
  return s.replace(/\.md$/i, "").split("/").pop()!.toLowerCase();
}

function contains(hay: Value, needle: Value, ci: boolean): boolean {
  if (Array.isArray(hay)) return hay.some((x) => (typeof x === "string" && typeof needle === "string" ? (ci ? x.toLowerCase() === needle.toLowerCase() : x === needle) || (ci ? x.toLowerCase().includes(needle.toLowerCase()) : x.includes(needle)) : equal(x, needle)));
  if (typeof hay === "string") return ci ? hay.toLowerCase().includes(show(needle).toLowerCase()) : hay.includes(show(needle));
  if (isLink(hay)) return linkKey(hay) === linkKey(needle);
  if (hay && typeof hay === "object" && !(hay instanceof DateValue)) return typeof needle === "string" && needle in hay;
  return false;
}

const DAY = 86_400_000;

function call(fn: string, args: Value[], now: number): Value {
  const [a, b, c] = args;
  switch (fn) {
    case "contains":
      return contains(a ?? null, b ?? null, false);
    case "icontains":
      return contains(a ?? null, b ?? null, true);
    case "econtains":
      return Array.isArray(a) ? a.some((x) => equal(x, b ?? null)) : equal(a ?? null, b ?? null);
    case "startswith":
      return typeof a === "string" && typeof b === "string" && a.startsWith(b);
    case "endswith":
      return typeof a === "string" && typeof b === "string" && a.endsWith(b);
    case "length":
      return Array.isArray(a) ? a.length : typeof a === "string" ? a.length : a && typeof a === "object" && !(a instanceof DateValue) ? Object.keys(a).length : 0;
    case "lower":
      return typeof a === "string" ? a.toLowerCase() : a ?? null;
    case "upper":
      return typeof a === "string" ? a.toUpperCase() : a ?? null;
    case "default":
      return a === null || a === undefined ? (b ?? null) : a;
    case "choice":
      return truthy(a ?? null) ? (b ?? null) : (c ?? null);
    case "round": {
      const n = toNum(a ?? null);
      const d = toNum(b ?? null) ?? 0;
      return n === null ? null : Math.round(n * 10 ** d) / 10 ** d;
    }
    case "number": {
      if (typeof a === "number") return a;
      const m = typeof a === "string" ? /-?\d+(?:\.\d+)?/.exec(a) : null;
      return m ? Number(m[0]) : null;
    }
    case "string":
      return show(a ?? null);
    case "join":
      return Array.isArray(a) ? a.map(show).join(typeof b === "string" ? b : ", ") : show(a ?? null);
    case "list":
      return args;
    case "regexmatch": {
      // A pattern the reader wrote, matched as data: RegExp only, never code.
      if (typeof a !== "string" || typeof b !== "string") return false;
      try {
        return new RegExp(`^(?:${a})$`, "u").test(b);
      } catch {
        return false;
      }
    }
    case "date": {
      if (a instanceof DateValue) return a;
      const s = typeof a === "string" ? a.trim().toLowerCase() : isLink(a ?? null) ? (a as LinkValue).link : "";
      const today = Math.floor(now / DAY) * DAY;
      if (s === "today") return new DateValue(today);
      if (s === "now") return new DateValue(now);
      if (s === "tomorrow") return new DateValue(today + DAY);
      if (s === "yesterday") return new DateValue(today - DAY);
      const d = scalar(s.replace(/\.md$/, "").split("/").pop() ?? "");
      return d instanceof DateValue ? d : null;
    }
    case "dur": {
      const m = typeof a === "string" ? /^(\d+)\s*(d|day|days|w|week|weeks|h|hour|hours|m|min|minutes)$/.exec(a.trim()) : null;
      if (!m) return null;
      const n = Number(m[1]);
      const unit = m[2][0] === "w" ? 7 * DAY : m[2][0] === "d" ? DAY : m[2][0] === "h" ? 3_600_000 : 60_000;
      return n * unit;
    }
    case "any":
      return Array.isArray(a) ? a.some(truthy) : truthy(a ?? null);
    case "all":
      return Array.isArray(a) ? a.every(truthy) : truthy(a ?? null);
    case "none":
      return Array.isArray(a) ? !a.some(truthy) : !truthy(a ?? null);
    case "sum":
    case "product":
    case "average":
    case "min":
    case "max": {
      const list = Array.isArray(a) ? a : args;
      const nums = list.map(toNum).filter((n): n is number => n !== null);
      if (!nums.length) return null;
      if (fn === "sum") return nums.reduce((x, y) => x + y, 0);
      if (fn === "product") return nums.reduce((x, y) => x * y, 1);
      if (fn === "average") return nums.reduce((x, y) => x + y, 0) / nums.length;
      const best = list.reduce<Value>((m, x) => (x === null ? m : m === null || (fn === "min" ? compare(x, m) < 0 : compare(x, m) > 0) ? x : m), null);
      return best;
    }
    case "reverse":
      return Array.isArray(a) ? [...a].reverse() : typeof a === "string" ? [...a].reverse().join("") : (a ?? null);
    case "sort":
      return Array.isArray(a) ? [...a].sort(compare) : (a ?? null);
    case "flat":
      // why: unknown[] keeps FlatArray from expanding the recursive Value type (TS2589)
      return Array.isArray(a) ? ((a as unknown[]).flat(typeof b === "number" ? b : 1) as Value[]) : (a ?? null);
    case "nonnull":
      return (Array.isArray(a) ? a : args).filter((x) => x !== null);
    case "firstvalue":
      return (Array.isArray(a) ? a : args).find((x) => x !== null) ?? null;
    case "array":
      return Array.isArray(a) ? a : a === null || a === undefined ? [] : [a];
    case "typeof":
      return a === null || a === undefined ? "null" : Array.isArray(a) ? "array" : a instanceof DateValue ? "date" : isLink(a) ? "link" : typeof a === "object" ? "object" : typeof a;
    case "link":
      return typeof a === "string" ? { link: a, display: typeof b === "string" ? b : a.replace(/\.md$/i, "").split("/").pop()! } : isLink(a ?? null) ? (a as LinkValue) : null;
    case "split":
      return typeof a === "string" && typeof b === "string" ? a.split(b) : null;
    case "replace":
      return typeof a === "string" && typeof b === "string" && typeof c === "string" ? a.split(b).join(c) : (a ?? null);
    case "substring": {
      if (typeof a !== "string") return null;
      return a.substring(toNum(b ?? null) ?? 0, c === undefined ? undefined : (toNum(c) ?? undefined));
    }
    case "truncate": {
      const n = toNum(b ?? null);
      if (typeof a !== "string" || n === null || a.length <= n) return a ?? null;
      const tail = typeof c === "string" ? c : "...";
      return a.slice(0, Math.max(0, n - tail.length)) + tail;
    }
    case "padleft":
    case "padright": {
      const n = toNum(b ?? null) ?? 0;
      if (n > MAX_TEXT) throw new DataviewLimitError("string");
      const fill = typeof c === "string" && c ? c : " ";
      const str = show(a ?? null);
      return fn === "padleft" ? str.padStart(n, fill) : str.padEnd(n, fill);
    }
    case "containsword":
      return typeof a === "string" && typeof b === "string" && a.toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(b.toLowerCase());
    case "striptime":
      return a instanceof DateValue ? new DateValue(Math.floor(a.ms / DAY) * DAY) : (a ?? null);
    case "dateformat":
      return a instanceof DateValue && typeof b === "string" ? formatDate(a.ms, b) : a === null || a === undefined ? null : show(a);
    case "meta": {
      if (!isLink(a ?? null)) return null;
      const l = a as LinkValue;
      const hash = l.link.indexOf("#");
      return { path: hash < 0 ? l.link : l.link.slice(0, hash), subpath: hash < 0 ? null : l.link.slice(hash + 1), display: l.display, type: hash < 0 ? "file" : l.link[hash + 1] === "^" ? "block" : "header", embed: false };
    }
    case "__get":
      return member(a ?? null, typeof b === "string" ? b : show(b ?? null));
    case "__index": {
      if (Array.isArray(a) && typeof b === "number") return a[b] ?? null;
      if (a && typeof a === "object" && !Array.isArray(a) && !(a instanceof DateValue) && typeof b === "string") return (a as Record<string, Value>)[b] ?? null;
      return null;
    }
    default:
      throw new DataviewError(`unknown function ${fn}()`);
  }
}

const LAMBDA_FNS = new Set(["filter", "map", "any", "all", "none", "sort"]);

/** filter / map / any / all / none / sort with a `(x) => …`: the function runs on each item with x bound. */
function callWithLambda(fn: string, args: Expr[], page: Record<string, Value>, now: number): Value {
  const [listExpr, fnExpr] = args;
  const raw = listExpr ? evaluate(listExpr, page, now) : null;
  const list = Array.isArray(raw) ? raw : raw === null ? [] : [raw];
  if (fnExpr?.k !== "lambda") throw new DataviewError(`${fn}() takes a list and a function (x) => …`);
  const { params, body } = fnExpr;
  const apply = (x: Value, i: number) => evaluate(body, { ...page, [params[0] ?? "_"]: x, ...(params[1] ? { [params[1]]: i } : {}) }, now);
  switch (fn) {
    case "filter":
      return list.filter((x, i) => truthy(apply(x, i)));
    case "map":
      return list.map(apply);
    case "any":
      return list.some((x, i) => truthy(apply(x, i)));
    case "all":
      return list.every((x, i) => truthy(apply(x, i)));
    case "none":
      return !list.some((x, i) => truthy(apply(x, i)));
    default: {
      const keyed = list.map((x, i) => ({ x, k: apply(x, i) }));
      keyed.sort((p, q) => compare(p.k, q.k));
      return keyed.map((e) => e.x);
    }
  }
}

/** `.name` on a value: a duration's days / hours …, a date's year / month / day …, a link's path, an object's key. */
function member(v: Value, part: string): Value {
  const low = part.toLowerCase();
  if (typeof v === "number") {
    const unit: Record<string, number> = { milliseconds: 1, seconds: 1000, minutes: 60_000, hours: 3_600_000, days: DAY, weeks: 7 * DAY, months: 30 * DAY, years: 365 * DAY };
    return low in unit ? v / unit[low] : null;
  }
  if (v instanceof DateValue) {
    const d = new Date(v.ms);
    const parts: Record<string, number> = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), millisecond: d.getUTCMilliseconds(), weekday: d.getUTCDay() || 7, weeknumber: isoWeek(d), week: isoWeek(d) };
    return low in parts ? parts[low] : null;
  }
  if (isLink(v)) return low === "path" ? v.link : low === "display" ? v.display : null;
  if (Array.isArray(v)) return v.map((x) => member(x, part));
  if (v && typeof v === "object") return part in v ? (v as Record<string, Value>)[part] : ((v as Record<string, Value>)[low] ?? null);
  return null;
}

function field(page: Record<string, Value>, path: string[]): Value {
  let v: Value = page;
  for (const part of path) {
    if (Array.isArray(v)) {
      // Dataview maps a field over a list: file.outlinks.display.
      v = v.map((x) => (x && typeof x === "object" && !Array.isArray(x) && !(x instanceof DateValue) ? ((x as Record<string, Value>)[part] ?? null) : null));
      continue;
    }
    if (v instanceof DateValue || isLink(v)) {
      v = member(v, part);
      continue;
    }
    if (!v || typeof v !== "object") return null;
    const obj = v as Record<string, Value>;
    v = part in obj ? obj[part] : (obj[part.toLowerCase()] ?? null);
  }
  return v;
}

export function evaluate(e: Expr, page: Record<string, Value>, now: number): Value {
  if (--evalLeft < 0) throw new DataviewLimitError("budget");
  switch (e.k) {
    case "lit":
      return e.v;
    case "field":
      return field(page, e.path);
    case "list":
      return e.items.map((x) => evaluate(x, page, now));
    case "un": {
      const v = evaluate(e.e, page, now);
      if (e.op === "!") return !truthy(v);
      const n = toNum(v);
      return n === null ? null : -n;
    }
    case "call":
      if (LAMBDA_FNS.has(e.fn) && e.args.some((x) => x.k === "lambda")) return callWithLambda(e.fn, e.args, page, now);
      return call(e.fn, e.args.map((x) => evaluate(x, page, now)), now);
    case "lambda":
      throw new DataviewError("a function (x) => … goes only inside filter, map, any, all, none or sort");
    case "bin": {
      if (e.op === "and") return truthy(evaluate(e.a, page, now)) && truthy(evaluate(e.b, page, now));
      if (e.op === "or") return truthy(evaluate(e.a, page, now)) || truthy(evaluate(e.b, page, now));
      const a = evaluate(e.a, page, now);
      const b = evaluate(e.b, page, now);
      switch (e.op) {
        case "=":
          return equal(a, b);
        case "!=":
          return !equal(a, b);
        case "<":
          return a !== null && b !== null && compare(a, b) < 0;
        case ">":
          return a !== null && b !== null && compare(a, b) > 0;
        case "<=":
          return a !== null && b !== null && compare(a, b) <= 0;
        case ">=":
          return a !== null && b !== null && compare(a, b) >= 0;
      }
      if (e.op === "+" && (typeof a === "string" || typeof b === "string")) return show(a) + show(b);
      if (a instanceof DateValue && typeof b === "number" && (e.op === "+" || e.op === "-")) return new DateValue(e.op === "+" ? a.ms + b : a.ms - b);
      const na = toNum(a);
      const nb = toNum(b);
      if (na === null || nb === null) return null;
      switch (e.op) {
        case "+":
          return na + nb;
        case "-":
          return na - nb;
        case "*":
          return na * nb;
        case "/":
          return nb === 0 ? null : na / nb;
        case "%":
          return nb === 0 ? null : na % nb;
      }
      return null;
    }
  }
}

function inSource(s: Source, page: Record<string, Value>): boolean {
  const file = page.file as Record<string, Value>;
  switch (s.k) {
    case "tag": {
      const tags = (file.tags as string[]).map((t) => t.slice(1).toLowerCase());
      return tags.some((t) => t === s.v || t.startsWith(s.v + "/"));
    }
    case "folder": {
      const path = String(file.path);
      if (!s.v) return true;
      // A folder, or a note given by its path.
      return path === s.v || path === s.v + ".md" || path.startsWith(s.v + "/");
    }
    case "link": {
      const key = s.v.replace(/\.md$/i, "").split("/").pop()!.toLowerCase();
      return (file.outlinks as LinkValue[]).some((l) => linkKey(l) === key);
    }
    case "not":
      return !inSource(s.s, page);
    case "and":
      return inSource(s.a, page) && inSource(s.b, page);
    case "or":
      return inSource(s.a, page) || inSource(s.b, page);
  }
}

export interface DvResult {
  type: "list" | "table" | "task";
  /** Column headers (TABLE: "File" first unless WITHOUT ID; the group's name after GROUP BY). */
  headers: string[];
  /**
   * One per note — or per group after GROUP BY (path: the key's note when the
   * key is a link, else ""), or per task in a TASK query.
   */
  rows: Array<{ path: string; name: string; cells: Value[]; task?: { text: string; status: string; completed: boolean; line: number }; group?: string }>;
}

interface Row {
  page: Record<string, Value>;
  note?: DvNote;
  line?: number;
  /** After GROUP BY: the rows in this group. */
  members?: Row[];
}

function setPath(page: Record<string, Value>, path: string[], v: Value): Record<string, Value> {
  const out = { ...page };
  if (path.length === 1) out[path[0]] = v;
  else {
    const inner = out[path[0]];
    out[path[0]] = setPath(inner && typeof inner === "object" && !Array.isArray(inner) && !(inner instanceof DateValue) ? (inner as Record<string, Value>) : {}, path.slice(1), v);
  }
  return out;
}

/**
 * Run a parsed query over the notes. `now` makes date(today) deterministic in
 * tests; `self` is the note the block is in (`this`).
 */
export function runDataview(q: DvQuery, notes: readonly DvNote[], now = Date.now(), self?: DvNote): DvResult {
  const outer = evalLeft;
  evalLeft = EVAL_BUDGET;
  try {
    return runBounded(q, notes, now, self);
  } finally {
    evalLeft = outer;
  }
}

function runBounded(q: DvQuery, notes: readonly DvNote[], now: number, self?: DvNote): DvResult {
  const thisPage = self ? pageOf(self) : null;
  const pages = notes
    .filter((n) => /\.md$/i.test(n.name))
    .map((n) => {
      const page = cachedPage(n);
      return { note: n, page: thisPage ? { ...page, this: thisPage } : page };
    })
    .filter(({ page }) => !q.from || inSource(q.from, page))
    .sort((x, y) => (x.note.path < y.note.path ? -1 : x.note.path > y.note.path ? 1 : 0));
  let rows: Row[] = pages;
  if (q.type === "task") {
    rows = pages.flatMap(({ note, page }) => {
      const file = page.file as Record<string, Value>;
      const tasks = file.tasks as Array<Record<string, Value>>;
      if (!tasks.length) return [];
      // A task inherits its page's fields (Dataview), but not the bracketed fields of the note's other tasks: those are theirs.
      const own = tasksOf(note.content);
      const fm = frontMatter(note.content);
      const theirs = new Set(own.flatMap((t) => Object.keys(t.fields).flatMap((k) => [k, k.toLowerCase().replace(/\s+/g, "-")])).filter((k) => !(k in fm)));
      const inherited = Object.fromEntries(Object.entries(page).filter(([k]) => !theirs.has(k)));
      return tasks.map((t) => ({ note, line: t.line as number, page: { ...inherited, ...t, file } }));
    });
  }
  // Old callers built queries before `steps`: the merged clauses, in the old order.
  const steps = q.steps ?? [...(q.where ? [{ k: "where" as const, e: q.where }] : []), ...(q.sort.length ? [{ k: "sort" as const, keys: q.sort }] : []), ...(q.limit !== null ? [{ k: "limit" as const, n: q.limit }] : [])];
  let groupName: string | null = null;
  for (const step of steps) {
    if (step.k === "where") rows = rows.filter((r) => truthy(evaluate(step.e, r.page, now)));
    else if (step.k === "limit") rows = rows.slice(0, step.n);
    else if (step.k === "sort") {
      const keyed = rows.map((r) => ({ r, keys: step.keys.map((s) => evaluate(s.e, r.page, now)) }));
      keyed.sort((x, y) => {
        for (let i = 0; i < step.keys.length; i++) {
          const c = compare(x.keys[i], y.keys[i]);
          if (c) return step.keys[i].desc ? -c : c;
        }
        return 0;
      });
      rows = keyed.map((k) => k.r);
    } else if (step.k === "flatten") {
      const out: Row[] = [];
      for (const r of rows) {
        const v = evaluate(step.e, r.page, now);
        for (const x of Array.isArray(v) ? v : [v]) {
          if (out.length >= MAX_ROWS) throw new DataviewLimitError("rows");
          out.push({ ...r, page: setPath(r.page, step.name, x) });
        }
      }
      rows = out;
    } else {
      const groups = new Map<string, { key: Value; members: Row[] }>();
      for (const r of rows) {
        const key = evaluate(step.e, r.page, now);
        const id = isLink(key) ? "link:" + linkKey(key) : JSON.stringify(key instanceof DateValue ? key.ms : key);
        const g = groups.get(id) ?? groups.set(id, { key, members: [] }).get(id)!;
        g.members.push(r);
      }
      const sorted = [...groups.values()].sort((a, b) => compare(a.key, b.key));
      // A group is a row with no note of its own: `key`, `rows` (its members' pages) and the key under the group's name.
      rows = sorted.map((g) => ({ page: { key: g.key, rows: g.members.map((m) => m.page), [step.name]: g.key }, members: g.members }));
      groupName = step.name;
    }
  }
  if (q.type === "task") {
    const out: DvResult["rows"] = [];
    const push = (r: Row, group?: string) => {
      const p = r.page;
      out.push({ path: r.note!.path, name: r.note!.name.replace(/\.md$/i, ""), cells: [p.text ?? null], task: { text: String(p.text ?? ""), status: String(p.status ?? " "), completed: p.completed === true, line: r.line ?? 0 }, ...(group !== undefined ? { group } : {}) });
    };
    for (const r of rows) {
      if (r.members) r.members.forEach((m) => push(m, show(r.page.key ?? null)));
      else push(r);
    }
    return { type: "task", headers: [], rows: out };
  }
  const headers = q.type === "table" ? [...(q.withoutId ? [] : [groupName ?? "File"]), ...q.fields.map((f) => f.name)] : [];
  return {
    type: q.type,
    headers,
    rows: rows.map((r) => {
      const key = r.page.key;
      const grouped = !r.note;
      return {
        path: grouped ? (isLink(key ?? null) ? (key as LinkValue).link : "") : r.note!.path,
        name: grouped ? show(key ?? null) : r.note!.name.replace(/\.md$/i, ""),
        cells: q.fields.map((f) => evaluate(f.e, r.page, now)),
      };
    }),
  };
}
