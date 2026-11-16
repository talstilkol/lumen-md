/**
 * Apple Notes, read from its own database (plan W10.E48, W1.26): the
 * NoteStore.sqlite of `~/Library/Group Containers/group.com.apple.notes/`,
 * picked as a folder (so the Media files come along) or as the file alone.
 *
 * The database is read with sqliteReader.ts (no SQLite library). A note's
 * body is ZICNOTEDATA.ZDATA: a gzip'd protobuf, NoteStoreProto → Document →
 * Note { note_text = 2, attribute_run = 5 }, the schema of
 * apple_cloud_notes_parser's notestore.proto, which Obsidian Importer's
 * Apple Notes importer (MIT) also follows. Each attribute run styles the
 * next `length` UTF-16 units of the text: its paragraph style (title,
 * headings, monospaced, lists, checklist, indent, block quote), font weight
 * (bold / italic), strikethrough, link, or an attachment at U+FFFC.
 *
 * Skipped, with a reason: notes in Recently Deleted or marked for deletion,
 * password-protected notes (their body is encrypted), empty notes.
 * Attachments: images and files are copied from the picked Media folder;
 * a URL attachment becomes a link; tables, drawings and other kinds that
 * need Apple's own CRDTs become a warning, not invented text.
 */

import { claimPath, dirOf, mdEmbed, safeName } from "./names";
import { isoDate, withFrontmatter } from "./frontmatter";
import { SqliteFile, SqliteFormatError, type SqlValue } from "./sqliteReader";
import { emptyVault, type ConvertedVault } from "./types";

// ── Protobuf wire format ─────────────────────────────────────────────

export interface ProtoField {
  wire: 0 | 1 | 2 | 5;
  /** varint and fixed64 as bigint, fixed32 as number, length-delimited as bytes. */
  value: bigint | number | Uint8Array;
}

/** Decode one protobuf message into its fields (field number → values in order). */
export function decodeProto(b: Uint8Array): Map<number, ProtoField[]> {
  const out = new Map<number, ProtoField[]>();
  let at = 0;
  const varint = (): bigint => {
    let v = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i++) {
      if (at >= b.length) throw new Error("protobuf: a varint runs past the end");
      const byte = b[at++];
      v |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return v;
      shift += 7n;
    }
    throw new Error("protobuf: a varint is longer than 10 bytes");
  };
  while (at < b.length) {
    const key = varint();
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    let f: ProtoField;
    if (wire === 0) f = { wire, value: varint() };
    else if (wire === 1) {
      if (at + 8 > b.length) throw new Error("protobuf: fixed64 past the end");
      f = { wire, value: new DataView(b.buffer, b.byteOffset + at, 8).getBigUint64(0, true) };
      at += 8;
    } else if (wire === 2) {
      const len = Number(varint());
      if (at + len > b.length) throw new Error("protobuf: a length-delimited field runs past the end");
      f = { wire, value: b.subarray(at, at + len) };
      at += len;
    } else if (wire === 5) {
      if (at + 4 > b.length) throw new Error("protobuf: fixed32 past the end");
      f = { wire, value: new DataView(b.buffer, b.byteOffset + at, 4).getUint32(0, true) };
      at += 4;
    } else throw new Error(`protobuf: wire type ${wire} is not supported`);
    if (field < 1) throw new Error("protobuf: field number 0");
    const list = out.get(field) ?? [];
    list.push(f);
    out.set(field, list);
  }
  return out;
}

const utf8 = new TextDecoder("utf-8");
const msg = (m: Map<number, ProtoField[]>, n: number) => {
  const v = m.get(n)?.[0]?.value;
  return v instanceof Uint8Array ? decodeProto(v) : null;
};
const int = (m: Map<number, ProtoField[]> | null, n: number): number | undefined => {
  const v = m?.get(n)?.[0]?.value;
  return typeof v === "bigint" ? Number(BigInt.asIntN(32, v)) : typeof v === "number" ? v : undefined;
};
const str = (m: Map<number, ProtoField[]> | null, n: number): string | undefined => {
  const v = m?.get(n)?.[0]?.value;
  return v instanceof Uint8Array ? utf8.decode(v) : undefined;
};

// ── The note body ────────────────────────────────────────────────────

/** ParagraphStyle.style_type values (as Obsidian Importer names them). */
export const STYLE = { default: -1, title: 0, heading: 1, subheading: 2, monospaced: 4, dottedList: 100, dashedList: 101, numberedList: 102, checklist: 103 } as const;
/** AttributeRun.font_weight values. */
export const WEIGHT = { bold: 1, italic: 2, boldItalic: 3 } as const;

export interface AttributeRun {
  length: number;
  styleType: number;
  indent: number;
  blockQuote: boolean;
  checked: boolean | null;
  fontWeight: number;
  strikethrough: boolean;
  underlined: boolean;
  link: string | null;
  attachment: { id: string; uti: string } | null;
}

export interface NoteBody {
  text: string;
  runs: AttributeRun[];
}

/** NoteStoreProto bytes (already gunzipped) → the text and its attribute runs. */
export function parseNoteBody(proto: Uint8Array): NoteBody {
  const store = decodeProto(proto);
  const doc = msg(store, 2);
  const note = doc ? msg(doc, 3) : null;
  if (!note) throw new Error("not a NoteStoreProto: no document.note");
  const text = str(note, 2) ?? "";
  const runs: AttributeRun[] = (note.get(5) ?? []).map((f) => {
    const r = decodeProto(f.value as Uint8Array);
    const ps = msg(r, 2);
    const checklist = ps ? msg(ps, 5) : null;
    const att = msg(r, 12);
    return {
      length: int(r, 1) ?? 0,
      styleType: int(ps, 1) ?? STYLE.default,
      indent: int(ps, 4) ?? 0,
      blockQuote: (int(ps, 8) ?? 0) !== 0,
      checked: checklist ? (int(checklist, 2) ?? 0) !== 0 : null,
      fontWeight: int(r, 5) ?? 0,
      strikethrough: (int(r, 7) ?? 0) !== 0,
      underlined: (int(r, 6) ?? 0) !== 0,
      link: str(r, 9) ?? null,
      attachment: att ? { id: str(att, 1) ?? "", uti: str(att, 2) ?? "" } : null,
    };
  });
  return { text, runs };
}

/** gunzip when the bytes are gzip (1f 8b), else return them as they are. */
export async function gunzipMaybe(b: Uint8Array): Promise<Uint8Array> {
  if (b.length < 2 || b[0] !== 0x1f || b[1] !== 0x8b) return b;
  const stream = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface Piece {
  text: string;
  run: AttributeRun;
}

const PLAIN: AttributeRun = { length: 0, styleType: STYLE.default, indent: 0, blockQuote: false, checked: null, fontWeight: 0, strikethrough: false, underlined: false, link: null, attachment: null };

/** Wrap `s` in `mark`, keeping its outer whitespace outside the markers. */
function wrap(s: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : s;
}

function inline(p: Piece, attachment: (id: string, uti: string) => string): string {
  if (p.run.attachment) return p.text.replace(/￼/g, () => attachment(p.run.attachment!.id, p.run.attachment!.uti));
  let s = p.text.replace(/￼/g, "");
  if (p.run.styleType === STYLE.monospaced) return s;
  s = s.replace(/([*_~`[\]\\])/g, "\\$1");
  if (p.run.fontWeight === WEIGHT.bold) s = wrap(s, "**");
  else if (p.run.fontWeight === WEIGHT.italic) s = wrap(s, "*");
  else if (p.run.fontWeight === WEIGHT.boldItalic) s = wrap(s, "***");
  if (p.run.strikethrough) s = wrap(s, "~~");
  if (p.run.link && s.trim()) s = `[${s}](${p.run.link.replace(/[()\s]/g, encodeURIComponent)})`;
  return s;
}

/**
 * A note body → Markdown. `attachment(id, uti)` returns the Markdown for an
 * attachment (an embed, a link) or "" to leave it out.
 */
export function noteToMarkdown(body: NoteBody, attachment: (id: string, uti: string) => string = () => ""): string {
  // Cut the text into pieces by run (UTF-16 units, as Apple counts them).
  const pieces: Piece[] = [];
  let at = 0;
  for (const run of body.runs) {
    if (run.length <= 0) continue;
    pieces.push({ text: body.text.slice(at, at + run.length), run });
    at += run.length;
  }
  if (at < body.text.length) pieces.push({ text: body.text.slice(at), run: PLAIN });

  // Split into paragraphs at "\n"; a paragraph takes the style of its first piece.
  const paragraphs: Piece[][] = [[]];
  for (const p of pieces) {
    const parts = p.text.split("\n");
    parts.forEach((t, i) => {
      if (i > 0) paragraphs.push([]);
      if (t) paragraphs[paragraphs.length - 1].push({ text: t, run: p.run });
      else if (i === 0 && paragraphs[paragraphs.length - 1].length === 0) paragraphs[paragraphs.length - 1].push({ text: "", run: p.run });
    });
  }

  const lines: string[] = [];
  let inCode = false;
  // One count per indent level: a sub-list numbers from 1 and its parent list goes on where it was
  // (1. · 1. 2. · 2.), and a dashed sub-item between two numbered items does not restart the count.
  const counts: number[] = [];
  for (const para of paragraphs) {
    const style = para[0]?.run ?? PLAIN;
    const content = para.map((p) => inline(p, attachment)).join("");
    if (style.styleType === STYLE.monospaced) {
      if (!inCode) lines.push("```");
      inCode = true;
      lines.push(para.map((p) => p.text).join(""));
      continue;
    }
    if (inCode) {
      lines.push("```");
      inCode = false;
    }
    const indent = "\t".repeat(Math.max(0, style.indent));
    const quote = style.blockQuote ? "> " : "";
    const level = Math.max(0, style.indent);
    const listItem = style.styleType === STYLE.numberedList || style.styleType === STYLE.dottedList || style.styleType === STYLE.dashedList || style.styleType === STYLE.checklist;
    if (!listItem) counts.length = 0;
    else {
      counts.length = level + 1;
      counts[level] = style.styleType === STYLE.numberedList ? (counts[level] ?? 0) + 1 : 0;
    }
    const number = counts[level] ?? 0;
    switch (style.styleType) {
      case STYLE.title:
        lines.push(content.trim() ? `${quote}# ${content}` : "");
        break;
      case STYLE.heading:
        lines.push(content.trim() ? `${quote}## ${content}` : "");
        break;
      case STYLE.subheading:
        lines.push(content.trim() ? `${quote}### ${content}` : "");
        break;
      case STYLE.dottedList:
      case STYLE.dashedList:
        lines.push(`${quote}${indent}- ${content}`);
        break;
      case STYLE.numberedList:
        lines.push(`${quote}${indent}${number}. ${content}`);
        break;
      case STYLE.checklist:
        lines.push(`${quote}${indent}- [${style.checked ? "x" : " "}] ${content}`);
        break;
      default:
        lines.push(`${quote}${content}`);
    }
  }
  if (inCode) lines.push("```");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ── NoteStore.sqlite ─────────────────────────────────────────────────

/** Core Data stores dates as seconds since 2001-01-01T00:00:00Z. */
export const CORE_DATA_EPOCH_MS = 978_307_200_000;
export function coreDataDate(v: SqlValue | undefined): string | undefined {
  const n = typeof v === "bigint" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? isoDate(CORE_DATA_EPOCH_MS + n * 1000) : undefined;
}

/** The picked file that is the Notes database, if any. */
export function findNoteStore(paths: Iterable<string>): string | null {
  return [...paths].find((p) => /(^|\/)NoteStore\.sqlite$/i.test(p)) ?? null;
}

const num = (v: SqlValue | undefined) => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : null);
const text = (v: SqlValue | undefined) => (typeof v === "string" ? v : null);
const first = (row: Record<string, SqlValue>, ...cols: string[]) => {
  for (const c of cols) if (row[c] !== undefined && row[c] !== null) return row[c];
  return null;
};

/** Convert a picked Apple Notes container (or NoteStore.sqlite alone) into a vault. */
export async function convertAppleNotesStore(files: Map<string, Uint8Array>): Promise<ConvertedVault> {
  const vault = emptyVault();
  const storePath = findNoteStore(files.keys());
  if (!storePath) {
    vault.skipped.push({ path: "(picked files)", reason: "unsupported", detail: "no NoteStore.sqlite among the picked files" });
    return vault;
  }
  for (const p of files.keys()) {
    if (p === storePath || /\/Media\//.test(p) || /\/(FallbackImages|Previews|Thumbnails)\//.test(p)) continue;
    if (/NoteStore\.sqlite-wal$/i.test(p)) continue;
    vault.skipped.push({ path: p, reason: "appFolder" });
  }
  let db: SqliteFile;
  try {
    db = new SqliteFile(files.get(storePath)!);
    db.tables();
  } catch (e) {
    vault.skipped.push({ path: storePath, reason: "unreadable", detail: e instanceof Error ? e.message : String(e) });
    return vault;
  }
  const wal = [...files.keys()].find((p) => /NoteStore\.sqlite-wal$/i.test(p));
  if (wal && (files.get(wal)?.length ?? 0) > 0) {
    vault.skipped.push({ path: wal, reason: "unsupported", detail: "recent changes still in the write-ahead log are not read: quit Notes, then pick the folder again to include them" });
  }

  try {
    const ents = new Map<string, number>();
    for (const r of db.rows("Z_PRIMARYKEY")) {
      const name = text(r.Z_NAME);
      const ent = num(r.Z_ENT);
      if (name && ent !== null) ents.set(name, ent);
    }
    const noteEnt = ents.get("ICNote");
    const folderEnt = ents.get("ICFolder");
    if (noteEnt === undefined) throw new SqliteFormatError("Z_PRIMARYKEY has no ICNote: not a Notes database (or a version from before iOS 9)");

    const objects = new Map<number, Record<string, SqlValue>>();
    for (const r of db.rows("ZICCLOUDSYNCINGOBJECT")) {
      const pk = num(r.Z_PK);
      if (pk !== null) objects.set(pk, r);
    }
    const byIdentifier = new Map<string, Record<string, SqlValue>>();
    for (const r of objects.values()) {
      const id = text(r.ZIDENTIFIER);
      if (id) byIdentifier.set(id, r);
    }

    // Folders: names and nesting; the trash (folder type 1) and its subfolders.
    const folderPath = new Map<number, string | null>();
    const pathOf = (pk: number, depth = 0): string | null => {
      if (folderPath.has(pk)) return folderPath.get(pk)!;
      const f = objects.get(pk);
      if (!f || depth > 50) return "";
      if (num(f.ZFOLDERTYPE) === 1 || num(f.ZMARKEDFORDELETION) === 1) {
        folderPath.set(pk, null);
        return null;
      }
      const parent = num(f.ZPARENT);
      const up = parent !== null && objects.get(parent) && (folderEnt === undefined || num(objects.get(parent)!.Z_ENT) === folderEnt) ? pathOf(parent, depth + 1) : "";
      const name = safeName(text(first(f, "ZTITLE2", "ZTITLE")) ?? "", "Notes");
      const out = up === null ? null : up ? `${up}/${name}` : name;
      folderPath.set(pk, out);
      return out;
    };

    const bodies = new Map<number, Uint8Array>();
    for (const r of db.rows("ZICNOTEDATA")) {
      const note = num(r.ZNOTE);
      if (note !== null && r.ZDATA instanceof Uint8Array) bodies.set(note, r.ZDATA);
    }

    const taken = new Set<string>();
    const attachmentTaken = new Set<string>();
    for (const [pk, r] of objects) {
      if (num(r.Z_ENT) !== noteEnt) continue;
      const title = text(first(r, "ZTITLE1", "ZTITLE")) ?? "";
      const label = title || `note ${pk}`;
      const folderPk = num(r.ZFOLDER);
      const folder = folderPk === null ? "" : pathOf(folderPk);
      if (folder === null || num(r.ZMARKEDFORDELETION) === 1) {
        vault.skipped.push({ path: label, reason: "trashed" });
        continue;
      }
      if (num(r.ZISPASSWORDPROTECTED) === 1) {
        vault.skipped.push({ path: label, reason: "encrypted", detail: "a locked note: unlock it in Notes first" });
        continue;
      }
      const raw = bodies.get(pk);
      if (!raw) {
        vault.skipped.push({ path: label, reason: "empty" });
        continue;
      }
      let body: NoteBody;
      try {
        body = parseNoteBody(await gunzipMaybe(raw));
      } catch (e) {
        vault.skipped.push({ path: label, reason: "unreadable", detail: e instanceof Error ? e.message : String(e) });
        continue;
      }
      if (!body.text.trim()) {
        vault.skipped.push({ path: label, reason: "empty" });
        continue;
      }
      const dest = claimPath(taken, `${folder ? `${folder}/` : ""}${safeName(title)}.md`);
      const attachment = (id: string, uti: string): string => {
        const a = byIdentifier.get(id);
        if (!a) {
          vault.warnings.push({ path: dest, reason: "missingAttachment", detail: `attachment ${id} (${uti}) is not in the database` });
          return "";
        }
        const kind = text(a.ZTYPEUTI) ?? uti;
        const url = text(a.ZURLSTRING);
        if (kind === "public.url" && url) return `[${(text(a.ZTITLE) ?? url).replace(/[[\]]/g, "")}](${url})`;
        if (/^com\.apple\.(notes\.table|drawing|paper|notes\.gallery|notes\.inlinetextattachment)/.test(kind)) {
          vault.warnings.push({ path: dest, reason: "missingAttachment", detail: `${kind}: this kind of attachment is not converted yet` });
          return "";
        }
        const media = num(a.ZMEDIA) !== null ? objects.get(num(a.ZMEDIA)!) : a;
        const mediaId = text(media?.ZIDENTIFIER);
        const filename = text(media?.ZFILENAME);
        vault.sourceAttachments++;
        if (!mediaId || !filename) {
          vault.warnings.push({ path: dest, reason: "missingAttachment", detail: `${kind}: the database names no media file` });
          return "";
        }
        const src = [...files.keys()].find((p) => p.includes(`/Media/${mediaId}/`) && p.endsWith(`/${filename}`));
        if (!src) {
          vault.warnings.push({ path: dest, reason: "missingAttachment", detail: `Media/${mediaId}/…/${filename}: pick the whole group.com.apple.notes folder to bring the files` });
          return "";
        }
        const target = claimPath(attachmentTaken, `_attachments/${safeName(filename.replace(/\.[^.]+$/, ""))}${(filename.match(/\.[A-Za-z0-9]{1,10}$/)?.[0] ?? "").toLowerCase()}`);
        vault.attachments.set(target, files.get(src)!);
        return mdEmbed(target, dirOf(dest));
      };
      const md = noteToMarkdown(body, attachment);
      const created = coreDataDate(first(r, "ZCREATIONDATE3", "ZCREATIONDATE1", "ZCREATIONDATE"));
      const modified = coreDataDate(first(r, "ZMODIFICATIONDATE1", "ZMODIFICATIONDATE"));
      if (!created && !modified) vault.warnings.push({ path: dest, reason: "noDates" });
      vault.notes.set(dest, withFrontmatter({ created, modified }, md));
    }
  } catch (e) {
    vault.skipped.push({ path: storePath, reason: "unreadable", detail: e instanceof Error ? e.message : String(e) });
  }
  return vault;
}
