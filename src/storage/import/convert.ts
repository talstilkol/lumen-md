/**
 * From the files a person picked to a converted vault: archives opened
 * (nested ones too — Notion zips its parts), paths cleaned, the source
 * detected, its converter run. No writes: the vault is untouched until the
 * wizard commits (./commit.ts).
 */
import { unzip } from "../zip";
import { convertBear } from "./bear";
import { convertEvernote } from "./evernote";
import { convertHtmlNotes } from "./htmlNotes";
import { convertKeep } from "./keep";
import { convertLogseq } from "./logseq";
import { convertNotion, looksLikeNotion } from "./notion";
import { convertRoam, looksLikeRoam } from "./roam";
import { convertCraft } from "./craft";
import { convertTextBundle } from "./textbundle";
import { convertDayOne, looksLikeDayOne } from "./dayOne";
import { convertAppleJournal } from "./appleJournal";
import { convertSamsungNotes } from "./samsungNotes";
import { convertAirtable, looksLikeAirtable } from "./airtable";
import { convertTomboy } from "./tomboy";
import { claimPath } from "./names";
import { emptyVault, type ConvertedVault, type ImportSourceId } from "./types";

/** Every source the wizard offers, in the order it shows them. */
export const IMPORT_SOURCES: readonly ImportSourceId[] = ["obsidian", "notion", "evernote", "bear", "appleNotes", "keep", "logseq", "onenote", "roam", "craft", "textbundle", "dayOne", "appleJournal", "samsungNotes", "airtable", "tomboy", "lumen"];

/** Brand names stay as they are in every language. */
export const SOURCE_NAMES: Record<ImportSourceId, string> = {
  obsidian: "Obsidian",
  notion: "Notion",
  evernote: "Evernote",
  bear: "Bear",
  appleNotes: "Apple Notes",
  keep: "Google Keep",
  logseq: "Logseq",
  onenote: "OneNote",
  roam: "Roam Research",
  craft: "Craft",
  textbundle: "TextBundle",
  dayOne: "Day One",
  appleJournal: "Apple Journal",
  samsungNotes: "Samsung Notes",
  airtable: "Airtable",
  tomboy: "Tomboy / Gnote",
  lumen: "Lumen",
};

/** What the file picker of each source accepts (a folder picker is offered next to it). */
export const SOURCE_ACCEPT: Record<ImportSourceId, string> = {
  obsidian: ".zip",
  notion: ".zip",
  evernote: ".enex",
  bear: ".bearbk,.zip,.textbundle",
  appleNotes: ".sqlite,.zip,.html,.htm,.txt,.md",
  keep: ".zip,.json",
  logseq: ".zip",
  onenote: ".mht,.mhtml,.zip",
  roam: ".json,.zip",
  craft: ".zip,.md,.textbundle,.textpack",
  textbundle: ".textbundle,.textpack,.zip",
  dayOne: ".zip,.json",
  appleJournal: ".zip,.html,.htm",
  samsungNotes: ".txt,.pdf,.zip,.sdocx",
  airtable: ".csv,.json,.zip",
  tomboy: ".note,.zip",
  lumen: ".zip",
};

const ARCHIVE = /\.(zip|bearbk|textpack)$/i;

/** `a\b/../c` → `a/c`; `..` never climbs above the export. Null for a name with nothing left. */
export function cleanArchivePath(p: string): string | null {
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg.normalize("NFC"));
  }
  return out.length ? out.join("/") : null;
}

/** Open archives inside `files` (up to 3 levels: Notion's `Export.zip` holds `Part-1.zip`). */
export async function expandArchives(files: Map<string, Uint8Array>, depth = 0): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const [p, data] of files) {
    const clean = cleanArchivePath(p);
    if (!clean) continue;
    if (ARCHIVE.test(clean) && depth < 3) {
      let inner: Map<string, Uint8Array>;
      try {
        inner = await unzip(data.slice().buffer);
      } catch {
        out.set(clean, data);
        continue;
      }
      // A .bearbk / a single top-level archive opens in place; a nested one in its own folder.
      // A .textpack is one bundle already named after it: it opens in its own folder's place.
      const prefix = depth === 0 && files.size === 1 ? "" : /\.textpack$/i.test(clean) ? (clean.includes("/") ? clean.slice(0, clean.lastIndexOf("/") + 1) : "") : clean.replace(ARCHIVE, "") + "/";
      const opened = await expandArchives(new Map([...inner].map(([k, v]) => [prefix + k, v])), depth + 1);
      for (const [k, v] of opened) out.set(k, v);
    } else out.set(clean, data);
  }
  return out;
}

/**
 * The archive's own top folder ("MyVault/…", "Export-…/…"): the first
 * segment, when every path shares it — and only that one. A Bear
 * `Note.textbundle/` is a note, never a wrapper.
 */
export function stripWrapper(files: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const paths = [...files.keys()].filter((p) => !/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(p));
  const first = paths[0]?.split("/") ?? [];
  if (first.length < 2) return files;
  const top = `${first[0]}/`;
  if (/\.textbundle\/$/i.test(top) || !paths.every((p) => p.startsWith(top))) return files;
  return new Map([...files].filter(([p]) => p.startsWith(top)).map(([p, v]) => [p.slice(top.length), v]));
}

/** The first bytes of a file as text (enough to tell one JSON or Markdown dialect from another). */
function head(files: Map<string, Uint8Array> | undefined, p: string, n = 4096): string {
  const data = files?.get(p);
  return data ? new TextDecoder().decode(data.subarray(0, n)) : "";
}

/** Is this the JSON of a Roam export (an array of pages)? Read whole only when it starts like one. */
function isRoamJson(files: Map<string, Uint8Array> | undefined, p: string): boolean {
  if (!/^\s*\[\s*\{[\s\S]*"title"/.test(head(files, p, 2048))) return false;
  try {
    return looksLikeRoam(JSON.parse(new TextDecoder().decode(files!.get(p))));
  } catch {
    return false;
  }
}

/**
 * Which tool wrote this export (the wizard preselects it; the person can
 * change it). With `files`, the contents are sniffed too: a Roam JSON, a
 * Craft document, a TextBundle's creator.
 */
export function detectImportSource(paths: string[], files?: Map<string, Uint8Array>): ImportSourceId {
  if (paths.some((p) => /(^|\/)NoteStore\.sqlite$/i.test(p))) return "appleNotes"; // the Notes database (W10.E48)
  if (paths.some((p) => /(^|\/)\.obsidian\//.test(p))) return "obsidian";
  if (paths.some((p) => /(^|\/)logseq\/config\.edn$/.test(p))) return "logseq";
  if (paths.some((p) => /\.enex$/i.test(p))) return "evernote";
  if (paths.some((p) => /\.textbundle\//i.test(p))) {
    const infos = paths.filter((p) => /\.textbundle\/info\.json$/i.test(p)).map((p) => head(files, p));
    if (infos.some((j) => /shinyfrog/i.test(j))) return "bear";
    if (infos.some((j) => /craft|lukilabs/i.test(j)) || paths.some((p) => /\.textbundle\/text\.(md|markdown)$/i.test(p) && head(files, p, 1 << 16).includes("craftdocs://"))) return "craft";
    return files ? "textbundle" : "bear";
  }
  if (paths.some((p) => /\.note$/i.test(p)) && paths.filter((p) => /\.note$/i.test(p)).some((p) => /beatniksoftware\.com\/tomboy|<note-content/.test(head(files, p, 1024)) || !files)) return "tomboy";
  if (paths.some((p) => /(^|\/)Entries\/[^/]+\.html?$/i.test(p)) && paths.some((p) => /(^|\/)Resources\//.test(p) || /pageHeader/.test(head(files, p, 1 << 14)))) return "appleJournal";
  if (paths.some((p) => /\.sdocx?$/i.test(p))) return "samsungNotes";
  const json = paths.filter((p) => /\.json$/i.test(p));
  if (files && json.length && json.length <= 20) {
    const whole = (p: string) => {
      try {
        return JSON.parse(new TextDecoder().decode(files.get(p))) as unknown;
      } catch {
        return null;
      }
    };
    const small = json.filter((p) => (files.get(p)?.byteLength ?? 0) < 64 << 20);
    if (small.some((p) => /"entries"\s*:/.test(head(files, p, 1 << 16)) && looksLikeDayOne(whole(p)))) return "dayOne";
    if (small.some((p) => /"schema"\s*:/.test(head(files, p, 1 << 16)) && looksLikeAirtable(whole(p)))) return "airtable";
  }
  if (paths.length && paths.every((p) => /\.csv$/i.test(p))) return "airtable";
  if (files && json.length && json.length <= 4 && !paths.some((p) => /(^|\/)Keep\//.test(p)) && json.some((p) => isRoamJson(files, p))) return "roam";
  if (files && paths.some((p) => /\.md$/i.test(p) && head(files, p, 1 << 16).includes("craftdocs://open?"))) return "craft";
  if (paths.some((p) => /\.(mht|mhtml)$/i.test(p))) return "onenote";
  if (paths.some((p) => /(^|\/)Keep\/[^/]+\.json$/.test(p))) return "keep";
  if (looksLikeNotion(paths)) return "notion";
  if (paths.some((p) => /\.html?$/i.test(p)) && !paths.some((p) => /\.md$/i.test(p))) return "appleNotes";
  return "lumen";
}

/** The picked files as the converters see them: archives opened, the wrapper folder gone, macOS junk set aside. */
export async function openExport(picked: Map<string, Uint8Array>): Promise<{ opened: Map<string, Uint8Array>; junk: string[] }> {
  const opened = stripWrapper(await expandArchives(picked));
  const junk = [...opened.keys()].filter((p) => /(^|\/)__MACOSX(\/|$)|(^|\/)\.DS_Store$/.test(p));
  for (const p of junk) opened.delete(p);
  return { opened, junk };
}

const APP = /(^|\/)(\.obsidian|\.trash|\.git|\.lumen|__MACOSX)(\/|$)|(^|\/)\.DS_Store$/;

/** Obsidian and Lumen vaults are Markdown already: kept as they are, app folders left out. */
function convertVault(files: Map<string, Uint8Array>): ConvertedVault {
  const vault = emptyVault();
  const taken = new Set<string>();
  const dec = new TextDecoder();
  for (const [p, data] of files) {
    if (APP.test(p)) {
      vault.skipped.push({ path: p, reason: p.includes(".trash") ? "trashed" : "appFolder" });
      continue;
    }
    const target = claimPath(taken, p);
    if (/\.(md|markdown|base|canvas)$/i.test(p)) vault.notes.set(target, dec.decode(data));
    else {
      vault.sourceAttachments++;
      vault.attachments.set(target, data);
    }
  }
  return vault;
}

/** Run `source`'s converter. `folder` is the vault folder the import will go into. */
export function convertExport(source: ImportSourceId, files: Map<string, Uint8Array>, folder: string, opts: { notionTypes?: boolean; existingTypeIds?: Iterable<string> } = {}): ConvertedVault {
  // Keep's Takeout puts the notes under Takeout/Keep/: that folder is the export.
  if (source === "keep") {
    const keep = [...files.keys()].find((p) => /(^|\/)Keep\/[^/]+\.json$/.test(p));
    if (keep) {
      const root = keep.slice(0, keep.lastIndexOf("/") + 1);
      const outside = [...files.keys()].filter((p) => !p.startsWith(root));
      const v = convertKeep(new Map([...files].filter(([p]) => p.startsWith(root)).map(([p, d]) => [p.slice(root.length), d])));
      // The report names files as they are in the export.
      v.skipped = v.skipped.map((i) => ({ ...i, path: root + i.path }));
      for (const p of outside) v.skipped.push({ path: p, reason: "unsupported" });
      return v;
    }
    return convertKeep(files);
  }
  switch (source) {
    case "notion":
      return convertNotion(files, { folder, types: opts.notionTypes, existingTypeIds: opts.existingTypeIds });
    case "evernote":
      return convertEvernote(files);
    case "bear":
      return convertBear(files);
    case "logseq":
      return convertLogseq(files);
    case "roam":
      return convertRoam(files);
    case "craft":
      return convertCraft(files);
    case "textbundle":
      return convertTextBundle(files);
    case "dayOne":
      return convertDayOne(files);
    case "appleJournal":
      return convertAppleJournal(files);
    case "samsungNotes":
      return convertSamsungNotes(files);
    case "airtable":
      return convertAirtable(files, { folder });
    case "tomboy":
      return convertTomboy(files);
    case "appleNotes":
    case "onenote":
      return convertHtmlNotes(files, source);
    default:
      return convertVault(files);
  }
}
