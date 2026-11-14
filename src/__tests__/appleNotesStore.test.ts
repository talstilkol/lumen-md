/**
 * Plan W10.E48: Apple Notes from its own database, NoteStore.sqlite.
 *
 * The fixture is SYNTHETIC: src/__tests__/fixtures/apple-notes-synthetic/,
 * built by scripts/fixtures/apple-notes-fixture.mjs with node:sqlite. The
 * tables and columns are named as in macOS, and the bodies are gzip'd
 * NoteStoreProto messages with notestore.proto's field numbers. No real
 * Notes library is in it. A real one is owed to the Mac (see the PR).
 *
 * The SQLite reader is checked against node:sqlite (SQLite itself) as an
 * oracle, when this Node has it.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { SqliteFile, SqliteFormatError, parseColumns, readVarint } from "../storage/import/sqliteReader";
import { STYLE, WEIGHT, convertAppleNotesStore, coreDataDate, decodeProto, gunzipMaybe, noteToMarkdown, parseNoteBody } from "../storage/import/appleNotes";
import { detectImportSource, SOURCE_ACCEPT } from "../storage/import/convert";

const FIX = "src/__tests__/fixtures/apple-notes-synthetic";
const DB = join(FIX, "group.com.apple.notes/NoteStore.sqlite");
const dbBytes = () => new Uint8Array(readFileSync(DB));

function picked(): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(FIX, p).split("\\").join("/"), new Uint8Array(readFileSync(p)));
    }
  };
  walk(FIX);
  return out;
}

type Oracle = { prepare(sql: string): { all(): Record<string, unknown>[] } };
function oracle(): Oracle | null {
  try {
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (p: string, o?: object) => Oracle };
    return new DatabaseSync(DB, { readOnly: true });
  } catch {
    return null;
  }
}

describe("sqliteReader: the file format", () => {
  it("reads the header: page size, usable size, not WAL", () => {
    const db = new SqliteFile(dbBytes());
    expect(db.pageSize).toBe(1024);
    expect(db.usable).toBe(1024);
    expect(db.walMode).toBe(false);
  });

  it("the fixture exercises interior pages and overflow chains", () => {
    const b = dbBytes();
    const db = new SqliteFile(b);
    const types = Array.from({ length: db.pageCount }, (_, i) => b[i * 1024 + (i === 0 ? 100 : 0)]);
    expect(types.filter((t) => t === 0x05).length).toBeGreaterThan(0);
    const longest = Math.max(...[...db.rows("ZICNOTEDATA")].map((r) => (r.ZDATA as Uint8Array).length));
    expect(longest).toBeGreaterThan(db.usable - 35);
  });

  it("lists tables with their columns; Z_PK, the INTEGER PRIMARY KEY, reads the rowid", () => {
    const db = new SqliteFile(dbBytes());
    expect([...db.tables().keys()].sort()).toEqual(["ZICCLOUDSYNCINGOBJECT", "ZICNOTEDATA", "Z_PRIMARYKEY"]);
    const t = db.table("ziccloudsyncingobject")!;
    expect(t.columns.slice(0, 3)).toEqual(["Z_PK", "Z_ENT", "Z_OPT"]);
    expect(t.rowidColumn).toBe(0);
    expect([...db.rows("ZICNOTEDATA")].map((r) => r.Z_PK).slice(0, 3)).toEqual([1, 2, 3]);
  });

  it("every row of every table equals what SQLite itself returns (node:sqlite as the oracle)", (ctx: { skip: () => void }) => {
    const o = oracle();
    if (!o) return ctx.skip();
    const db = new SqliteFile(dbBytes());
    for (const name of db.tables().keys()) {
      const mine = [...db.rows(name)];
      const theirs = o.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all();
      expect(mine.length, name).toBe(theirs.length);
      mine.forEach((row, i) => {
        for (const [k, v] of Object.entries(theirs[i])) {
          const got = row[k];
          if (v instanceof Uint8Array) expect(Buffer.from(got as Uint8Array).equals(Buffer.from(v)), `${name}[${i}].${k}`).toBe(true);
          else expect(got, `${name}[${i}].${k}`).toEqual(typeof v === "bigint" ? Number(v) : v);
        }
      });
    }
  });

  it("varints: 1, 2 and 9 bytes, and negative 64-bit values", () => {
    expect(readVarint(Uint8Array.of(0x7f), 0)).toEqual([127n, 1]);
    expect(readVarint(Uint8Array.of(0x81, 0x00), 0)).toEqual([128n, 2]);
    expect(readVarint(Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff), 0)).toEqual([-1n, 9]);
  });

  it("CREATE TABLE parsing: quotes, constraints, and a non-alias primary key", () => {
    expect(parseColumns('CREATE TABLE t ("a b" TEXT, [c] INT, `d`, e INTEGER PRIMARY KEY, PRIMARY KEY (x), CHECK (a > 0))')).toEqual({ columns: ["a b", "c", "d", "e"], rowidColumn: 3 });
    expect(parseColumns("CREATE TABLE t (id INT PRIMARY KEY, v)").rowidColumn).toBe(-1);
  });

  it("rejects what isn't a SQLite database, and a corrupt page link, instead of guessing", () => {
    expect(() => new SqliteFile(new TextEncoder().encode("hello".repeat(30)))).toThrow(SqliteFormatError);
    const b = dbBytes();
    const db = new SqliteFile(b);
    const root = db.table("ZICCLOUDSYNCINGOBJECT")!.rootPage;
    const corrupt = b.slice();
    // Point the root's right-most child at the root itself: a cycle.
    const hdr = (root - 1) * 1024;
    expect(corrupt[hdr]).toBe(0x05);
    new DataView(corrupt.buffer).setUint32(hdr + 8, root);
    expect(() => [...new SqliteFile(corrupt).rows("ZICCLOUDSYNCINGOBJECT")]).toThrow(/reached twice|not a table b-tree page/);
  });
});

/** A hand-encoded NoteStoreProto (synthetic): text + runs [length, fields…]. */
function proto(text: string, runs: Array<{ length: number; style?: number; weight?: number; link?: string }>): Uint8Array {
  const v = (n: number) => {
    const b: number[] = [];
    do {
      let x = n & 0x7f;
      n >>>= 7;
      if (n) x |= 0x80;
      b.push(x);
    } while (n);
    return b;
  };
  const ld = (f: number, bytes: number[]) => [...v((f << 3) | 2), ...v(bytes.length), ...bytes];
  const vi = (f: number, n: number) => [...v(f << 3), ...v(n)];
  const s = (f: number, t: string) => ld(f, [...new TextEncoder().encode(t)]);
  const encRuns = runs.map((r) => ld(5, [...vi(1, r.length), ...(r.style !== undefined ? ld(2, vi(1, r.style)) : []), ...(r.weight ? vi(5, r.weight) : []), ...(r.link ? s(9, r.link) : [])]));
  return Uint8Array.from(ld(2, [...vi(2, 1), ...ld(3, [...s(2, text), ...encRuns.flat()])]));
}

describe("note bodies: gzip'd protobuf → Markdown", () => {
  it("decodes the wire format, and refuses a truncated message", () => {
    const m = decodeProto(Uint8Array.of(0x08, 0x96, 0x01, 0x12, 0x02, 0x68, 0x69));
    expect(m.get(1)![0]).toEqual({ wire: 0, value: 150n });
    expect(new TextDecoder().decode(m.get(2)![0].value as Uint8Array)).toBe("hi");
    expect(() => decodeProto(Uint8Array.of(0x12, 0x05, 0x68))).toThrow(/past the end/);
  });

  it("parses text and runs, and counts run lengths in UTF-16 units (emoji are 2)", () => {
    const body = parseNoteBody(proto("T😀\nbold", [{ length: 4, style: STYLE.title }, { length: 4, weight: WEIGHT.bold }]));
    expect(body.text).toBe("T😀\nbold");
    expect(noteToMarkdown(body)).toBe("# T😀\n**bold**\n");
  });

  it("gunzips a gzip'd body and passes a plain one through", async () => {
    const raw = proto("x", [{ length: 1 }]);
    expect(await gunzipMaybe(new Uint8Array(gzipSync(raw)))).toEqual(raw);
    expect(await gunzipMaybe(raw)).toBe(raw);
  });

  it("escapes Markdown in plain text and keeps whitespace outside the markers", () => {
    expect(noteToMarkdown(parseNoteBody(proto("a*b bold ", [{ length: 4 }, { length: 5, weight: WEIGHT.bold }])))).toBe("a\\*b **bold**\n");
  });

  it("Core Data dates: seconds since 2001-01-01", () => {
    expect(coreDataDate(0.5)).toBe("2001-01-01T00:00:00Z");
    expect(coreDataDate(815220000)).toBe("2026-11-01T10:00:00Z");
    expect(coreDataDate(null)).toBeUndefined();
  });
});

describe("convertAppleNotesStore on the synthetic NoteStore.sqlite", () => {
  it("is detected as Apple Notes, and the picker accepts .sqlite", () => {
    expect(detectImportSource([...picked().keys()])).toBe("appleNotes");
    expect(SOURCE_ACCEPT.appleNotes.split(",")).toContain(".sqlite");
  });

  it("converts every live note into its folder path, with dates", async () => {
    const v = await convertAppleNotesStore(picked());
    const paths = [...v.notes.keys()];
    expect(paths.filter((p) => p.startsWith("Work/Bulk ")).length).toBe(80);
    expect(paths).toEqual(expect.arrayContaining(["Notes/Shopping.md", "Notes/Shopping 2.md", "Work/Projects/Formatting.md", "Notes/שלום עולם 👋.md", "Notes/Attachments.md", "Notes/Long note.md", "Notes/Undated.md"]));
    expect(paths.length).toBe(87);
    expect(v.notes.get("Notes/Shopping.md")).toBe("---\ncreated: 2026-11-01T10:00:00Z\nmodified: 2026-11-02T12:30:00Z\n---\n\n# Shopping\n- [x] Milk\n- [ ] Bread\n\t- [ ] Nested\n");
  });

  it("renders headings, inline styles, links, lists, code and quotes", async () => {
    const md = (await convertAppleNotesStore(picked())).notes.get("Work/Projects/Formatting.md")!;
    expect(md.split("---\n\n")[1]).toBe(
      [
        "# Formatting",
        "## Heading",
        "### Sub",
        "plain **bold** and *italic* ***both*** ~~gone~~ a [link](https://example.org/x) 2\\*3\\_\\[x\\]",
        "1. one",
        "2. two",
        "- dot",
        "\t\t- dash",
        "```",
        "const x = 1;",
        "  y();",
        "```",
        "> quoted",
        "end",
        "",
      ].join("\n"),
    );
  });

  it("keeps Hebrew and emoji NFC-identical", async () => {
    const md = (await convertAppleNotesStore(picked())).notes.get("Notes/שלום עולם 👋.md")!;
    expect(md).toContain("# שלום עולם 👋\n**טקסט** בעברית 😀 עם אמוג׳י\nאחרי\n");
    expect(md.normalize("NFC")).toBe(md);
  });

  it("reads a note whose body spans overflow pages, whole", async () => {
    const md = (await convertAppleNotesStore(picked())).notes.get("Notes/Long note.md")!;
    expect(md.match(/^Line \d+: /gm)?.length).toBe(120);
    expect(md).toMatch(/^Line 120: /m);
  });

  it("attachments: the image is copied from Media, a URL becomes a link, the rest are warnings", async () => {
    const v = await convertAppleNotesStore(picked());
    const md = v.notes.get("Notes/Attachments.md")!;
    expect(md).toContain("photo: ![Photo.png](../_attachments/Photo.png)");
    expect(md).toContain("url: [Example site](https://example.org/a b)");
    expect([...v.attachments.keys()]).toEqual(["_attachments/Photo.png"]);
    expect(v.attachments.get("_attachments/Photo.png")!.slice(0, 4)).toEqual(Uint8Array.of(0x89, 0x50, 0x4e, 0x47));
    expect(v.sourceAttachments).toBe(2);
    const w = v.warnings.filter((x) => x.path === "Notes/Attachments.md").map((x) => x.detail);
    expect(w).toEqual([
      "com.apple.notes.table: this kind of attachment is not converted yet",
      "Media/MEDIA-MISSING-1/…/scan.pdf: pick the whole group.com.apple.notes folder to bring the files",
      "attachment ATT-NOWHERE (public.jpeg) is not in the database",
    ]);
  });

  it("skips Recently Deleted, marked-for-deletion, locked and empty notes, each with its reason", async () => {
    const v = await convertAppleNotesStore(picked());
    const s = Object.fromEntries(v.skipped.filter((x) => !x.path.includes("/")).map((x) => [x.path, x.reason]));
    expect(s).toMatchObject({ "Deleted one": "trashed", Marked: "trashed", Locked: "encrypted", "No body": "empty" });
    expect(v.warnings.find((x) => x.path === "Notes/Undated.md")?.reason).toBe("noDates");
    expect([...v.notes.keys()].some((p) => /Deleted one|Marked|Locked/.test(p))).toBe(false);
  });

  it("NoteStore.sqlite alone (no Media folder) still converts every note; the image becomes a warning", async () => {
    const only = new Map([["NoteStore.sqlite", dbBytes()]]);
    const v = await convertAppleNotesStore(only);
    expect(v.notes.size).toBe(87);
    expect(v.attachments.size).toBe(0);
    expect(v.warnings.some((x) => x.detail?.startsWith("Media/MEDIA-PHOTO-1/"))).toBe(true);
  });

  it("a write-ahead log beside the database is reported, not silently ignored", async () => {
    const files = picked();
    files.set("group.com.apple.notes/NoteStore.sqlite-wal", Uint8Array.of(1, 2, 3));
    const v = await convertAppleNotesStore(files);
    expect(v.skipped.find((x) => x.path.endsWith("NoteStore.sqlite-wal"))).toMatchObject({ reason: "unsupported" });
  });

  it("a file that isn't a database is unreadable, with the reason", async () => {
    const v = await convertAppleNotesStore(new Map([["NoteStore.sqlite", new TextEncoder().encode("not sqlite".repeat(20))]]));
    expect(v.notes.size).toBe(0);
    expect(v.skipped[0]).toMatchObject({ path: "NoteStore.sqlite", reason: "unreadable" });
  });
});
