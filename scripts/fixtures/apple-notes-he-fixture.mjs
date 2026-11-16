#!/usr/bin/env node
/**
 * Lane T8 (Israeli import scorecard): a SYNTHETIC Hebrew Apple Notes
 * library, for src/__tests__/israeliImportAppleNotes.test.ts. Nothing in it
 * comes from a real Notes library; the tables, columns and the protobuf body
 * are built exactly as scripts/fixtures/apple-notes-fixture.mjs builds them.
 * One note in Hebrew: a title, headings, a numbered list with numbered and
 * dashed sub-items, a checklist with nikud, emoji before styled text (UTF-16
 * offsets), a link, mixed-direction lines.
 *
 *   node --experimental-sqlite scripts/fixtures/apple-notes-he-fixture.mjs <out dir>
 */
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
if (!out) throw new Error("usage: apple-notes-he-fixture.mjs <out dir>");
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

// 2026-04-20T08:00:00Z and 2026-04-21T19:45:00Z, in Core Data seconds.
const C = Date.UTC(2026, 3, 20, 8, 0, 0) / 1000 - 978307200;
const M = Date.UTC(2026, 3, 21, 19, 45, 0) / 1000 - 978307200;

row({ pk: 1, ent: ENT.ICAccount, id: "ACCOUNT-0001", title: "iCloud" });
row({ pk: 2, ent: ENT.ICFolder, title2: "פתקים", ftype: 0 });
row({ pk: 100, ent: ENT.ICNote, folder: 2, title1: "הכנות לפסח", c3: C, m1: M });
data.run(100, body([
  { text: "הכנות לפסח\n", style: 0 },
  { text: "קניות\n", style: 1 },
  { text: "ירקות\n", style: 102 },
  { text: "חסה\n", style: 102, indent: 1 },
  { text: "פטרוזיליה\n", style: 102, indent: 1 },
  { text: "מצות\n", style: 102 },
  { text: "שמורות, לא רגילות\n", style: 101, indent: 1 },
  { text: "יין\n", style: 102 },
  { text: "משימות\n", style: 2 },
  { text: "לנקות את המטבח\n", style: 103, done: true },
  { text: "לקרוא את הַהַגָּדָה\n", style: 103, done: false },
  { text: "🍷 " },
  { text: "חשוב", weight: 1 },
  { text: ": להזמין ב-" },
  { text: "Wolt", link: "https://example.org/wolt" },
  { text: " עד יום חמישי.\n" },
  { text: "מחיר משוער: ₪450 (כולל iPhone 16 case 😅)" },
]));
db.close();
console.log(`wrote ${root}`);
