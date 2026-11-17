/**
 * Roam Research: the JSON export (… → Export All → JSON), one array of
 * pages, each a tree of blocks (plan W13.F1).
 *
 * What becomes of it:
 *  - every page becomes a note; a title with `/` (a namespace) becomes
 *    folders, a daily-note title (`January 2nd, 2021`) becomes
 *    `journal/2021-01-02.md` — the folder Lumen's daily notes use — and
 *    every link to it follows;
 *  - the blocks stay an outline (a nested list), Roam's own shape; a heading
 *    block (`heading: 1–3`) becomes a Markdown heading and a `{{table}}`
 *    becomes a Markdown table;
 *  - `Name:: value` blocks at the top of a page become properties;
 *  - a block another block points at gets a `^id` at its end, and
 *    `((uid))`, `[text](((uid)))`, `{{embed: ((uid))}}` become
 *    `![[Page#^id]]` / `[[Page#^id|text]]`;
 *  - `{{[[TODO]]}}` / `{{[[DONE]]}}` become tasks, `__x__` → `*x*`,
 *    `^^x^^` → `==x==`, `#[[a b]]` → `[[a b]]`, `[text]([[Page]])` →
 *    `[[Page|text]]`;
 *  - files Roam keeps on its own servers (firebasestorage) stay links:
 *    nothing is downloaded (no network), and the report says so.
 *
 * Written for lumen-md; the shapes it handles were checked against
 * Obsidian Importer's public Roam fixtures (MIT), whose outputs are the
 * oracle of `npm run import:diff`. No code of it is used here.
 */
import { claimPath, safeName } from "./names";
import { isoDate, withFrontmatter } from "./frontmatter";
import { emptyVault, type ConvertedVault } from "./types";
import { swallowed } from "../../lib/logger";

interface RoamBlock {
  string?: string;
  uid?: string;
  heading?: number;
  children?: RoamBlock[];
  "create-time"?: number;
  "edit-time"?: number;
}

interface RoamPage {
  title?: string;
  uid?: string;
  children?: RoamBlock[];
  "create-time"?: number;
  "edit-time"?: number;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Roam's daily-note title (`January 2nd, 2021`) → `2021-01-02`; null for any other title. */
export function roamDailyDate(title: string): string | null {
  const m = /^([A-Z][a-z]+) (\d{1,2})(st|nd|rd|th), (\d{4})$/.exec(title.trim());
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase());
  const day = Number(m[2]);
  if (mo < 0 || day < 1 || day > 31) return null;
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  if (suffix !== m[3]) return null;
  return `${m[4]}-${String(mo + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Does this JSON look like a Roam export: an array of pages with a title and blocks. */
export function looksLikeRoam(json: unknown): json is RoamPage[] {
  if (!Array.isArray(json) || !json.length) return false;
  const sample = json.slice(0, 20);
  return sample.every((p) => p && typeof p === "object" && typeof (p as RoamPage).title === "string") && sample.some((p) => Array.isArray((p as RoamPage).children) || "uid" in (p as object) || "create-time" in (p as object));
}

/** Roam's 9-character uids may hold `_`, which a `^block` id cannot: `_` → `-`, kept unique. */
function anchorIds(uids: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const uid of uids) {
    let id = uid.replace(/[^A-Za-z0-9-]/g, "-");
    let n = 2;
    const base = id;
    while (used.has(id.toLowerCase())) id = `${base}-${n++}`;
    used.add(id.toLowerCase());
    out.set(uid, id);
  }
  return out;
}

/** Components that only mean something inside Roam (as Obsidian Importer drops them too). */
const ROAM_ONLY = /\{\{(?:\[\[)?(?:POMO|word-count|date|slider|encrypt|TaoOfRoam|orphans|count|character-count|comment-button|streak|attr-table|mentions|search|roam\/render|roam\/css|calc)(?:\]\])?[^{}]*?\}\}\}?/g;

const ATTR = /^([^\n[\]{}:]{1,80})::([^\n]*)$/;
const TABLE = /^\{\{(\[\[table\]\]|table)\}\}$/i;
const REF = /\(\(([A-Za-z0-9_-]{6,})\)\)/g;

/** Text outside code spans and fences, rewritten by `fn`; code is left as written. */
function outsideCode(text: string, fn: (s: string) => string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join("");
}

/** Roam glues a closing fence to the last line (`code```): fences on their own lines. */
function fencesOnOwnLines(text: string): string {
  if (!text.includes("```")) return text;
  return text.replace(/```([^`\n]*)\n([\s\S]*?)\n?```/g, (_, lang: string, body: string) => `\`\`\`${lang}\n${body.replace(/\n+$/, "")}\n\`\`\``);
}

interface Ctx {
  /** Lower-cased Roam title → the wikilink target written for it. */
  link: Map<string, string>;
  /** Block uid → `Page#^id`. */
  blockTarget: Map<string, string>;
  /** Referenced uid → its `^id`. */
  anchor: Map<string, string>;
  remote: number;
}

/** A page title as a link target: its note's path (without `.md`), with the title as the shown text when they differ. */
function wikiFor(ctx: Ctx, title: string, alias?: string): string {
  let to = ctx.link.get(title.toLowerCase());
  // A daily note the export does not hold is still linked by its date, where Lumen's daily note for that day will be.
  to ??= roamDailyDate(title) ?? undefined;
  if (!to) return `[[${title}${alias ? `|${alias}` : ""}]]`;
  const shown = alias ?? (to === title ? undefined : title);
  return `[[${to}${shown ? `|${shown}` : ""}]]`;
}

/** One block's text, Roam markup → Markdown. */
function roamInline(raw: string, ctx: Ctx): string {
  let text = fencesOnOwnLines(raw);
  if (/firebasestorage\.googleapis\.com/.test(text)) ctx.remote++;
  text = outsideCode(text, (s) => {
    let t = s;
    // Embeds: of a block, or of a page.
    t = t.replace(/\{\{\[{0,2}embed(?:-path)?\]{0,2}:\s*\(\(([A-Za-z0-9_-]+)\)\)\s*\}\}/g, (m, uid: string) => {
      const to = ctx.blockTarget.get(uid);
      return to ? `![[${to}]]` : m;
    });
    t = t.replace(/\{\{\[{0,2}embed\]{0,2}:\s*\[\[([^\]]+)\]\]\s*\}\}/g, (_, title: string) => `!${wikiFor(ctx, title)}`);
    // Tasks.
    t = t.replace(/\{\{\[\[TODO\]\]\}\}|\{\{TODO\}\}/g, "[ ]").replace(/\{\{\[\[DONE\]\]\}\}|\{\{DONE\}\}/g, "[x]");
    // A video player pointing at a URL: the URL.
    t = t.replace(/\{\{\[{0,2}(?:video|youtube)\]{0,2}:\s*(https?:\/\/[^\s{}]+)\s*\}\}/gi, "![]($1)");
    // Other players (pdf, audio, iframe): a link to what they played.
    t = t.replace(/\{\{\[{0,2}(pdf|audio|iframe)\]{0,2}:\s*(https?:\/\/[^\s{}]+)\s*\}\}/gi, "[$1]($2)");
    // `[[.rm-grid]]` / `#.rm-hide` name a CSS class Roam styles the block with: nothing to read.
    t = t.replace(/\s*(?:\[\[\.[^\]]*\]\]|#\.[^\s[\]#]+)/g, "");
    // Aliased references: to a block, to a page.
    t = t.replace(/\[([^[\]]+?)\]\(\(\(([A-Za-z0-9_-]+)\)\)\)/g, (m, alias: string, uid: string) => {
      const to = ctx.blockTarget.get(uid);
      return to ? `[[${to}|${alias}]]` : m;
    });
    t = t.replace(/\[([^[\]]+?)\]\(\[\[([^\]]+)\]\]\)/g, (_, alias: string, title: string) => wikiFor(ctx, title, alias));
    // Block references; `((an aside))` that is nobody's uid stays text.
    t = t.replace(REF, (m, uid: string) => {
      const to = ctx.blockTarget.get(uid);
      return to ? `![[${to}]]` : m;
    });
    // Roam's own components, with no Markdown counterpart: gone (a timer, a slider, a word count…).
    t = t.replace(ROAM_ONLY, "");
    // Any other component names itself in brackets (`{{[[kanban]]}}`): that is not a page link.
    t = t.replace(/\{\{\[\[([^\]]+)\]\]/g, "{{$1").replace(/\[\[>\]\]/g, ">");
    // #[[multi word]] is a page reference; then every [[Page]].
    t = t.replace(/#\[\[([^\]]+)\]\]/g, "[[$1]]");
    t = t.replace(/(\{\{)?\[\[([^[\]]+)\]\]/g, (m, comp: string | undefined, title: string) => (comp ? m : wikiFor(ctx, title)));
    t = t.replace(/__(.+?)__/g, "*$1*").replace(/\^\^(.+?)\^\^/g, "==$1==");
    return t;
  });
  return text;
}

interface Out {
  lines: string[];
}

/** A table: each path from the marker's child to a leaf is a row. */
function table(block: RoamBlock, ctx: Ctx): string[] {
  const rows: string[][] = [];
  const walk = (b: RoamBlock, before: string[]) => {
    const cell = roamInline(b.string ?? "", ctx).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
    const cells = [...before, cell];
    const kids = b.children ?? [];
    if (!kids.length) rows.push(cells);
    let carried = cells;
    for (const k of kids) {
      walk(k, carried);
      carried = cells.map(() => "");
    }
  };
  for (const r of block.children ?? []) walk(r, []);
  if (!rows.length) return [];
  const width = Math.max(...rows.map((r) => r.length));
  for (const r of rows) while (r.length < width) r.push("");
  rows.splice(1, 0, rows[0].map(() => "---"));
  return ["", ...rows.map((r) => `| ${r.join(" | ")} |`), ""];
}

function renderBlocks(blocks: RoamBlock[], startDepth: number, ctx: Ctx, out: Out): void {
  // A heading restarts the outline under it (Markdown has no heading inside a list item), so its
  // siblings after it go on from the left margin too.
  let depth = startDepth;
  for (const b of blocks) {
    const s = b.string ?? "";
    if (TABLE.test(s.trim())) {
      // Inside a list item, the table is indented to the item's text so the outline goes on after it.
      const pad = depth ? `${"    ".repeat(depth - 1)}  ` : "";
      out.lines.push(...table(b, ctx).map((l) => (l ? pad + l : l)));
      continue;
    }
    const anchor = b.uid ? ctx.anchor.get(b.uid) : undefined;
    const text = roamInline(s, ctx);
    if (b.heading && b.heading >= 1 && b.heading <= 6 && text.trim() && !text.includes("\n")) {
      depth = 0;
      const body = text.trim().replace(/^\*\*([^*]+)\*\*$/, "$1");
      if (out.lines.length && out.lines[out.lines.length - 1] !== "") out.lines.push("");
      out.lines.push(`${"#".repeat(b.heading)} ${body}${anchor ? ` ^${anchor}` : ""}`, "");
      renderBlocks(b.children ?? [], 0, ctx, out);
      if (b.children?.length) out.lines.push("");
      continue;
    }
    if (!text.trim() && !anchor) {
      // An empty block keeps its children, one level up.
      renderBlocks(b.children ?? [], depth, ctx, out);
      continue;
    }
    const indent = "    ".repeat(depth);
    const [first, ...rest] = text.split("\n");
    const task = /^\s*\[( |x)\]\s/.test(first);
    const multi = rest.length > 0;
    out.lines.push(`${indent}- ${task ? first.trimStart() : first}${anchor && !multi ? ` ^${anchor}` : ""}`);
    for (const r of rest) out.lines.push(r ? `${indent}  ${r}` : "");
    if (anchor && multi) out.lines.push(`${indent}  ^${anchor}`);
    renderBlocks(b.children ?? [], depth + 1, ctx, out);
  }
}

/** The page's `Name:: value` leaf blocks at the top (not ones a reference points at). */
function attributesOf(page: RoamPage, ctx: Ctx): { props: Record<string, string>; used: Set<RoamBlock> } {
  const props: Record<string, string> = {};
  const used = new Set<RoamBlock>();
  for (const b of page.children ?? []) {
    if (b.children?.length || (b.uid && ctx.anchor.has(b.uid))) continue;
    const m = ATTR.exec(b.string ?? "");
    if (!m || !m[1].trim() || !m[2].trim()) continue;
    const name = m[1].trim();
    if (name in props) continue;
    props[name] = roamInline(m[2].trim(), ctx);
    used.add(b);
  }
  return { props, used };
}

/** Parse every Roam JSON file of the export into pages (bad JSON is reported, not thrown). */
function readRoamPages(files: Map<string, Uint8Array>, vault: ConvertedVault): RoamPage[] {
  const pages: RoamPage[] = [];
  const dec = new TextDecoder();
  for (const [p, data] of files) {
    if (!/\.json$/i.test(p)) {
      if (/\.(md|markdown)$/i.test(p)) vault.skipped.push({ path: p, reason: "unsupported", detail: "JSON" });
      else if (!/(^|\/)\.DS_Store$/.test(p)) {
        vault.sourceAttachments++;
        vault.attachments.set(p.normalize("NFC"), data);
      }
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(dec.decode(data));
    } catch (e) {
      swallowed("import/roam: a file is not JSON; it is listed as skipped", e);
      vault.skipped.push({ path: p, reason: "unreadable" });
      continue;
    }
    if (!looksLikeRoam(json)) {
      vault.skipped.push({ path: p, reason: "unreadable" });
      continue;
    }
    pages.push(...json);
  }
  return pages;
}

export function convertRoam(files: Map<string, Uint8Array>): ConvertedVault {
  const vault = emptyVault();
  const pages = readRoamPages(files, vault);
  const taken = new Set([...vault.attachments.keys()].map((k) => k.toLowerCase()));
  // 1. Names: a path per page, before anything links to it.
  const pathOf = new Map<RoamPage, string>();
  const link = new Map<string, string>();
  for (const page of pages) {
    const title = (page.title ?? "").normalize("NFC");
    if (!title.trim()) {
      vault.skipped.push({ path: page.uid ?? "(untitled)", reason: "unreadable", detail: "no title" });
      continue;
    }
    const day = roamDailyDate(title);
    // `[`, `]`, `#`, `|` and `^` would break a wikilink to the note: out of its name (the title stays the shown text).
    const rel = day ? `journal/${day}` : title.split("/").map((s) => safeName(s.replace(/[[\]]/g, "").replace(/[#|^]/g, "-"))).join("/");
    const path = claimPath(taken, `${rel}.md`);
    pathOf.set(page, path);
    // A daily note is linked by its date; a page by its path.
    const target = day ? path.slice("journal/".length, -3) : path.slice(0, -3);
    if (!link.has(title.toLowerCase())) link.set(title.toLowerCase(), target);
  }
  // 2. Blocks: where each uid lives, and which ones something points at.
  const owner = new Map<string, string>();
  const walkAll = (blocks: RoamBlock[] | undefined, fn: (b: RoamBlock) => void) => {
    for (const b of blocks ?? []) {
      fn(b);
      walkAll(b.children, fn);
    }
  };
  for (const [page, path] of pathOf) {
    const target = path.startsWith("journal/") ? path.slice("journal/".length, -3) : path.slice(0, -3);
    walkAll(page.children, (b) => {
      if (b.uid && !TABLE.test((b.string ?? "").trim())) owner.set(b.uid, target);
    });
  }
  const referenced: string[] = [];
  const seen = new Set<string>();
  for (const page of pathOf.keys())
    walkAll(page.children, (b) => {
      for (const m of (b.string ?? "").matchAll(REF))
        if (owner.has(m[1]) && !seen.has(m[1])) {
          seen.add(m[1]);
          referenced.push(m[1]);
        }
    });
  const anchor = anchorIds(referenced);
  const blockTarget = new Map([...anchor].map(([uid, id]) => [uid, `${owner.get(uid)}#^${id}`]));
  const ctx: Ctx = { link, blockTarget, anchor, remote: 0 };
  // 3. Pages.
  for (const [page, path] of pathOf) {
    ctx.remote = 0;
    const { props, used } = attributesOf(page, ctx);
    const out: Out = { lines: [] };
    renderBlocks((page.children ?? []).filter((b) => !used.has(b)), 0, ctx, out);
    const body = out.lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+|\n+$/g, "");
    const created = isoDate(page["create-time"]);
    const updated = isoDate(page["edit-time"]);
    if (!created && !updated) vault.warnings.push({ path, reason: "noDates" });
    if (ctx.remote) vault.warnings.push({ path, reason: "remoteAttachment", detail: String(ctx.remote) });
    vault.notes.set(path, withFrontmatter({ ...props, created, updated }, body ? `${body}\n` : ""));
  }
  return vault;
}
