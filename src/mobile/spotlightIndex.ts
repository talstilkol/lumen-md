/**
 * Notes in Spotlight and Siri (plan W13.M3), the WebView's half. The person
 * chooses what the system may know (Settings → Spotlight, `lumen-spotlight`):
 *
 *   - "off" (the default): nothing is indexed, and whatever was is removed;
 *   - "recent": the 50 notes opened or changed last;
 *   - "all": every note, up to 5,000.
 *
 * Never indexed: a note locked with its own password (sealed on disk, or
 * open and unlocked right now), and a note whose front matter says
 * `spotlight: false` or `private: true`. What is indexed is the path, the
 * title and a 160-character plain-text snippet — enough to find and open it.
 *
 * iOS: NoteEntity (App Intents, IndexedEntity) in CSSearchableIndex; opening
 * one from Spotlight or Siri sends lumen://open?path=… back here. Android:
 * the 4 most recent notes as dynamic App Shortcuts. Each sync sends only what
 * changed since the last one (by path and modification time).
 */
import { LOCKED_NOTE_MAGIC } from "../storage/lockedNotesRegistry";

export type SpotlightMode = "off" | "recent" | "all";
export const SPOTLIGHT_KEY = "lumen-spotlight";
export const LIMITS = { recent: 50, all: 5000, shortcuts: 4, snippet: 160 } as const;

export interface NoteFile {
  path: string;
  modified: number;
  /** The file's text as stored (a locked note is sealed). */
  text: string;
}

export interface SpotlightEntry {
  path: string;
  title: string;
  snippet: string;
  modified: number;
}

export interface SpotlightPlugin {
  /** Add or replace these entries; remove these paths. */
  updateSpotlight(o: { upsert: SpotlightEntry[]; remove: string[]; reset?: boolean }): Promise<void>;
  /** Android: the dynamic App Shortcuts for the most recent notes. */
  setRecentNotes?(o: { notes: Array<{ path: string; title: string }> }): Promise<void>;
}

export function spotlightMode(storage: Pick<Storage, "getItem"> | null): SpotlightMode {
  try {
    const v = storage?.getItem(SPOTLIGHT_KEY);
    return v === "recent" || v === "all" ? v : "off";
  } catch {
    // why: storage blocked: nothing is indexed (the private choice)
    return "off";
  }
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Must this note stay out of the index? */
export function excluded(text: string, path: string, isOpenLocked: (path: string) => boolean = () => false): boolean {
  if (text.startsWith(LOCKED_NOTE_MAGIC) || isOpenLocked(path)) return true;
  const fm = FRONT.exec(text)?.[1] ?? "";
  return /^(?:spotlight:\s*(?:false|no|off)|private:\s*(?:true|yes))\s*$/im.test(fm);
}

/** The title: front matter `title:`, else the first heading, else the file name. */
export function noteTitle(text: string, path: string): string {
  const fm = FRONT.exec(text)?.[1] ?? "";
  const t = /^title:\s*["']?(.+?)["']?\s*$/im.exec(fm)?.[1];
  if (t) return t.slice(0, 200);
  const body = text.replace(FRONT, "");
  const h = /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(body)?.[1];
  if (h) return h.slice(0, 200);
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

/** A plain-text snippet: no front matter, headings, links' targets, code fences or markup. */
export function noteSnippet(text: string, max: number = LIMITS.snippet): string {
  const plain = text
    .replace(FRONT, "")
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, a: string, b: string) => b || a)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~`>#|]+/g, " ")
    .replace(/^\s*[-+]\s+\[[ xX]\]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}

/** The entries for this mode, newest first. */
export function spotlightEntries(files: NoteFile[], mode: SpotlightMode, isOpenLocked?: (path: string) => boolean): SpotlightEntry[] {
  if (mode === "off") return [];
  const limit = mode === "recent" ? LIMITS.recent : LIMITS.all;
  return files
    .filter((f) => /\.md$/i.test(f.path) && !f.path.split("/").some((s) => s.startsWith(".")))
    .sort((a, b) => b.modified - a.modified)
    .filter((f) => !excluded(f.text, f.path, isOpenLocked))
    .slice(0, limit)
    .map((f) => ({ path: f.path, title: noteTitle(f.text, f.path), snippet: noteSnippet(f.text), modified: f.modified }));
}

/** What changed since the last sync (`last`: path → modified). */
export function spotlightDiff(next: SpotlightEntry[], last: Map<string, number>): { upsert: SpotlightEntry[]; remove: string[] } {
  const keep = new Set(next.map((e) => e.path));
  return {
    upsert: next.filter((e) => last.get(e.path) !== e.modified),
    remove: [...last.keys()].filter((p) => !keep.has(p)),
  };
}

const STATE_KEY = "lumen-spotlight-indexed";

function readState(storage: Pick<Storage, "getItem"> | null): Map<string, number> {
  try {
    const raw = JSON.parse(storage?.getItem(STATE_KEY) ?? "[]") as Array<[string, number]>;
    return new Map(Array.isArray(raw) ? raw.filter((x) => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "number") : []);
  } catch {
    return new Map();
  }
}

/**
 * One sync: compute the entries, send the difference, remember what is now
 * indexed. `read` gives the files (path, mtime, text) — only those whose
 * mtime changed are read again by the caller's cache.
 */
export async function syncSpotlight(plugin: SpotlightPlugin, files: NoteFile[], deps: { storage?: Pick<Storage, "getItem" | "setItem"> | null; isOpenLocked?: (p: string) => boolean } = {}): Promise<{ upserted: number; removed: number }> {
  const storage = deps.storage === undefined ? (typeof localStorage === "undefined" ? null : localStorage) : deps.storage;
  const mode = spotlightMode(storage);
  const entries = spotlightEntries(files, mode, deps.isOpenLocked);
  const last = readState(storage);
  const { upsert, remove } = spotlightDiff(entries, last);
  if (mode === "off" && last.size === 0) return { upserted: 0, removed: 0 };
  if (upsert.length || remove.length || mode === "off") await plugin.updateSpotlight({ upsert, remove, reset: mode === "off" });
  if (plugin.setRecentNotes) await plugin.setRecentNotes({ notes: entries.slice(0, LIMITS.shortcuts).map((e) => ({ path: e.path, title: e.title })) }).catch(() => undefined);
  try {
    storage?.setItem(STATE_KEY, JSON.stringify(entries.map((e) => [e.path, e.modified])));
  } catch {
    // why: storage full: the next sync sends everything again, which is only slower
  }
  return { upserted: upsert.length, removed: remove.length };
}

/** Reads the vault with a cache by mtime, so a sync over 10,000 notes reads only what changed. */
export function cachedReader(list: () => Promise<Array<{ path: string; modified: number }>>, read: (path: string) => Promise<string>) {
  const cache = new Map<string, { modified: number; text: string }>();
  return async (): Promise<NoteFile[]> => {
    const out: NoteFile[] = [];
    const seen = new Set<string>();
    for (const e of await list()) {
      if (!/\.md$/i.test(e.path)) continue;
      seen.add(e.path);
      let c = cache.get(e.path);
      if (!c || c.modified !== e.modified) {
        try {
          c = { modified: e.modified, text: (await read(e.path)).slice(0, 4096) };
        } catch {
          continue;
        }
        cache.set(e.path, c);
      }
      out.push({ path: e.path, modified: e.modified, text: c.text });
    }
    for (const p of [...cache.keys()]) if (!seen.has(p)) cache.delete(p);
    return out;
  };
}

/** Keep the index in step with the vault, in the app only. Returns a stop function. */
export async function startSpotlightSync(plugin: SpotlightPlugin): Promise<() => void> {
  const [{ listWorkspace, readWorkspaceFile }, ev, { lockedNotes }] = await Promise.all([import("../storage/workspace"), import("../storage/workspaceEvents"), import("../storage/lockedNotesRegistry")]);
  const files = cachedReader(() => listWorkspace(), (p) => readWorkspaceFile(p) as Promise<string>);
  let running: Promise<unknown> = Promise.resolve();
  const run = () => (running = running.then(async () => syncSpotlight(plugin, await files(), { isOpenLocked: (p) => lockedNotes.has(p) })).catch(() => undefined));
  run();
  const off = ev.onWorkspaceChanged(run, { debounceMs: 5000 });
  const onChoice = () => run();
  window.addEventListener("lumen-spotlight-changed", onChoice);
  return () => {
    off();
    window.removeEventListener("lumen-spotlight-changed", onChoice);
  };
}
