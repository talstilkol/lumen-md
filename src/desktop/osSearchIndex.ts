/**
 * Notes in the system's search (plan W13.K3): Spotlight on macOS (Core
 * Spotlight), Windows Search on Windows — only with the user's consent.
 *
 * - Off by default, per vault. Turning it on indexes the vault's notes;
 *   turning it off deletes everything Lumen put in the system index for
 *   that vault (the whole domain), and forgets what was sent.
 * - What goes in: the title and a short plain-text excerpt (300
 *   characters), the tags as keywords, and a `lumen://open?path=…&vault=…`
 *   link, so a hit opens the note in the vault it belongs to (the deep link
 *   names the vault; src-tauri/desktop/src/deeplink.rs).
 * - What never goes in: a note locked with its own password, an encrypted
 *   file (age), a note marked `private: true` or `searchable: false` in its
 *   properties, anything in a dot folder, and nothing at all from an
 *   encrypted vault. The excerpt is cut from the note's text after its
 *   properties, so property values do not leak into it.
 * - Incremental: a note is sent again only when its title, excerpt, tags
 *   or path changed (a hash per note is kept); a deleted or renamed note is
 *   removed from the index.
 *
 * The system index is reached through a bridge (the desktop shell). Until
 * the shell has one, `available` is false and the setting is not offered.
 */

import { isSealedNote } from "../storage/lockedNotesRegistry";

export interface OsSearchItem {
  /** Stable per (vault, path): the system index's unique id. */
  id: string;
  /** The vault's group in the system index; deleting it deletes all of the vault's items. */
  domain: string;
  title: string;
  excerpt: string;
  keywords: string[];
  /** Opens the note in its vault. */
  url: string;
}

/** The desktop shell's side: Core Spotlight / Windows Search. */
export interface OsSearchBridge {
  readonly available: boolean;
  index(items: OsSearchItem[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  /** Delete every item of a domain (the whole vault). */
  clearDomain(domain: string): Promise<void>;
}

export interface VaultRef {
  /** A stable id for the vault (its folder's id in the app). */
  id: string;
  /** Its name as the deep link names it (`vault=`). */
  name: string;
  encrypted?: boolean;
}

export const EXCERPT_CHARS = 300;
const BATCH = 200;

/** FNV-1a, base 36: a short stable hash (not a secret). */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The deep link's percent-encoding (deeplink.rs `encode`): unreserved characters and `/` stay. */
export function encodeLinkPart(s: string): string {
  let out = "";
  for (const b of new TextEncoder().encode(s)) {
    const c = String.fromCharCode(b);
    out += /[A-Za-z0-9\-_.~/]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export function openLink(path: string, vault: string): string {
  return `lumen://open?path=${encodeLinkPart(path)}&vault=${encodeLinkPart(vault)}`;
}

export const domainOf = (vault: VaultRef) => `app.lumen.editor.vault.${fnv(vault.id)}`;

function frontmatter(text: string): { body: string; props: Record<string, string>; tags: string[] } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { body: text, props: {}, tags: [] };
  const props: Record<string, string> = {};
  const tags: string[] = [];
  let inTags = false;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\p{L}\p{N}_-]+)\s*:\s*(.*)$/u.exec(line);
    if (kv) {
      props[kv[1].toLowerCase()] = kv[2].trim();
      inTags = kv[1].toLowerCase() === "tags" && !kv[2].trim();
      if (kv[1].toLowerCase() === "tags" && kv[2].trim()) tags.push(...kv[2].replace(/^\[|\]$/g, "").split(/[,\s]+/).map((t) => t.replace(/^["'#]+|["']+$/g, "")).filter(Boolean));
    } else if (inTags) {
      const item = /^\s+-\s*(.+)$/.exec(line);
      if (item) tags.push(item[1].replace(/^["'#]+|["']+$/g, "").trim());
    }
  }
  return { body: text.slice(m[0].length), props, tags };
}

/** Plain text for the excerpt: no code, no markup, links as their text. */
export function plainExcerpt(body: string, max = EXCERPT_CHARS): string {
  const t = body
    .replace(/^ {0,3}(```|~~~)[\s\S]*?^ {0,3}\1[^\n]*$/gm, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => b ?? a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^ {0,3}#{1,6}\s+/gm, "")
    .replace(/^ {0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/[*_~=]{1,3}([^*_~=\n]+)[*_~=]{1,3}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...t];
  return chars.length <= max ? t : chars.slice(0, max - 1).join("").replace(/\s+\S*$/, "") + "…";
}

/** Why a note stays out of the system index, or null when it may go in. */
export function exclusion(path: string, text: string, vault: VaultRef): string | null {
  if (vault.encrypted) return "encrypted vault";
  if (path.split("/").some((p) => p.startsWith("."))) return "hidden folder";
  if (!/\.(md|markdown|txt)$/i.test(path)) return "not a note";
  if (isSealedNote(text)) return "locked note";
  if (/^(age-encryption\.org\/v1|-----BEGIN AGE ENCRYPTED FILE-----)/.test(text)) return "encrypted file";
  const { props } = frontmatter(text);
  if (/^(true|yes)$/i.test(props.private ?? "") || /^(false|no)$/i.test(props.searchable ?? "")) return "marked private";
  return null;
}

/** The system index id of a note (vault and path). */
export const idFor = (path: string, vault: VaultRef) => `${domainOf(vault)}.${fnv(path)}${fnv(path.split("").reverse().join(""))}`;

/** The item for a note, or null when it is excluded. */
export function itemFor(path: string, text: string, vault: VaultRef): OsSearchItem | null {
  if (exclusion(path, text, vault)) return null;
  const { body, props, tags } = frontmatter(text);
  const h1 = /^ {0,3}#\s+(.+?)\s*#*\s*$/m.exec(body)?.[1];
  const title = (props.title?.replace(/^["']|["']$/g, "") || h1 || (path.split("/").pop() ?? path).replace(/\.(md|markdown|txt)$/i, "")).trim();
  const inline = [...plainExcerpt(body, 100_000).matchAll(/(?:^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu)].map((m) => m[1]);
  const keywords = [...new Set([...tags, ...inline])].slice(0, 20);
  return { id: idFor(path, vault), domain: domainOf(vault), title, excerpt: plainExcerpt(body), keywords, url: openLink(path, vault.name) };
}

/** What was sent, per vault: item id → hash of what was sent. Kept by the caller (settings storage). */
export type Manifest = Record<string, string>;

const hashItem = (i: OsSearchItem) => fnv(JSON.stringify([i.title, i.excerpt, i.keywords, i.url]));

export interface Notes {
  paths(): Promise<string[]>;
  read(path: string): Promise<string | null>;
}

export class OsSearchIndexer {
  private manifest: Manifest;
  private byPath = new Map<string, string>();

  constructor(
    private readonly bridge: OsSearchBridge,
    readonly vault: VaultRef,
    private readonly store: { load(): Manifest | null; save(m: Manifest | null): void; enabled(): boolean; setEnabled(on: boolean): void },
  ) {
    this.manifest = store.load() ?? {};
  }

  get enabled(): boolean {
    return this.bridge.available && this.store.enabled();
  }

  /** The user said yes: index the whole vault. Returns how many notes went in. */
  async enable(notes: Notes): Promise<number> {
    if (!this.bridge.available) throw new Error("System search is not available on this device.");
    if (this.vault.encrypted) throw new Error("An encrypted vault is never put in system search.");
    this.store.setEnabled(true);
    return this.sync(notes);
  }

  /** The user said no: delete the vault's whole domain from the system index, and forget it. */
  async disable(): Promise<void> {
    this.store.setEnabled(false);
    this.manifest = {};
    this.byPath.clear();
    this.store.save(null);
    await this.bridge.clearDomain(domainOf(this.vault));
  }

  /** Bring the system index up to date with the vault: send what changed, remove what is gone or now excluded. */
  async sync(notes: Notes): Promise<number> {
    if (!this.enabled) return 0;
    const fresh: OsSearchItem[] = [];
    const keep = new Set<string>();
    for (const p of await notes.paths()) {
      const text = await notes.read(p);
      const item = text === null ? null : itemFor(p, text, this.vault);
      if (!item) continue;
      keep.add(item.id);
      this.byPath.set(p, item.id);
      const h = hashItem(item);
      if (this.manifest[item.id] !== h) {
        fresh.push(item);
        this.manifest[item.id] = h;
      }
    }
    const gone = Object.keys(this.manifest).filter((id) => !keep.has(id));
    for (const id of gone) delete this.manifest[id];
    for (let i = 0; i < fresh.length; i += BATCH) await this.bridge.index(fresh.slice(i, i + BATCH));
    if (gone.length) await this.bridge.remove(gone);
    this.store.save(this.manifest);
    return keep.size;
  }

  /** One note changed (or was created). */
  async noteChanged(path: string, text: string): Promise<void> {
    if (!this.enabled) return;
    const item = itemFor(path, text, this.vault);
    const old = this.byPath.get(path);
    if (!item) {
      if (old && old in this.manifest) {
        delete this.manifest[old];
        this.byPath.delete(path);
        await this.bridge.remove([old]);
        this.store.save(this.manifest);
      }
      return;
    }
    this.byPath.set(path, item.id);
    const h = hashItem(item);
    if (this.manifest[item.id] === h) return;
    this.manifest[item.id] = h;
    await this.bridge.index([item]);
    this.store.save(this.manifest);
  }

  async noteDeleted(path: string): Promise<void> {
    if (!this.enabled) return;
    const id = this.byPath.get(path) ?? idFor(path, this.vault);
    this.byPath.delete(path);
    if (!id || !(id in this.manifest)) return;
    delete this.manifest[id];
    await this.bridge.remove([id]);
    this.store.save(this.manifest);
  }

  async noteRenamed(from: string, to: string, text: string): Promise<void> {
    await this.noteDeleted(from);
    await this.noteChanged(to, text);
  }
}
