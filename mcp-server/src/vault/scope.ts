/**
 * Plan W11.I7 — which notes an MCP client may see at all: allow and deny
 * lists by folder and by tag, in `.lumen/mcp.json`, for the whole vault
 * (`scope`) and per client (`clients.<id>.scope`). They apply to every tool:
 * search, read, list, tags, backlinks, Bases, and every write proposal.
 *
 *   "scope": { "allow": { "folders": ["work"], "tags": ["shareable"] },
 *              "deny":  { "folders": ["journal"], "tags": ["private"] } }
 *
 * A note is in scope when no allow list is set or it matches one (a folder
 * OR a tag), and it matches no deny entry. Deny always wins, and both the
 * vault's and the client's rules must pass. Tags are the frontmatter `tags`
 * and inline `#tags`; a tag rule covers its nested tags (`private` covers
 * `private/health`). A note out of scope answers exactly like a note that
 * does not exist, so its name is not leaked either.
 */
import { parseFrontmatter } from "../frontmatter.js";

export interface ScopeList {
  folders?: string[];
  tags?: string[];
}
export interface ScopeRules {
  allow?: ScopeList;
  deny?: ScopeList;
}

const cleanFolder = (f: string) => f.replace(/\\/g, "/").replace(/^\.?\/+|\/+$/g, "").normalize("NFC").toLowerCase();
const cleanTag = (t: string) => t.replace(/^#/, "").normalize("NFC").toLowerCase();

/** Read a scope object from config JSON; anything malformed is dropped. */
export function readScope(v: unknown): ScopeRules | undefined {
  if (!v || typeof v !== "object") return undefined;
  const list = (x: unknown): ScopeList | undefined => {
    if (!x || typeof x !== "object") return undefined;
    const o = x as Record<string, unknown>;
    const arr = (a: unknown, clean: (s: string) => string) => (Array.isArray(a) ? a.filter((s): s is string => typeof s === "string" && !!s.trim()).map(clean).filter(Boolean) : undefined);
    const out: ScopeList = {};
    const folders = arr(o.folders, cleanFolder);
    const tags = arr(o.tags, cleanTag);
    if (folders?.length) out.folders = folders;
    if (tags?.length) out.tags = tags;
    return out.folders || out.tags ? out : undefined;
  };
  const r = v as Record<string, unknown>;
  const out: ScopeRules = {};
  const allow = list(r.allow);
  const deny = list(r.deny);
  if (allow) out.allow = allow;
  if (deny) out.deny = deny;
  return out.allow || out.deny ? out : undefined;
}

/** A note's tags: frontmatter `tags` (list or string) and inline `#tags` outside code. */
export function noteTags(text: string): string[] {
  const fm = parseFrontmatter(text);
  const raw = fm.data.tags;
  const out = new Set<string>();
  for (const t of Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/[,\s]+/) : []) if (t.trim()) out.add(cleanTag(t));
  const body = text.slice(fm.bodyStart).replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const m of body.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu)) out.add(cleanTag(m[1]));
  return [...out];
}

const inFolder = (rel: string, folders: string[]) => {
  const p = cleanFolder(rel);
  return folders.some((f) => p === f || p.startsWith(`${f}/`));
};
const hasTag = (tags: string[], rules: string[]) => tags.some((t) => rules.some((r) => t === r || t.startsWith(`${r}/`)));

function passes(rel: string, tags: string[], r: ScopeRules | undefined): boolean {
  if (!r) return true;
  if (r.deny && ((r.deny.folders && inFolder(rel, r.deny.folders)) || (r.deny.tags && hasTag(tags, r.deny.tags)))) return false;
  if (r.allow && (r.allow.folders || r.allow.tags)) return !!((r.allow.folders && inFolder(rel, r.allow.folders)) || (r.allow.tags && hasTag(tags, r.allow.tags)));
  return true;
}

/**
 * The first line of a note locked with its own password (src/storage/lockedNotesRegistry.ts
 * `LOCKED_NOTE_MAGIC`; this package cannot import the app, and a test keeps the two equal).
 * W12.A2: a locked note is never in scope, whatever the rules say.
 */
export const LOCKED_NOTE_MAGIC = "<!-- lumen-locked-note v1 -->";

/**
 * Whether a note (its vault-relative path and its text, or null for a note that does not exist yet) is in scope for every rule set.
 * This is the one scope test for both the MCP server (W11.I7) and "Ask the vault" in the app (W12.A2, src/ai/askScope.ts).
 */
export function inScope(rel: string, text: string | null, rules: readonly (ScopeRules | undefined)[]): boolean {
  if (text !== null && text.startsWith(LOCKED_NOTE_MAGIC)) return false;
  const tags = text === null ? [] : noteTags(text);
  return rules.every((r) => passes(rel, tags, r));
}

/** Whether any rule applies at all (no rules: nothing to filter). */
export const hasRules = (rules: readonly (ScopeRules | undefined)[]) => rules.some((r) => !!r);

/**
 * Anchors for citations (W11.I7): `[[path#Heading]]` for the heading a line
 * is under, or `[[path#L<line>]]` (1-based) above the first heading.
 */
export function anchorAt(rel: string, text: string, line: number): string {
  const lines = text.split("\n");
  let inCode = false;
  let heading: string | null = null;
  for (let i = 0; i < Math.min(line, lines.length); i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inCode = !inCode;
    const m = !inCode && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (m) heading = m[1];
  }
  const target = rel.replace(/\.(md|markdown)$/i, "");
  return heading ? `[[${target}#${heading}]]` : `[[${target}#L${line}]]`;
}

/** The line (1-based) where `needle` first occurs (case-insensitive), or 1. */
export function lineOf(text: string, needle: string): number {
  const at = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  return at < 0 ? 1 : text.slice(0, at).split("\n").length;
}

/** Every heading's anchor of a note, or the note itself when it has none. */
export function noteAnchors(rel: string, text: string): string[] {
  const target = rel.replace(/\.(md|markdown)$/i, "");
  const out: string[] = [];
  let inCode = false;
  for (const l of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(l)) inCode = !inCode;
    const m = !inCode && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) out.push(`[[${target}#${m[1]}]]`);
  }
  return out.length ? out : [`[[${target}]]`];
}
