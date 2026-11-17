/**
 * What the `lumen` commands read out of notes (plan W13.K1): links, embeds,
 * tags, properties, headings and tasks. Pure; no file system.
 *
 * Fenced code blocks and code spans are never links, tags or tasks. Names
 * are compared the way the app compares them (`noteKey`: case, niqqud and
 * final letters do not matter), through the links engine (./links.ts).
 */
import { parseFrontmatter } from "../frontmatter.js";

export const MD_RE = /\.(md|markdown)$/i;
export const isNote = (p: string) => MD_RE.test(p);
export const stemOf = (p: string) => (p.split("/").pop() ?? p).replace(MD_RE, "");

/** The text with fenced code blocks and code spans blanked out (same length, same line numbers). */
export function blankCode(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  let out = "";
  let fence: { ch: string; len: number } | null = null;
  for (const line of text.split(/(?<=\n)/)) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len && !line.slice(m[0].length).trim()) fence = null;
      out += blank(line);
      continue;
    }
    if (m && !(m[1][0] === "`" && line.slice(m[0].length).includes("`"))) {
      fence = { ch: m[1][0], len: m[1].length };
      out += blank(line);
      continue;
    }
    out += line.replace(/(`+)([^`\n]|[^`\n][\s\S]*?[^`\n])\1(?!`)/g, (s) => blank(s));
  }
  return out;
}

export interface LinkRef {
  /** The target as written (wiki: before `#`/`|`; Markdown: the decoded path). */
  target: string;
  kind: "wiki" | "markdown";
  embed: boolean;
  line: number;
}

const WIKI = /(!?)\[\[([^\]\r\n|#]*)((?:#[^\]\r\n|]*)?)((?:\|[^\]\r\n]*)?)\]\]/g;
const MDLINK = /(!?)\[[^\]\r\n]*\]\(\s*(<[^>\r\n]*>|[^)\s]+)/g;

/** Line number (1-based) of an offset, by binary search over the line starts. */
function lineFinder(text: string): (index: number) => number {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Every link and embed of a note, outside code. External URLs and `#heading` links are left out. */
export function linksOf(text: string): LinkRef[] {
  const body = blankCode(text);
  const lineAt = lineFinder(body);
  const out: LinkRef[] = [];
  for (const m of body.matchAll(WIKI)) {
    const t = m[2].trim();
    if (!t) continue; // `[[#heading]]`: this note
    out.push({ target: t, kind: "wiki", embed: m[1] === "!", line: lineAt(m.index!) });
  }
  for (const m of body.matchAll(MDLINK)) {
    let dest = m[2];
    if (dest.startsWith("<") && dest.endsWith(">")) dest = dest.slice(1, -1);
    if (!dest || dest.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith("/")) continue;
    const cut = dest.search(/[?#]/);
    let p = cut < 0 ? dest : dest.slice(0, cut);
    try {
      p = decodeURI(p);
    } catch {
      /* a malformed escape: as written */
    }
    out.push({ target: p, kind: "markdown", embed: m[1] === "!", line: lineAt(m.index!) });
  }
  // Reference definitions: `[ref]: path.md` at the start of a line.
  for (const m of body.matchAll(/^ {0,3}\[(?!\^)[^\]\r\n]+\]:[ \t]*(<[^>\r\n]*>|\S+)/gm)) {
    let dest = m[1];
    if (dest.startsWith("<") && dest.endsWith(">")) dest = dest.slice(1, -1);
    if (!dest || dest.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith("/")) continue;
    const cut = dest.search(/[?#]/);
    let p = cut < 0 ? dest : dest.slice(0, cut);
    try {
      p = decodeURI(p);
    } catch {
      /* as written */
    }
    out.push({ target: p, kind: "markdown", embed: false, line: lineAt(m.index!) });
  }
  return out.sort((a, b) => a.line - b.line);
}

/**
 * Resolves links the way the app opens them, in O(1) per link (10k-note
 * vaults): Markdown links by relative path; a wiki link with a folder by
 * its path; a short one by name — a root-level note first, else the first
 * in listing order. A name with an extension other than .md names any file.
 */
export class Resolver {
  private readonly set: Set<string>;
  private readonly byPath = new Map<string, string>();
  private readonly byName = new Map<string, string>();
  private readonly fileByPath = new Map<string, string>();
  private readonly fileByName = new Map<string, string>();

  constructor(
    files: readonly string[],
    private readonly key: (s: string) => string,
  ) {
    this.set = new Set(files);
    const ordered = [...files.filter((p) => !p.includes("/")), ...files.filter((p) => p.includes("/"))];
    for (const p of ordered) {
      const base = p.split("/").pop() ?? p;
      if (isNote(p)) {
        const kp = key(p.replace(MD_RE, ""));
        if (!this.byPath.has(kp)) this.byPath.set(kp, p);
        const kn = key(stemOf(p));
        if (!this.byName.has(kn)) this.byName.set(kn, p);
      }
      const fp = key(p);
      if (!this.fileByPath.has(fp)) this.fileByPath.set(fp, p);
      const fn = key(base);
      if (!this.fileByName.has(fn)) this.fileByName.set(fn, p);
    }
  }

  resolve(ref: LinkRef, from: string): string | null {
    if (ref.kind === "markdown") {
      const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
      const parts: string[] = [];
      for (const part of (dir ? `${dir}/${ref.target}` : ref.target).split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") parts.pop();
        else parts.push(part);
      }
      const p = parts.join("/");
      return this.set.has(p) ? p : null;
    }
    const t = ref.target;
    const attachment = /\.[A-Za-z0-9]+$/.test(t) && !MD_RE.test(t);
    if (attachment) return (t.includes("/") ? this.fileByPath.get(this.key(t)) : this.fileByName.get(this.key(t))) ?? null;
    const k = this.key(t.replace(MD_RE, ""));
    return (t.includes("/") ? this.byPath.get(k) : this.byName.get(k)) ?? null;
  }
}

/** One link, resolved (builds a resolver; use `Resolver` for many). */
export function resolveLink(ref: LinkRef, from: string, files: readonly string[], key: (s: string) => string): string | null {
  return new Resolver(files, key).resolve(ref, from);
}

const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}\p{M}_/-]*)/gu;

/** Frontmatter `tags` and inline `#tags` outside code, as written (without `#`). */
export function tagsOf(text: string): string[] {
  const fm = parseFrontmatter(text);
  const out = new Set<string>();
  const raw = propertiesOf(text).tags;
  for (const t of Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/[,\s]+/) : []) if (t.replace(/^#/, "").trim()) out.add(t.replace(/^#/, "").trim());
  const body = blankCode(text.slice(fm.bodyStart));
  for (const m of body.matchAll(TAG_RE)) if (!/^\d+$/.test(m[2])) out.add(m[2]);
  return [...out];
}

/** Rename tag `from` (and its nested `from/…`) to `to` in one note. Same string when nothing changed. */
export function renameTag(text: string, from: string, to: string): string {
  const fold = (s: string) => s.toLocaleLowerCase();
  const hit = (t: string) => fold(t) === fold(from) || fold(t).startsWith(fold(from) + "/");
  const swap = (t: string) => to + t.slice(from.length);
  const fm = parseFrontmatter(text);
  let head = text.slice(0, fm.bodyStart);
  if (fm.rawHeader !== null) {
    head = head.replace(/^(tags\s*:\s*)(.*)$/m, (_m, k: string, v: string) => {
      if (v.startsWith("[") && v.endsWith("]")) {
        const items = v.slice(1, -1).split(",").map((s) => s.trim());
        return `${k}[${items.map((s) => { const q = /^"(.*)"$/.exec(s); const bare = (q ? q[1] : s).replace(/^#/, ""); return hit(bare) ? (q ? JSON.stringify(swap(bare)) : swap(bare)) : s; }).join(", ")}]`;
      }
      return k + v.replace(/(^|[\s,])#?([^\s,]+)/g, (m, sep: string, t: string) => (hit(t) ? `${sep}${m.includes("#") ? "#" : ""}${swap(t)}` : m));
    });
    // A YAML list under `tags:`.
    head = head.replace(/^(tags\s*:\s*\n)((?:[ \t]*-[ \t]*.*\n?)+)/m, (_m, k: string, list: string) =>
      k + list.replace(/^([ \t]*-[ \t]*)("?)#?([^"\n]+)\2[ \t]*$/gm, (m, dash: string, q: string, t: string) => (hit(t.trim()) ? `${dash}${q}${swap(t.trim())}${q}` : m)),
    );
  }
  const body = text.slice(fm.bodyStart);
  const masked = blankCode(body);
  let out = "";
  let last = 0;
  for (const m of masked.matchAll(TAG_RE)) {
    if (!hit(m[2])) continue;
    const at = m.index! + m[1].length + 1;
    out += body.slice(last, at) + swap(m[2]);
    last = at + m[2].length;
  }
  const next = head + out + body.slice(last);
  return next === text ? text : next;
}

/** Remove tag `tag` (exactly; not nested ones) from a note. */
export function removeTag(text: string, tag: string): string {
  const fold = (s: string) => s.toLocaleLowerCase();
  const fm = parseFrontmatter(text);
  let head = text.slice(0, fm.bodyStart);
  if (fm.rawHeader !== null) {
    head = head.replace(/^(tags\s*:\s*)\[(.*)\]\s*$/m, (_m, k: string, v: string) => `${k}[${v.split(",").map((s) => s.trim()).filter((s) => fold(s.replace(/^"(.*)"$/, "$1").replace(/^#/, "")) !== fold(tag)).join(", ")}]`);
    head = head.replace(/^[ \t]*-[ \t]*"?#?([^"\n]+)"?[ \t]*\n/gm, (m, t: string) => (fold(t.trim()) === fold(tag) && /\ntags\s*:\s*\n/.test("\n" + head) ? "" : m));
  }
  const body = text.slice(fm.bodyStart);
  const masked = blankCode(body);
  let out = "";
  let last = 0;
  for (const m of masked.matchAll(TAG_RE)) {
    if (fold(m[2]) !== fold(tag)) continue;
    const at = m.index! + m[1].length;
    out += body.slice(last, at);
    last = at + 1 + m[2].length;
    if (body[last] === " " && (at === 0 || /\s/.test(body[at - 1] ?? ""))) last++;
  }
  const next = head + out + body.slice(last);
  return next === text ? text : next;
}

/** A YAML scalar written back the way `parseFrontmatter` reads it. */
function yamlValue(v: string | string[]): string {
  if (Array.isArray(v)) return `[${v.map((x) => JSON.stringify(x)).join(", ")}]`;
  return /[:#&*?{}|[\],"']|^\s|\s$|^$/.test(v) ? JSON.stringify(v) : v;
}

const KEY_RE = /^[\p{L}\p{N}_-]+$/u;
export const isPropertyKey = (k: string) => KEY_RE.test(k);

/** Set (or, with `value` undefined, remove) one frontmatter property. Other lines are kept byte for byte. */
export function setProperty(text: string, key: string, value: string | string[] | undefined): string {
  if (!isPropertyKey(key)) throw new Error(`'${key}' is not a property name.`);
  const fm = parseFrontmatter(text);
  if (fm.rawHeader === null) {
    if (value === undefined) return text;
    return `---\n${key}: ${yamlValue(value)}\n---\n${text}`;
  }
  const lines = fm.rawHeader.split("\n");
  const keyRe = new RegExp(`^${key.replace(/[-]/g, "\\-")}\\s*:`);
  const at = lines.findIndex((l) => keyRe.test(l));
  // A block list under the key goes with it.
  let end = at + 1;
  if (at >= 0) while (end < lines.length && /^[ \t]+-|^[ \t]+\S/.test(lines[end])) end++;
  if (value === undefined) {
    if (at < 0) return text;
    lines.splice(at, end - at);
  } else if (at < 0) lines.push(`${key}: ${yamlValue(value)}`);
  else lines.splice(at, end - at, `${key}: ${yamlValue(value)}`);
  const header = lines.join("\n");
  return `---\n${header}${header ? "\n" : ""}---\n${text.slice(fm.bodyStart)}`;
}

/** Rename a property key, keeping its value lines. */
export function renameProperty(text: string, from: string, to: string): string {
  if (!isPropertyKey(to)) throw new Error(`'${to}' is not a property name.`);
  const fm = parseFrontmatter(text);
  if (fm.rawHeader === null) return text;
  const lines = fm.rawHeader.split("\n");
  if (lines.some((l) => new RegExp(`^${to}\\s*:`).test(l))) throw new Error(`The note already has a property '${to}'.`);
  const re = new RegExp(`^${from.replace(/[-]/g, "\\-")}(\\s*:)`);
  const i = lines.findIndex((l) => re.test(l));
  if (i < 0) return text;
  lines[i] = lines[i].replace(re, `${to}$1`);
  return `---\n${lines.join("\n")}\n---\n${text.slice(fm.bodyStart)}`;
}

/** Frontmatter as `parseFrontmatter` reads it, plus YAML block lists (`key:\n  - a`). */
export function propertiesOf(text: string): Record<string, unknown> {
  const fm = parseFrontmatter(text);
  const data: Record<string, unknown> = { ...fm.data };
  if (fm.rawHeader !== null) {
    for (const m of fm.rawHeader.matchAll(/^([\p{L}\p{N}_-]+)\s*:\s*\n((?:[ \t]+-[ \t]*.*(?:\n|$))+)/gmu)) {
      data[m[1]] = m[2].split("\n").map((l) => l.replace(/^[ \t]+-[ \t]*/, "").trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
    }
    for (const m of fm.rawHeader.matchAll(/^([\p{L}\p{N}_-]+)\s*:\s*(.*)$/gmu)) if (!(m[1] in data)) data[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return data;
}

export interface Heading {
  level: number;
  text: string;
  line: number;
}

export function headingsOf(text: string): Heading[] {
  const fm = parseFrontmatter(text);
  const skip = fm.bodyStart ? text.slice(0, fm.bodyStart).split("\n").length - 1 : 0;
  const body = blankCode(text.slice(fm.bodyStart));
  const out: Heading[] = [];
  body.split("\n").forEach((l, i) => {
    const m = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t#]*$/.exec(l);
    if (m) out.push({ level: m[1].length, text: m[2], line: i + 1 + skip });
  });
  return out;
}

export interface TaskLine {
  line: number;
  done: boolean;
  text: string;
}

const TASK_RE = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\][ \t]+)(.*)$/;

export function tasksOf(text: string): TaskLine[] {
  const body = blankCode(text);
  const out: TaskLine[] = [];
  body.split("\n").forEach((l, i) => {
    const m = TASK_RE.exec(l);
    if (m) out.push({ line: i + 1, done: m[2] !== " ", text: m[4] });
  });
  return out;
}

/** Mark the task on `line` done or open. Throws when that line is not a task. */
export function setTask(text: string, line: number, done: boolean): string {
  const lines = text.split("\n");
  const masked = blankCode(text).split("\n");
  const m = TASK_RE.exec(masked[line - 1] ?? "");
  if (!m) throw new Error(`Line ${line} is not a task.`);
  lines[line - 1] = lines[line - 1].replace(TASK_RE, (_s, a: string, _b: string, c: string, d: string) => `${a}${done ? "x" : " "}${c}${d}`);
  return lines.join("\n");
}

/** Words, the way a person counts them: letters and digits, Hebrew with its niqqud and geresh. */
export function wordCount(text: string): { words: number; characters: number } {
  const body = text.slice(parseFrontmatter(text).bodyStart);
  const words = body.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’״׳"-]*/gu) ?? [];
  return { words: words.length, characters: [...body.replace(/\s/g, "")].length };
}

export function appendText(before: string, add: string): string {
  if (before === "") return add.endsWith("\n") ? add : `${add}\n`;
  return `${before}${before.endsWith("\n") ? "" : "\n"}${add}${add.endsWith("\n") ? "" : "\n"}`;
}

/** Insert after the frontmatter, so properties stay first. */
export function prependText(before: string, add: string): string {
  const at = parseFrontmatter(before).bodyStart;
  return before.slice(0, at) + (add.endsWith("\n") ? add : `${add}\n`) + before.slice(at);
}
