/**
 * Where a workspace note came from, for the prompt-injection guard (plan
 * 2.7; `untrusted.ts`). Kept tiny and free of imports: the git sync, the
 * archive import and workspace renames update it on the startup path.
 *
 * A note is outside content when:
 *  - it is in the clip library (`Library/`, `ספרייה/`);
 *  - its frontmatter has `source: https://…` (a clipped page) or
 *    `untrusted: true`;
 *  - it, or a folder above it, was recorded by `markUntrustedNote` (git
 *    clone / pull, archive import). Renames and moves carry the record
 *    along (`moveUntrustedNotes`), and a note moved out of the library
 *    keeps that provenance.
 */

/**
 * The clip library (`research/clipper.ts` LIBRARY_DIR), repeated here so
 * nothing on the startup path pulls the clipper's HTML converter; a unit
 * test keeps the two in step.
 */
export const isClipLibraryPath = (p: string) => p.startsWith("Library/") || p.startsWith("ספרייה/");

const REGISTRY_KEY = "lumen.agents.untrustedNotes";
const MAX_ENTRIES = 5000;

type Registry = Record<string, { reason: string; at: number }>;

function loadRegistry(): Registry {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as Registry) : {};
  } catch {
    return {};
  }
}

function saveRegistry(r: Registry): void {
  const keys = Object.keys(r);
  if (keys.length > MAX_ENTRIES) for (const k of keys.sort((a, b) => r[a].at - r[b].at).slice(0, keys.length - MAX_ENTRIES)) delete r[k];
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(r));
  } catch {
    /* storage full or blocked: the note just isn't remembered */
  }
}

/** Record that `path` (a file or a folder) was written from outside: an import, a git pull or clone. */
export function markUntrustedNote(path: string, reason: string): void {
  markUntrustedNotes([path], reason);
}

export function markUntrustedNotes(paths: string[], reason: string): void {
  if (!paths.length) return;
  const r = loadRegistry();
  const at = Date.now();
  for (const p of paths) r[p] = { reason, at };
  saveRegistry(r);
}

/** The user said a note is theirs now ("trust this note"). */
export function clearUntrustedNote(path: string): void {
  const r = loadRegistry();
  if (!(path in r)) return;
  delete r[path];
  saveRegistry(r);
}

/**
 * A file or folder moved from `from` to `to`: its records (and those of
 * everything inside a folder) move with it. Leaving the clip library
 * records the library origin, so a moved clip stays outside content.
 */
export function moveUntrustedNotes(from: string, to: string): void {
  const r = loadRegistry();
  let changed = false;
  // A record inherited from a folder above `from` (an imported vault, a
  // cloned repo) goes along when the move leaves that folder.
  const parts = from.split("/");
  for (let i = parts.length - 1; i > 0; i--) {
    const anc = parts.slice(0, i).join("/");
    const rec = r[anc];
    if (!rec) continue;
    if (to !== anc && !to.startsWith(`${anc}/`)) {
      r[to] = { reason: rec.reason, at: Date.now() };
      changed = true;
    }
    break;
  }
  for (const k of Object.keys(r)) {
    if (k === from || k.startsWith(`${from}/`)) {
      r[to + k.slice(from.length)] = r[k];
      delete r[k];
      changed = true;
    }
  }
  if (isClipLibraryPath(from) && !isClipLibraryPath(to)) {
    r[to] = { reason: `clipped page (moved from ${from})`, at: Date.now() };
    changed = true;
  } else if ((from === "Library" || from === "ספרייה") && !isClipLibraryPath(`${to}/`)) {
    r[to] = { reason: `clipped pages (moved from ${from})`, at: Date.now() };
    changed = true;
  }
  if (changed) saveRegistry(r);
}

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/;

/**
 * Why a note counts as outside content (empty: it doesn't). `content` is
 * optional; without it only the path and the records are checked.
 */
export function untrustedSourcesOfNote(path: string | null | undefined, content?: string | null): string[] {
  const out: string[] = [];
  if (path) {
    if (isClipLibraryPath(path)) out.push(`clipped page (${path})`);
    const r = loadRegistry();
    // The note itself, or a folder above it (a cloned repo, an imported folder, a moved library).
    const parts = path.split("/");
    for (let i = parts.length; i > 0; i--) {
      const rec = r[parts.slice(0, i).join("/")];
      if (rec) {
        out.push(`${rec.reason} (${path})`);
        break;
      }
    }
  }
  if (content) {
    const fm = FRONTMATTER.exec(content)?.[1];
    if (fm) {
      const src = /^source:\s*["']?(https?:\/\/[^\s"']+)/im.exec(fm)?.[1];
      if (src && !out.some((s) => s.startsWith("clipped page"))) out.push(`page from ${src}`);
      if (/^(?:lumen-)?untrusted:\s*(?:true|yes)\s*$/im.test(fm)) out.push(`marked untrusted${path ? ` (${path})` : ""}`);
    }
  }
  return out;
}
