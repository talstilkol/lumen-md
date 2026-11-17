/**
 * The Pandoc bridge (plan W13.F5): formats Lumen has no importer of its own
 * for — DocBook, MediaWiki, Jira, OPML, txt2tags, DokuWiki, Textile, man
 * pages and the rest of Pandoc's readers — converted to Markdown by the
 * `pandoc` the user installed, on the desktop. Lumen bundles no Pandoc
 * (GPL): the licence gate stays green.
 *
 * The Rust side (src-tauri/src/pandoc.rs) finds the binary and runs it with a
 * fixed argument list and `--sandbox` (no other file, no network); the page
 * names only the reader, which must be one Pandoc itself lists. Each run is
 * listed in the privacy ledger as a local process. Without Pandoc — in the
 * browser, or on a desktop where it is not installed or older than 2.15 —
 * the source is not offered at all.
 */
import { claimPath, safeName, stemOf } from "./names";
import { emptyVault, type ConvertedVault } from "./types";

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** File extension → Pandoc reader, for the formats Lumen does not import itself. */
export const PANDOC_READERS: Readonly<Record<string, string>> = {
  dbk: "docbook",
  docbook: "docbook",
  xml: "docbook",
  wiki: "mediawiki",
  mediawiki: "mediawiki",
  jira: "jira",
  opml: "opml",
  t2t: "t2t",
  dokuwiki: "dokuwiki",
  textile: "textile",
  creole: "creole",
  twiki: "twiki",
  tikiwiki: "tikiwiki",
  vimwiki: "vimwiki",
  muse: "muse",
  fb2: "fb2",
  man: "man",
  "1": "man",
  haddock: "haddock",
  pod: "pod",
};

export type PandocStatus = { kind: "web" } | { kind: "missing" } | { kind: "old"; version: string } | { kind: "ready"; version: string; readers: string[] };

const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriInvoke(): Promise<Invoke> {
  return (await import("@tauri-apps/api/core")).invoke as Invoke;
}

/** Is a Pandoc installed (and new enough)? In the browser: never. A desktop without the bridge's commands: missing. */
export async function pandocStatus(deps: { desktop?: boolean; invoke?: Invoke } = {}): Promise<PandocStatus> {
  if (!(deps.desktop ?? isTauri())) return { kind: "web" };
  try {
    const invoke = deps.invoke ?? (await tauriInvoke());
    const s = await invoke<{ version: string | null; readers: string[]; tooOld?: boolean }>("pandoc_status");
    if (!s.version) return { kind: "missing" };
    if (s.tooOld) return { kind: "old", version: s.version };
    return { kind: "ready", version: s.version, readers: s.readers };
  } catch {
    // No such command (an app built without the bridge) or no binary: the source stays hidden.
    return { kind: "missing" };
  }
}

/** The reader for a file, by its extension; `xml` only when it looks like DocBook. Null: not Pandoc's to read here. */
export function readerFor(path: string, head: string, readers: readonly string[]): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "";
  let r = PANDOC_READERS[ext] ?? null;
  if (ext === "xml" && !/<(article|book|chapter|section)\b[^>]*(docbook|version="5)|<!DOCTYPE (article|book)[^>]*DocBook/i.test(head)) r = null;
  return r && readers.includes(r) ? r : null;
}

/** Convert every file Pandoc can read into a note; the rest are reported. */
export async function convertWithPandoc(
  files: Map<string, Uint8Array>,
  deps: { invoke?: Invoke; status?: PandocStatus; record?: (name: string, reason: string, bytes: number) => void } = {},
): Promise<ConvertedVault> {
  const vault = emptyVault();
  const status = deps.status ?? (await pandocStatus({ invoke: deps.invoke, desktop: deps.invoke ? true : undefined }));
  if (status.kind !== "ready") {
    for (const p of files.keys()) vault.skipped.push({ path: p, reason: "unsupported", detail: "Pandoc" });
    return vault;
  }
  const invoke = deps.invoke ?? (await tauriInvoke());
  const record = deps.record ?? ((name: string, reason: string, bytes: number) => void import("../../ai/privacyLedger").then((m) => m.recordLocalProcess(name, reason, bytes)));
  const taken = new Set<string>();
  const dec = new TextDecoder();
  for (const [p, data] of files) {
    if (/(^|\/)\.DS_Store$/.test(p)) {
      vault.skipped.push({ path: p, reason: "appFolder" });
      continue;
    }
    const reader = readerFor(p, dec.decode(data.subarray(0, 2048)), status.readers);
    if (!reader) {
      vault.skipped.push({ path: p, reason: "unsupported" });
      continue;
    }
    record("pandoc", `Pandoc ${status.version.replace(/^pandoc(\.exe)?\s*/i, "")} (installed by you): ${reader} → Markdown, sandboxed, no network`, data.byteLength);
    try {
      const md = await invoke<string>("pandoc_convert", { format: reader, ext: /\.([a-z0-9]+)$/i.exec(p)?.[1] ?? "txt", data: Array.from(data) });
      const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "";
      const path = claimPath(taken, `${dir.split("/").filter(Boolean).map((s) => safeName(s, "folder")).join("/")}${dir ? "/" : ""}${safeName(stemOf(p))}.md`);
      if (!md.trim()) vault.skipped.push({ path: p, reason: "empty" });
      else {
        vault.notes.set(path, md.endsWith("\n") ? md : `${md}\n`);
        vault.warnings.push({ path, reason: "noDates" });
      }
    } catch (e) {
      const msg = typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
      vault.skipped.push({ path: p, reason: "unreadable", detail: msg.slice(0, 200) });
    }
  }
  return vault;
}
