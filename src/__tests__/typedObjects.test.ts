/**
 * Plan W12.T1 — typed objects: a type is `.lumen/types/<id>.yaml`, fields
 * with kinds and defaults, one `extends` parent; the resolver gives a
 * note's types and effective fields; data stays plain frontmatter.
 *
 * Acceptance: ≥50 unit tests over inheritance, name collisions, a deleted
 * type and a note with two types; 200 typed notes open → save byte
 * identical (the W11.P3 path); no field saved outside the frontmatter.
 *
 * The 200 notes are SYNTHETIC (generated below, labelled as such): they
 * test this code's own round trip, not compatibility with real vaults —
 * that is W11.P3's corpus and W12.M2 on the Mac.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { buildTypeRegistry, fieldsOfNote, loadTypeRegistry, noteIsA, typesOfNote } from "../types/typeRegistry";
import { checkFieldValue, checkNote, defaultsOf, newObjectText, relationTargetOk } from "../types/fieldValues";
import { parseTypeFile, typeDefFromObject, typeIdFromPath, typeToYaml, type FieldDef, type TypeDef } from "../types/typeSchema";
import { basesFileFromText } from "../views/bases/base";
import { joinTextEnvelope, splitTextEnvelope } from "../storage/textCodec";
import { readProperties, setProperty, type PropertyValue } from "../properties/frontmatter";

const file = (id: string, yaml: string) => ({ path: `.lumen/types/${id}.yaml`, text: yaml });
const reg = (...files: Array<{ path: string; text: string }>) => loadTypeRegistry(files);
const def = (id: string, raw: unknown, origin: "vault" | "builtin" = "vault"): TypeDef => {
  const p = typeDefFromObject(id, raw, `.lumen/types/${id}.yaml`, origin);
  if (!p.ok) throw new Error(p.error);
  return p.type;
};
const names = (fs: readonly FieldDef[]) => fs.map((f) => f.name);

const WORK = file("work", "label: { he: יצירה, en: Work }\nfields:\n  title: { type: text, pinned: true }\n  year: { type: number }\n  status: { type: select, options: [draft, done], default: draft }\n");
const BOOK = file(
  "book",
  "label: { he: ספר, en: Book }\ntag: book\nextends: work\nfields:\n  author: { type: relation, to: person, pinned: true }\n  pages: { type: number, default: 0 }\n  status: { type: select, default: done }\n  ppu: { type: formula, formula: 'price / pages' }\n",
);
const PERSON = file("person", "label: { he: אדם, en: Person }\ntag: person\nfields:\n  born: { type: hebrew-date }\n  site: url\n  alive: checkbox\n");

describe("type files (W12.T1)", () => {
  it("a type id comes from the file name under .lumen/types", () => {
    expect(typeIdFromPath(".lumen/types/book.yaml")).toBe("book");
    expect(typeIdFromPath(".lumen/types/Book.yml")).toBe("book");
    expect(typeIdFromPath(".lumen/types/ספר.yaml")).toBe("ספר");
    expect(typeIdFromPath("notes/book.yaml")).toBeNull();
    expect(typeIdFromPath(".lumen/types/sub/book.yaml")).toBeNull();
  });
  it("reads labels in Hebrew and English, tag, parent and fields in file order", () => {
    const p = parseTypeFile(BOOK.path, BOOK.text);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.type.label).toEqual({ he: "ספר", en: "Book" });
    expect(p.type.tag).toBe("book");
    expect(p.type.extends).toBe("work");
    expect(names(p.type.fields)).toEqual(["author", "pages", "status", "ppu"]);
  });
  it.each([
    ["text", "text"],
    ["number", "number"],
    ["date", "date"],
    ["hebrew-date", "hebrew-date"],
    ["select", "select"],
    ["multi-select", "multi-select"],
    ["checkbox", "checkbox"],
    ["url", "url"],
    ["boolean", "checkbox"],
    ["list", "multi-select"],
  ])("field kind %s reads as %s", (written, kind) => {
    const p = parseTypeFile(".lumen/types/x.yaml", `fields:\n  f: { type: ${written}, options: [a] }\n`);
    expect(p.ok && p.type.fields[0].kind).toBe(kind);
  });
  it("relation needs a target type; formula is checked by the Bases parser at load", () => {
    expect(parseTypeFile(".lumen/types/x.yaml", "fields:\n  a: relation\n")).toMatchObject({ ok: false, error: expect.stringMatching(/needs to:/) });
    expect(parseTypeFile(".lumen/types/x.yaml", "fields:\n  f: { type: formula, formula: 'price *' }\n")).toMatchObject({ ok: false });
    expect(parseTypeFile(".lumen/types/x.yaml", "fields:\n  f: { type: formula, formula: 'price * 2' }\n").ok).toBe(true);
  });
  it("an unknown kind, a duplicate field and a reserved key are errors", () => {
    expect(parseTypeFile(".lumen/types/x.yaml", "fields:\n  a: colour\n")).toMatchObject({ ok: false, error: expect.stringMatching(/unknown field type/) });
    expect(parseTypeFile(".lumen/types/x.yaml", "fields:\n  - { name: a, type: text }\n  - { name: A, type: number }\n")).toMatchObject({ ok: false, error: expect.stringMatching(/twice/) });
    for (const k of ["type", "tags", "aliases"]) expect(parseTypeFile(".lumen/types/x.yaml", `fields:\n  ${k}: text\n`)).toMatchObject({ ok: false, error: expect.stringMatching(/reserved/) });
  });
  it("extends takes exactly one parent, never itself", () => {
    expect(parseTypeFile(".lumen/types/x.yaml", "extends: [a, b]\n")).toMatchObject({ ok: false, error: expect.stringMatching(/one parent/) });
    expect(parseTypeFile(".lumen/types/x.yaml", "extends: [a]\n")).toMatchObject({ ok: true, type: { extends: "a" } });
    expect(parseTypeFile(".lumen/types/x.yaml", "extends: x\n")).toMatchObject({ ok: false, error: expect.stringMatching(/itself/) });
  });
  it("broken YAML is an error for that file, and the other types still load", () => {
    const r = reg(WORK, file("bad", "fields: [\n"));
    expect(r.errors.some((e) => e.includes("bad.yaml"))).toBe(true);
    expect([...r.types.keys()]).toEqual(["work"]);
  });
  it("typeToYaml writes a file that reads back to the same type", () => {
    const t = def("book", YAML.parse(BOOK.text));
    const back = parseTypeFile(BOOK.path, typeToYaml(t));
    expect(back.ok && back.type.fields).toEqual(t.fields);
  });
});

describe("inheritance: one parent, like Tana's Extend (W12.T1)", () => {
  const r = reg(WORK, BOOK, PERSON);
  it("a child has the parent's fields first, in order, then its own", () => {
    expect(names(r.get("book")!.effective)).toEqual(["title", "year", "status", "author", "pages", "ppu"]);
    expect(r.get("book")!.chain).toEqual(["book", "work"]);
  });
  it("a child may change an inherited default; the parent keeps its own", () => {
    expect(r.get("book")!.effective.find((f) => f.name === "status")!.default).toBe("done");
    expect(r.get("work")!.effective.find((f) => f.name === "status")!.default).toBe("draft");
  });
  it("an override keeps the inherited options and pinning", () => {
    const s = r.get("book")!.effective.find((f) => f.name === "status")!;
    expect(s.options).toEqual(["draft", "done"]);
    expect(r.get("book")!.effective.find((f) => f.name === "title")!.pinned).toBe(true);
  });
  it("declaredBy says where each field came from", () => {
    expect(r.get("book")!.declaredBy).toMatchObject({ title: "work", status: "work", author: "book" });
  });
  it("an inherited field cannot be removed: an error, and the field stays", () => {
    const r2 = reg(WORK, file("novel", "extends: work\nfields:\n  year: null\n"));
    expect(r2.get("novel")!.errors.join()).toMatch(/cannot be removed/);
    expect(names(r2.get("novel")!.effective)).toContain("year");
  });
  it("remove: true is the same as null", () => {
    const r2 = reg(WORK, file("novel", "extends: work\nfields:\n  year: { remove: true }\n"));
    expect(r2.get("novel")!.errors.join()).toMatch(/cannot be removed/);
  });
  it("a child cannot change an inherited field's kind", () => {
    const r2 = reg(WORK, file("novel", "extends: work\nfields:\n  year: text\n"));
    expect(r2.get("novel")!.errors.join()).toMatch(/cannot change it to text/);
    expect(r2.get("novel")!.effective.find((f) => f.name === "year")!.kind).toBe("number");
  });
  it("a child cannot point an inherited relation at another type", () => {
    const r2 = reg(BOOK, WORK, PERSON, file("org", "fields: {}\n"), file("ebook", "extends: book\nfields:\n  author: { type: relation, to: org }\n"));
    expect(r2.get("ebook")!.errors.join()).toMatch(/cannot point it at org/);
    expect(r2.get("ebook")!.effective.find((f) => f.name === "author")!.to).toBe("person");
  });
  it("three levels: grandchild inherits through the parent", () => {
    const r2 = reg(WORK, BOOK, PERSON, file("novel", "extends: book\nfields:\n  genre: text\n"));
    expect(r2.get("novel")!.chain).toEqual(["novel", "book", "work"]);
    expect(names(r2.get("novel")!.effective)).toEqual(["title", "year", "status", "author", "pages", "ppu", "genre"]);
    expect(r2.descendants("work").sort()).toEqual(["book", "novel"]);
  });
  it("field names are matched without case for overrides", () => {
    const r2 = reg(WORK, file("novel", "extends: work\nfields:\n  Year: { type: number, default: 2000 }\n"));
    expect(r2.get("novel")!.effective.filter((f) => f.name.toLowerCase() === "year")).toHaveLength(1);
    expect(r2.get("novel")!.effective.find((f) => f.name === "year")!.default).toBe(2000);
  });
  it("a cycle is reported and its parent link ignored, without hanging", () => {
    const r2 = reg(file("a", "extends: b\nfields:\n  x: text\n"), file("b", "extends: a\nfields:\n  y: text\n"));
    expect([...r2.types.values()].flatMap((t) => t.errors).join()).toMatch(/cycle/);
    expect(r2.get("a")!.chain.length + r2.get("b")!.chain.length).toBeLessThanOrEqual(3);
  });
  it("a parent that does not exist is reported; the child loads with its own fields", () => {
    const r2 = reg(file("novel", "extends: gone\nfields:\n  genre: text\n"));
    expect(r2.get("novel")!.errors.join()).toMatch(/unknown type 'gone'/);
    expect(names(r2.get("novel")!.effective)).toEqual(["genre"]);
  });
  it("removing a field the parent never had is a notice, not an error", () => {
    const r2 = reg(WORK, file("novel", "extends: work\nfields:\n  colour: null\n"));
    expect(r2.get("novel")!.errors).toEqual([]);
    expect(r2.notices.join()).toMatch(/removes nothing/);
  });
});

describe("name collisions (W12.T1)", () => {
  it("the same id twice: the first by path is used, the other reported", () => {
    const r = buildTypeRegistry([def("book", { fields: { a: "text" } }), { ...def("book", { fields: { b: "text" } }), source: ".lumen/types/book.yml" }]);
    expect(r.errors.join()).toMatch(/declared twice/);
    expect(names(r.get("book")!.effective)).toEqual(["a"]);
  });
  it("a vault type replaces a built-in one of the same id (W12.E1 entity types)", () => {
    const builtin = { ...def("person", { label: { he: "אדם" }, fields: { born: "date" } }, "builtin"), source: "builtin:entities" };
    const r = loadTypeRegistry([file("person", "fields:\n  born: date\n  died: date\n")], [builtin]);
    expect(names(r.get("person")!.effective)).toEqual(["born", "died"]);
    expect(r.notices.join()).toMatch(/replaces the built-in/);
    expect(r.errors).toEqual([]);
  });
  it("built-in types alone work, so other features can ship types in code", () => {
    const r = buildTypeRegistry([def("place", { label: { he: "מקום", en: "Place" }, fields: { coords: "text" } }, "builtin")]);
    expect(typesOfNote(r, { fm: { type: "מקום" } }).types.map((t) => t.id)).toEqual(["place"]);
  });
  it("a label two types share names neither, and says so", () => {
    const r = reg(file("a", "label: { he: ספר }\n"), file("b", "label: { he: ספר }\n"));
    expect(r.resolveName("ספר")).toBeNull();
    expect(r.errors.join()).toMatch(/names two types/);
    expect(r.resolveName("a")).toBe("a");
  });
  it("an id wins over another type's label", () => {
    const r = reg(file("book", "fields: {}\n"), file("tome", "label: { en: book }\n"));
    expect(r.resolveName("Book")).toBe("book");
  });
  it("a tag two types share is reported, and the note gets both types (nothing hidden)", () => {
    const r = reg(file("a", "tag: x\n"), file("b", "tag: x\n"));
    expect(r.errors.join()).toMatch(/activates two types/);
    expect(typesOfNote(r, { fm: {}, tags: ["x"] }).types.map((t) => t.id)).toEqual(["a", "b"]);
  });
  it("a relation to a type that does not exist is an error on the type", () => {
    const r = reg(file("a", "fields:\n  who: { type: relation, to: nobody }\n"));
    expect(r.get("a")!.errors.join()).toMatch(/unknown type 'nobody'/);
  });
});

describe("a note's types (W12.T1)", () => {
  const r = reg(WORK, BOOK, PERSON);
  it.each([
    [{ type: "book" }, [], ["book"]],
    [{ type: "Book" }, [], ["book"]],
    [{ type: "ספר" }, [], ["book"]],
    [{ type: "[[book]]" }, [], ["book"]],
    [{ type: ["book", "person"] }, [], ["book", "person"]],
    [{}, ["book"], ["book"]],
    [{}, ["book/novel"], ["book"]],
    [{}, ["bookish"], []],
    [{ type: "book" }, ["book"], ["book"]],
    [{ type: "person" }, ["book"], ["person", "book"]],
  ])("frontmatter %j with tags %j has types %j", (fm, tags, want) => {
    expect(typesOfNote(r, { fm, tags }).types.map((t) => t.id)).toEqual(want);
  });
  it("a deleted type: the name is reported as unknown and no key is touched", () => {
    const fm = { type: "magazine", issue: 4 };
    const t = typesOfNote(r, { fm });
    expect(t.types).toEqual([]);
    expect(t.unknown).toEqual(["magazine"]);
    expect(fm).toEqual({ type: "magazine", issue: 4 });
    expect(fieldsOfNote(r, { fm }).fields).toEqual([]);
    expect(checkNote(r, { fm })).toEqual([]);
  });
  it("a deleted parent leaves the child's own fields working", () => {
    const r2 = reg(BOOK, PERSON);
    expect(names(fieldsOfNote(r2, { fm: { type: "book" } }).fields)).toEqual(["author", "pages", "status", "ppu"]);
  });
  it("noteIsA follows the parent chain", () => {
    expect(noteIsA(r, { fm: { type: "book" } }, "work")).toBe(true);
    expect(noteIsA(r, { fm: { type: "work" } }, "book")).toBe(false);
    expect(noteIsA(r, { fm: {}, tags: ["person"] }, "person")).toBe(true);
  });
});

describe("a note with two types (W12.T1)", () => {
  const r = reg(WORK, BOOK, PERSON, file("course", "fields:\n  year: { type: text }\n  credits: number\n"));
  it("gets every field of both, each name once, in type order", () => {
    expect(names(fieldsOfNote(r, { fm: { type: ["book", "person"] } }).fields)).toEqual(["title", "year", "status", "author", "pages", "ppu", "born", "site", "alive"]);
  });
  it("each field says which type it came through", () => {
    const f = fieldsOfNote(r, { fm: { type: ["book", "person"] } }).fields;
    expect(f.find((x) => x.name === "born")!.via).toBe("person");
    expect(f.find((x) => x.name === "title")!.via).toBe("book");
  });
  it("the same name with two kinds is a conflict: the first type wins, the other is reported", () => {
    const n = fieldsOfNote(r, { fm: { type: ["book", "course"] } });
    expect(n.fields.find((f) => f.name === "year")!.kind).toBe("number");
    expect(n.conflicts).toEqual([{ field: "year", kept: { type: "book", kind: "number" }, dropped: { type: "course", kind: "text" } }]);
  });
  it("the order of type: decides which wins", () => {
    expect(fieldsOfNote(r, { fm: { type: ["course", "book"] } }).fields.find((f) => f.name === "year")!.kind).toBe("text");
  });
  it("the same name with the same kind is no conflict", () => {
    const r2 = reg(file("a", "fields:\n  n: number\n"), file("b", "fields:\n  n: number\n"));
    expect(fieldsOfNote(r2, { fm: { type: ["a", "b"] } }).conflicts).toEqual([]);
  });
});

describe("field values are checked, never changed (W12.T1/T2)", () => {
  const f = (kind: FieldDef["kind"], extra: Partial<FieldDef> = {}): FieldDef => ({ name: "f", kind, pinned: false, ...extra });
  it.each([
    [f("number"), 3, true],
    [f("number"), "3", false],
    [f("text"), "x", true],
    [f("text"), ["x"], false],
    [f("checkbox"), true, true],
    [f("checkbox"), "yes", false],
    [f("date"), "2026-11-15", true],
    [f("date"), "2026-02-30", false],
    [f("hebrew-date"), "2026-11-15", true],
    [f("hebrew-date"), "כ״ד בחשוון", false],
    [f("url"), "https://example.org/a", true],
    [f("url"), "javascript:alert(1)", false],
    [f("select", { options: ["a", "b"] }), "a", true],
    [f("select", { options: ["a", "b"] }), "c", false],
    [f("multi-select", { options: ["a", "b"] }), ["a", "b"], true],
    [f("multi-select", { options: ["a", "b"] }), "a", false],
    [f("relation", { to: "person" }), "[[Ada]]", true],
    [f("relation", { to: "person" }), "Ada", false],
    [f("relation", { to: "person", multiple: true }), ["[[Ada]]", "[[Bob]]"], true],
    [f("number"), null, true],
    [f("formula", { formula: "1" }), 5, false],
  ])("%j with %j fits: %s", (field, value, fits) => {
    expect(checkFieldValue(field, value) === null).toBe(fits);
  });
  it("checkNote marks a wrong value and leaves the frontmatter as it was", () => {
    const r = reg(WORK, BOOK, PERSON);
    const fm = { type: "book", pages: "many", status: "lost" };
    const before = structuredClone(fm);
    expect(checkNote(r, { fm }).map((p) => [p.field, p.code])).toEqual([
      ["status", "option"],
      ["pages", "kind"],
    ]);
    expect(fm).toEqual(before);
  });
  it("relationTargetOk accepts only notes of the target type (or its children)", () => {
    const r = reg(WORK, BOOK, PERSON, file("author", "extends: person\n"));
    const field = r.get("book")!.effective.find((x) => x.name === "author")!;
    expect(relationTargetOk(r, field, { fm: { type: "person" } })).toBe(true);
    expect(relationTargetOk(r, field, { fm: { type: "author" } })).toBe(true);
    expect(relationTargetOk(r, field, { fm: { type: "book" } })).toBe(false);
    expect(relationTargetOk(r, field, null)).toBe(false);
  });
});

describe("new notes of a type (W12.T1 → T2/T4)", () => {
  const r = reg(WORK, BOOK, PERSON);
  it("defaults: type, then every stored field; computed fields are not stored", () => {
    expect(defaultsOf(r, "book")).toEqual({ type: "book", title: null, year: null, status: "done", author: null, pages: 0 });
  });
  it("newObjectText refuses a value that does not fit, and a key the type lacks", () => {
    const bad = newObjectText(r, "book", { values: { pages: "lots", colour: "red" } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.map((p) => p.field)).toEqual(["pages", "colour"]);
  });
  it("newObjectText writes everything into the frontmatter, and only there", () => {
    const ok = newObjectText(r, "book", { values: { title: "Dune", author: "[[Frank Herbert]]", pages: 412 }, body: "# Dune\n" });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const props = Object.fromEntries(readProperties(ok.text).map((p) => [p.key, p.value]));
    expect(props).toMatchObject({ type: "book", title: "Dune", author: "[[Frank Herbert]]", pages: 412, status: "done" });
    const body = ok.text.slice(ok.text.indexOf("---", 3) + 4);
    expect(body).toBe("\n# Dune\n");
    expect(basesFileFromText("b.md", ok.text).fm).toMatchObject({ type: "book", pages: 412 });
  });
});

/* ─── 200 typed notes: open → save byte-identical (the W11.P3 path) ───── */

/** SYNTHETIC test notes, generated here (not real data): typed by `type:`, by tag, by both, with Hebrew, CRLF and BOM. */
function syntheticTypedNotes(n: number): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (let i = 0; i < n; i++) {
    const eol = i % 7 === 0 ? "\r\n" : "\n";
    const bom = i % 11 === 0 ? "﻿" : "";
    const kind = i % 4;
    const fm =
      kind === 0
        ? [`type: book`, `title: "ספר ${i}"`, `author: "[[אדם ${i % 80}]]"`, `pages: ${100 + i}`, `status: done  # הערה`]
        : kind === 1
          ? [`tags: [person]`, `born: 19${10 + (i % 80)}-0${1 + (i % 9)}-1${i % 9}`, `site: 'https://example.org/${i}'`, `alive: ${i % 2 === 0}`]
          : kind === 2
            ? [`type:`, `  - book`, `  - person`, `title: Dune ${i}`, `year: ${1960 + (i % 60)}`, `pages: "wrong ${i}"`]
            : [`type: magazine`, `issue: ${i}`, `extra:`, `  nested: { a: 1, b: [x, y] }`];
    out.push({ path: `notes/n${i}.md`, text: `${bom}---${eol}${fm.join(eol)}${eol}---${eol}${eol}# כותרת ${i}${eol}${eol}גוף עם [[קישור ${i}]] ו-#tag${i}.${eol}` });
  }
  return out;
}

describe("200 typed notes stay byte-identical through open → save (W12.T1)", () => {
  const r = reg(WORK, BOOK, PERSON);
  const notes = syntheticTypedNotes(200);
  const enc = new TextEncoder();
  const throughEditor = (t: string) => {
    const { body, envelope } = splitTextEnvelope(t);
    return joinTextEnvelope(body.replace(/\r\n|\r/g, "\n"), envelope);
  };
  it("the set is typed the way it says (every kind of activation is in it)", () => {
    const counts = { typed: 0, unknown: 0, two: 0 };
    for (const n of notes) {
      const f = basesFileFromText(n.path, n.text.replace(/^﻿/, ""));
      const t = typesOfNote(r, f);
      if (t.types.length) counts.typed++;
      if (t.unknown.length) counts.unknown++;
      if (t.types.length === 2) counts.two++;
    }
    expect(counts).toEqual({ typed: 150, unknown: 50, two: 50 });
  });
  it("resolving types, fields and problems, then saving, changes 0 bytes in 200 notes", () => {
    let differ = 0;
    let problems = 0;
    for (const n of notes) {
      const bytes = enc.encode(n.text);
      const f = basesFileFromText(n.path, n.text.replace(/^﻿/, ""));
      fieldsOfNote(r, f);
      problems += checkNote(r, f).length;
      const saved = enc.encode(throughEditor(n.text));
      if (saved.length !== bytes.length || saved.some((b, i) => b !== bytes[i])) differ++;
    }
    expect(differ).toBe(0);
    // The wrong `pages` values are marked (50 notes), not repaired.
    expect(problems).toBe(50);
  });
  it("writing each typed field's own value back (the form saved without edits) changes 0 bytes", () => {
    let differ = 0;
    for (const n of notes) {
      const { body } = splitTextEnvelope(n.text);
      const text = body.replace(/\r\n|\r/g, "\n");
      const f = basesFileFromText(n.path, text);
      let after = text;
      for (const field of fieldsOfNote(r, f).fields) {
        const p = readProperties(after).find((x) => x.key === field.name);
        if (p) after = setProperty(after, field.name, p.value as PropertyValue);
      }
      if (after !== text) differ++;
    }
    expect(differ).toBe(0);
  });
  it("no type field is kept outside the frontmatter: the resolver reads only fm and tags, and mutates neither", () => {
    expect(Object.keys(r).filter((k) => /write|save|store|put/i.test(k))).toEqual([]);
    const deepFreeze = <T>(o: T): T => {
      if (o && typeof o === "object") {
        Object.values(o as object).forEach(deepFreeze);
        Object.freeze(o);
      }
      return o;
    };
    const read = new Set<string>();
    for (const n of notes) {
      const f = basesFileFromText(n.path, n.text.replace(/^﻿/, ""));
      const note = new Proxy({ fm: deepFreeze(f.fm), tags: deepFreeze(f.tags) }, { get: (t, k) => (read.add(String(k)), (t as Record<string | symbol, unknown>)[k]) });
      expect(() => {
        typesOfNote(r, note);
        fieldsOfNote(r, note);
        checkNote(r, note);
      }).not.toThrow();
    }
    expect([...read].sort()).toEqual(["fm", "tags"]);
  });
});
