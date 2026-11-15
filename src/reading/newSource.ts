/**
 * Making a source note (plan W12.X2) and saving it in the vault: from an
 * item of the citation library (Zotero's copy, BibTeX, CSL-JSON; W2.16,
 * W5.23) or from a page captured with the web clipper (4.15). The palette
 * commands (commands/domains/readingActions.ts) ask which item or page;
 * this module does the rest, through the vault's own type registry, so a
 * vault's `.lumen/types/source.yaml` shapes the note.
 *
 * Nothing is fetched: the library is read on this device, and a captured
 * page is what the clipper already saved.
 */
import type { LibraryItem } from "../citations/library";
import type { TypeRegistry } from "../types/typeRegistry";
import { sourceNoteFromCapture, sourceNoteFromCitation, type CapturedPage, type NewSource } from "./sourceFrom";
import { frontmatterOf } from "./progress";

export const SOURCES_DIR = { en: "Sources", he: "מקורות" } as const;
export const sourcesDir = (lang: string): string => (lang === "he" ? SOURCES_DIR.he : SOURCES_DIR.en);

export type NewSourceResult =
  | { ok: true; path: string; text: string }
  /** `exists`: a source with this cite key (or URL) is already in the vault, at `path`. */
  | { ok: false; reason: "refused" }
  | { ok: false; reason: "exists"; path: string };

export interface SaveIO {
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
  has(path: string): Promise<boolean>;
  write(path: string, text: string): Promise<void>;
}

/** The vault, through storage/workspace (the real path in the app and in tests on a fake OPFS). */
export async function workspaceIO(): Promise<SaveIO> {
  const ws = await import("../storage/workspace");
  return {
    list: async () => (await ws.listWorkspace()).map((f) => f.path).filter((p) => /\.md$/i.test(p)),
    read: (p) => ws.readWorkspaceFile(p),
    has: (p) => ws.workspaceHasEntry(p),
    write: (p, text) => ws.writeWorkspaceFile(p, text).then(() => undefined),
  };
}

/** The first source note whose `field` is `value` (a cite key or a URL), or null. */
async function existingSource(io: SaveIO, field: "citekey" | "url", value: string): Promise<string | null> {
  for (const p of await io.list()) {
    const text = await io.read(p).catch(() => "");
    if (!text.startsWith("---")) continue;
    const fm = frontmatterOf(text);
    if (String(fm.type ?? "").toLowerCase() === "source" && String(fm[field] ?? "") === value) return p;
  }
  return null;
}

async function save(io: SaveIO, dir: string, made: NewSource): Promise<string> {
  const stem = made.name.replace(/\.md$/i, "");
  let path = `${dir}/${made.name}`;
  for (let i = 2; await io.has(path); i++) path = `${dir}/${stem} (${i}).md`;
  await io.write(path, made.text);
  return path;
}

/** A source for a library item, saved in `dir`, unless the vault already has one with its key. */
export async function saveSourceFromLibrary(reg: TypeRegistry, item: Pick<LibraryItem, "key" | "record">, dir: string, io: SaveIO): Promise<NewSourceResult> {
  const already = await existingSource(io, "citekey", item.key);
  if (already) return { ok: false, reason: "exists", path: already };
  const made = sourceNoteFromCitation(reg, item.key, item.record);
  if (!made) return { ok: false, reason: "refused" };
  return { ok: true, path: await save(io, dir, made), text: made.text };
}

/** A source for a captured page, saved in `dir`, unless the vault already has one with its URL. */
export async function saveSourceFromCapture(reg: TypeRegistry, page: CapturedPage, dir: string, io: SaveIO): Promise<NewSourceResult> {
  const made = sourceNoteFromCapture(reg, page);
  if (!made) return { ok: false, reason: "refused" };
  const url = String(frontmatterOf(made.text).url ?? page.url);
  const already = await existingSource(io, "url", url);
  if (already) return { ok: false, reason: "exists", path: already };
  return { ok: true, path: await save(io, dir, made), text: made.text };
}
