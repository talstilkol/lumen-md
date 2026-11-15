#!/usr/bin/env node
/**
 * Plan W10.E48: builds the SYNTHETIC Apple Notes fixture used by
 * src/__tests__/appleNotesStore.test.ts. Nothing in it comes from a real
 * Notes library. The tables and columns are named as in macOS's
 * NoteStore.sqlite (Core Data: Z_PRIMARYKEY, ZICCLOUDSYNCINGOBJECT,
 * ZICNOTEDATA). Note bodies are gzip'd NoteStoreProto messages encoded with
 * the field numbers of apple_cloud_notes_parser's notestore.proto. A body
 * from a real Mac is still owed (see the PR).
 *
 *   node --experimental-sqlite scripts/fixtures/apple-notes-fixture.mjs <out dir>
 *
 * page_size 1024, so the note table needs interior b-tree pages and the long
 * note spills onto overflow pages: both paths of the reader run.
 */
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
if (!out) throw new Error("usage: apple-notes-fixture.mjs <out dir>");
const root = join(out, "group.com.apple.notes");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

// ── protobuf encoder (wire types 0 and 2 are all a note body needs) ──
const varint = (n) => {
  const b = [];
  let v = BigInt(n);
  if (v < 0n) v = BigInt.asUintN(64, v);
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v) byte |= 0x80;
    b.push(byte);
  } while (v);
  return Buffer.from(b);
};
const key = (field, wire) => varint((field << 3) | wire);
const vint = (field, n) => Buffer.concat([key(field, 0), varint(n)]);
const bytes = (field, buf) => Buffer.concat([key(field, 2), varint(buf.length), buf]);
const str = (field, s) => bytes(field, Buffer.from(s, "utf8"));

/** runs: [{ text, style?, indent?, done?, weight?, strike?, link?, att? }] → gzip'd NoteStoreProto. */
function body(runs) {
  const text = runs.map((r) => r.text).join("");
  const encoded = runs.map((r) => {
    const parts = [vint(1, r.text.length)]; // UTF-16 units, as Apple counts
    const ps = [];
    if (r.style !== undefined) ps.push(vint(1, r.style));
    if (r.indent) ps.push(vint(4, r.indent));
    if (r.done !== undefined) ps.push(bytes(5, Buffer.concat([bytes(1, Buffer.from("0123456789abcdef")), vint(2, r.done ? 1 : 0)])));
    if (r.quote) ps.push(vint(8, 1));
    if (ps.length) parts.push(bytes(2, Buffer.concat(ps)));
    if (r.weight) parts.push(vint(5, r.weight));
    if (r.strike) parts.push(vint(7, 1));
    if (r.link) parts.push(str(9, r.link));
    if (r.att) parts.push(bytes(12, Buffer.concat([str(1, r.att.id), str(2, r.att.uti)])));
    return bytes(5, Buffer.concat(parts));
  });
  const note = Buffer.concat([str(2, text), ...encoded]);
  const doc = Buffer.concat([vint(2, 1), bytes(3, note)]);
  return gzipSync(bytes(2, doc));
}

const db = new DatabaseSync(join(root, "NoteStore.sqlite"));
db.exec("PRAGMA page_size = 1024; PRAGMA journal_mode = DELETE;");
db.exec(`
CREATE TABLE Z_PRIMARYKEY (Z_ENT INTEGER PRIMARY KEY, Z_NAME VARCHAR, Z_SUPER INTEGER, Z_MAX INTEGER);
CREATE TABLE ZICCLOUDSYNCINGOBJECT ( Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, Z_OPT INTEGER, ZMARKEDFORDELETION INTEGER, ZISPASSWORDPROTECTED INTEGER, ZFOLDERTYPE INTEGER, ZFOLDER INTEGER, ZPARENT INTEGER, ZMEDIA INTEGER, ZNOTEDATA INTEGER, ZCREATIONDATE1 TIMESTAMP, ZCREATIONDATE3 TIMESTAMP, ZMODIFICATIONDATE1 TIMESTAMP, ZIDENTIFIER VARCHAR, ZTITLE VARCHAR, ZTITLE1 VARCHAR, ZTITLE2 VARCHAR, ZTYPEUTI VARCHAR, ZFILENAME VARCHAR, ZURLSTRING VARCHAR );
CREATE TABLE ZICNOTEDATA ( Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, Z_OPT INTEGER, ZNOTE INTEGER, ZDATA BLOB );
CREATE INDEX ZICCLOUDSYNCINGOBJECT_ZFOLDER_INDEX ON ZICCLOUDSYNCINGOBJECT (ZFOLDER);
`);
const ENT = { ICAccount: 1, ICAttachment: 5, ICFolder: 14, ICMedia: 11, ICNote: 12 };
for (const [name, ent] of Object.entries(ENT)) db.prepare("INSERT INTO Z_PRIMARYKEY VALUES (?, ?, 0, 0)").run(ent, name);

const obj = db.prepare("INSERT INTO ZICCLOUDSYNCINGOBJECT (Z_PK, Z_ENT, ZMARKEDFORDELETION, ZISPASSWORDPROTECTED, ZFOLDERTYPE, ZFOLDER, ZPARENT, ZMEDIA, ZCREATIONDATE1, ZCREATIONDATE3, ZMODIFICATIONDATE1, ZIDENTIFIER, ZTITLE, ZTITLE1, ZTITLE2, ZTYPEUTI, ZFILENAME, ZURLSTRING) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
const data = db.prepare("INSERT INTO ZICNOTEDATA (Z_ENT, ZNOTE, ZDATA) VALUES (13, ?, ?)");
const row = (o) => obj.run(o.pk, o.ent, o.del ?? 0, o.locked ?? 0, o.ftype ?? null, o.folder ?? null, o.parent ?? null, o.media ?? null, o.c1 ?? null, o.c3 ?? null, o.m1 ?? null, o.id ?? null, o.title ?? null, o.title1 ?? null, o.title2 ?? null, o.uti ?? null, o.filename ?? null, o.url ?? null);

// 2026-11-01T10:00:00Z and 2026-11-02T12:30:00Z, in Core Data seconds.
const C = 1793527200 - 978307200;
const M = 1793622600 - 978307200;

row({ pk: 1, ent: ENT.ICAccount, id: "ACCOUNT-0001", title: "On My Mac" });
row({ pk: 2, ent: ENT.ICFolder, title2: "Notes", ftype: 0 });
row({ pk: 3, ent: ENT.ICFolder, title2: "Work", ftype: 0 });
row({ pk: 4, ent: ENT.ICFolder, title2: "Projects", ftype: 0, parent: 3 });
row({ pk: 5, ent: ENT.ICFolder, title2: "Recently Deleted", ftype: 1 });
row({ pk: 6, ent: ENT.ICMedia, id: "MEDIA-PHOTO-1", filename: "Photo.PNG" });
row({ pk: 7, ent: ENT.ICAttachment, id: "ATT-PHOTO-1", uti: "public.png", media: 6 });
row({ pk: 8, ent: ENT.ICAttachment, id: "ATT-URL-1", uti: "public.url", url: "https://example.org/a b", title: "Example site" });
row({ pk: 9, ent: ENT.ICAttachment, id: "ATT-TABLE-1", uti: "com.apple.notes.table" });
row({ pk: 10, ent: ENT.ICMedia, id: "MEDIA-MISSING-1", filename: "scan.pdf" });
row({ pk: 11, ent: ENT.ICAttachment, id: "ATT-PDF-1", uti: "com.adobe.pdf", media: 10 });

let pk = 100;
const note = (o, runs) => {
  const id = pk++;
  row({ pk: id, ent: ENT.ICNote, folder: o.folder ?? 2, title1: o.title, c3: o.noCreated ? null : C, m1: o.noModified ? null : M, del: o.del, locked: o.locked });
  if (runs) data.run(id, body(runs));
  return id;
};

const FFFC = "￼";
note({ title: "Shopping" }, [
  { text: "Shopping\n", style: 0 },
  { text: "Milk\n", style: 103, done: true },
  { text: "Bread\n", style: 103, done: false },
  { text: "Nested\n", style: 103, done: false, indent: 1 },
]);
note({ title: "Formatting", folder: 4 }, [
  { text: "Formatting\n", style: 0 },
  { text: "Heading\n", style: 1 },
  { text: "Sub\n", style: 2 },
  { text: "plain " },
  { text: "bold", weight: 1 },
  { text: " and " },
  { text: "italic ", weight: 2 },
  { text: "both", weight: 3 },
  { text: " " },
  { text: "gone", strike: true },
  { text: " a " },
  { text: "link", link: "https://example.org/x" },
  { text: " 2*3_[x]\n" },
  { text: "one\n", style: 102 },
  { text: "two\n", style: 102 },
  { text: "dot\n", style: 100 },
  { text: "dash\n", style: 101, indent: 2 },
  { text: "const x = 1;\n", style: 4 },
  { text: "  y();\n", style: 4 },
  { text: "quoted\n", quote: true },
  { text: "end" },
]);
note({ title: "שלום עולם 👋" }, [
  { text: "שלום עולם 👋\n", style: 0 },
  { text: "טקסט ", weight: 1 },
  { text: "בעברית 😀 עם אמוג׳י\n" },
  { text: "אחרי" },
]);
note({ title: "Attachments" }, [
  { text: "Attachments\n", style: 0 },
  { text: "photo: " },
  { text: FFFC, att: { id: "ATT-PHOTO-1", uti: "public.png" } },
  { text: "\nurl: " },
  { text: FFFC, att: { id: "ATT-URL-1", uti: "public.url" } },
  { text: "\ntable: " },
  { text: FFFC, att: { id: "ATT-TABLE-1", uti: "com.apple.notes.table" } },
  { text: "\npdf: " },
  { text: FFFC, att: { id: "ATT-PDF-1", uti: "com.adobe.pdf" } },
  { text: "\nghost: " },
  { text: FFFC, att: { id: "ATT-NOWHERE", uti: "public.jpeg" } },
]);
// Words from a fixed pseudo-random sequence, so the gzip'd body stays larger than a page.
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const word = () => Array.from({ length: 3 + Math.floor(rnd() * 6) }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(rnd() * 26)]).join("");
const long = Array.from({ length: 120 }, (_, i) => `Line ${i + 1}: ${Array.from({ length: 8 }, word).join(" ")}`).join("\n");
note({ title: "Long note" }, [{ text: "Long note\n", style: 0 }, { text: long }]);
note({ title: "Deleted one", folder: 5 }, [{ text: "Deleted one\nbye" }]);
note({ title: "Marked", del: 1 }, [{ text: "Marked\nbye" }]);
note({ title: "Locked", locked: 1 }, [{ text: "Locked" }]);
note({ title: "No body" }, null);
note({ title: "Undated", noCreated: true, noModified: true }, [{ text: "Undated\ntext" }]);
note({ title: "Shopping" }, [{ text: "Shopping\nsecond list with the same title" }]);
// Many small notes, so ZICCLOUDSYNCINGOBJECT needs interior pages.
for (let i = 1; i <= 80; i++) note({ title: `Bulk ${String(i).padStart(2, "0")}`, folder: 3 }, [{ text: `Bulk ${String(i).padStart(2, "0")}\nbody ${i}` }]);
db.close();

const media = join(root, "Accounts", "ACCOUNT-0001", "Media", "MEDIA-PHOTO-1", "1_ABCDEF");
mkdirSync(media, { recursive: true });
// An 8-byte PNG signature plus a marker: enough to be copied byte for byte.
writeFileSync(join(media, "Photo.PNG"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x53, 0x59, 0x4e]));
console.log(`wrote ${root}`);
