/**
 * Reading progress from the PDF and EPUB readers into the source note that
 * names the file (plan W12.X2). The readers already remember where the
 * user is (W6.47 `readingPosition.ts`, the EPUB reader's chapter); this
 * writes the same place into the source's frontmatter, so the reading list
 * moves by itself.
 *
 * Only frontmatter keys change (`page`, `pages`, `progress`, `status`,
 * `finished`), through the property editor's writer, which keeps the rest of
 * the frontmatter and the body as they are.
 */
import { parseProperties, setProperty } from "../properties/frontmatter";
import { SOURCE_TYPE_ID, type ReadingStatus } from "./sourceType";

export interface ReaderPlace {
  /** 1-based page (PDF) or chapter (EPUB). */
  page: number;
  /** The document's pages (PDF) or chapters (EPUB). */
  pages: number;
}

/** Percent read at `place`, 0–100, whole numbers. */
export function percentRead(place: ReaderPlace): number {
  if (!(place.pages > 0) || !(place.page >= 1)) return 0;
  return Math.min(100, Math.max(0, Math.round((Math.min(place.page, place.pages) / place.pages) * 100)));
}

/** The frontmatter as a plain map ({} when there is none or it is invalid). */
export function frontmatterOf(text: string): Record<string, unknown> {
  const p = parseProperties(text);
  return Object.fromEntries(p.properties.map((x) => [x.key, x.value]));
}

/** Is this note a source? (`type: source`, a list holding it, or the #source tag.) */
export function isSourceNote(fm: Record<string, unknown>): boolean {
  const types = Array.isArray(fm.type) ? fm.type : [fm.type];
  if (types.some((t) => typeof t === "string" && t.trim().toLowerCase() === SOURCE_TYPE_ID)) return true;
  const tags = Array.isArray(fm.tags) ? fm.tags : typeof fm.tags === "string" ? fm.tags.split(/[,\s]+/) : [];
  return tags.some((t) => typeof t === "string" && /^#?source(\/|$)/i.test(t.trim()));
}

/** The vault path a `file:` value names: `[[a/b.pdf]]`, `[[a/b.pdf|alias]]`, `![[…]]`, `a/b.pdf` or a Markdown link. */
export function linkedPath(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  const wiki = /^!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(s);
  if (wiki) return wiki[1].trim();
  const md = /^\[[^\]]*\]\(([^)]+)\)$/.exec(s);
  const raw = md ? md[1] : s;
  try {
    return decodeURIComponent(raw.replace(/^<|>$/g, ""));
  } catch {
    return raw;
  }
}

/** Does the note's `file:` name `docPath`? A bare file name matches a path that ends with it (Obsidian's shortest links). */
export function namesDocument(fm: Record<string, unknown>, docPath: string): boolean {
  const p = linkedPath(fm.file);
  if (!p) return false;
  const a = p.replace(/^\.?\//, "");
  const b = docPath.replace(/^\.?\//, "");
  return a === b || (!a.includes("/") && b.split("/").pop() === a);
}

/** The frontmatter values the reader's place gives, or null when nothing would change. */
export function progressValues(fm: Record<string, unknown>, place: ReaderPlace, today: string): Record<string, string | number> | null {
  const progress = percentRead(place);
  const status = (typeof fm.status === "string" ? fm.status : "to-read") as ReadingStatus | string;
  const next: Record<string, string | number> = { page: Math.min(place.page, place.pages), pages: place.pages, progress };
  // to-read → reading on the first page turned; reading → done at the last page.
  // A source the user marked done stays done when they open it again.
  if (progress >= 100) {
    if (status !== "done") {
      next.status = "done";
      if (!fm.finished) next.finished = today;
    }
  } else if (status === "to-read" && place.page > 1) next.status = "reading";
  const changed = Object.entries(next).some(([k, v]) => fm[k] !== v);
  return changed ? next : null;
}

/** `text` with the reader's place written into its frontmatter (unchanged text when nothing changes). */
export function applyProgress(text: string, place: ReaderPlace, today: string): string {
  const fm = frontmatterOf(text);
  const values = progressValues(fm, place, today);
  if (!values) return text;
  let out = text;
  for (const [k, v] of Object.entries(values)) out = setProperty(out, k, v);
  return out;
}

export interface ProgressIO {
  /** Markdown files of the vault (paths). */
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
}

/**
 * The reader is at `place` in `docPath`: update every source note whose
 * `file:` names it. Returns the notes it wrote. A note that cannot be read or
 * whose frontmatter is invalid is skipped, never rewritten. `candidates`
 * limits the notes looked at (the readers pass the ones found last time).
 */
export async function recordReaderProgress(io: ProgressIO, docPath: string, place: ReaderPlace, now = new Date(), candidates?: readonly string[]): Promise<string[]> {
  const today = now.toISOString().slice(0, 10);
  const wrote: string[] = [];
  for (const path of candidates ?? (await io.list())) {
    if (!/\.md$/i.test(path)) continue;
    let text: string;
    try {
      text = await io.read(path);
    } catch {
      continue;
    }
    if (!text.startsWith("---")) continue;
    const fm = frontmatterOf(text);
    if (!isSourceNote(fm) || !namesDocument(fm, docPath)) continue;
    let next: string;
    try {
      next = applyProgress(text, place, today);
    } catch {
      continue; // invalid frontmatter: leave the note alone
    }
    if (next !== text) {
      await io.write(path, next);
      wrote.push(path);
    }
  }
  return wrote;
}

/** The source notes whose `file:` names `docPath`. */
export async function sourcesNaming(io: ProgressIO, docPath: string): Promise<string[]> {
  const out: string[] = [];
  for (const path of await io.list()) {
    if (!/\.md$/i.test(path)) continue;
    const text = await io.read(path).catch(() => "");
    if (!text.startsWith("---")) continue;
    const fm = frontmatterOf(text);
    if (isSourceNote(fm) && namesDocument(fm, docPath)) out.push(path);
  }
  return out;
}

/** The app's vault as ProgressIO (OPFS / the open folder). */
export async function vaultProgressIO(): Promise<ProgressIO> {
  const ws = await import("../storage/workspace");
  return {
    list: async () => (await ws.listWorkspace()).map((e) => e.path),
    read: (p) => ws.readWorkspaceFile(p),
    write: (p, t) => ws.writeWorkspaceFile(p, t),
  };
}

// The readers save a place every time scrolling stops; the vault is scanned
// for the document's source notes once per document and session, then only
// those notes are read.
const found = new Map<string, Promise<string[]>>();

/** For the readers: record the place in the vault, quietly (a failure never reaches the reader). */
export function noteReaderProgress(docPath: string, place: ReaderPlace): void {
  void vaultProgressIO()
    .then(async (io) => {
      let notes = found.get(docPath);
      if (!notes) {
        notes = sourcesNaming(io, docPath);
        found.set(docPath, notes);
      }
      return recordReaderProgress(io, docPath, place, new Date(), await notes);
    })
    .catch(() => found.delete(docPath));
}
