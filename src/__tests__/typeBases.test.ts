/**
 * Plan W12.T3 — a Base for every type (table, cards, kanban from the
 * schema; "Save as .base"; the schema drives the virtual base, a saved file
 * changes only on approval) — and W12.T6 — typed relations (relation→type,
 * a computed reverse) and rollups over the other side.
 *
 * All vaults here are SYNTHETIC, generated in this file and labelled so:
 * the T6 vault is 200 books and 80 people, as the plan asks, and every
 * rollup is checked against a calculation written separately in the test.
 * Opening the saved .base in Obsidian 1.15.1 is W12.M2 (Mac).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { loadTypeRegistry } from "../types/typeRegistry";
import { inverseRelations, runTypeBase, saveTypeBase, savedBaseUpdate, typeBaseModel, typeBasePath, typeBaseProblems, typeBaseText, typeFilter } from "../types/typeBase";
import { basesFileFromText, parseBase, runBase } from "../views/bases/base";
import { tableKeyMove } from "../views/bases/viewsData";
import { rewriteLinks } from "../storage/linkRewrite";
import { toText, type BasesFile, type BValue } from "../views/bases/values";

const T = (id: string, yaml: string) => ({ path: `.lumen/types/${id}.yaml`, text: yaml });
const WORK = T("work", "label: { he: יצירה, en: Work }\nfields:\n  title: { type: text, pinned: true }\n");
const BOOK = T(
  "book",
  [
    "label: { he: ספר, en: Book }",
    "tag: book",
    "extends: work",
    "fields:",
    "  author: { type: relation, to: person, pinned: true, inverse: books, label: { he: מחבר } }",
    "  status: { type: select, options: [to-read, reading, done], pinned: true }",
    "  pages: { type: number }",
    "  published: date",
    "  due: date",
    "  price: number",
    "  cover: url",
    "  ppu: { type: formula, formula: 'price / pages' }",
  ].join("\n") + "\n",
);
const NOVEL = T("novel", "label: { he: רומן }\nextends: book\nfields:\n  genre: text\n");
const ARTICLE = T("article", "fields:\n  author: { type: relation, to: person }\n  pages: number\n");
const PERSON = T(
  "person",
  [
    "label: { he: אדם, en: Person }",
    "fields:",
    "  born: date",
    "  book_count: { type: rollup, relation: books, function: count, pinned: true }",
    "  pages_sum: { type: rollup, relation: books, property: pages, function: sum }",
    "  pages_avg: { type: rollup, relation: books, property: pages, function: avg }",
    "  pages_min: { type: rollup, relation: books, property: pages, function: min }",
    "  pages_max: { type: rollup, relation: books, property: pages, function: max }",
    "  first_pub: { type: rollup, relation: books, property: published, function: earliest }",
    "  last_pub: { type: rollup, relation: books, property: published, function: latest }",
    "  next_due: { type: rollup, relation: books, property: due, function: workdays }",
  ].join("\n") + "\n",
);
const TYPES = [WORK, BOOK, NOVEL, ARTICLE, PERSON];
const reg = loadTypeRegistry(TYPES);

/* ─── The SYNTHETIC vault for W12.T6: 200 books, 80 people (+ articles that must not count) ─── */

const iso = (d: Date) => d.toISOString().slice(0, 10);
interface Book {
  path: string;
  author: number;
  pages: number;
  published: string;
  due: string;
  novel: boolean;
}
function syntheticLibrary() {
  const files: Array<{ path: string; text: string }> = [];
  const books: Book[] = [];
  for (let p = 0; p < 80; p++) files.push({ path: `people/אדם ${p}.md`, text: `---\ntype: person\nborn: ${1900 + p}-01-0${1 + (p % 9)}\n---\n# אדם ${p}\n` });
  for (let i = 0; i < 200; i++) {
    // People 70–79 get no books (their rollups are empty); the rest 1–5 books.
    const author = (i * 7) % 70;
    const pages = 50 + ((i * 37) % 600);
    const published = iso(new Date(Date.UTC(1950 + (i % 70), i % 12, 1 + (i % 27))));
    // Due dates from 16 Nov to 31 Dec 2026: no rest day of the Hebrew calendar falls in it.
    const due = iso(new Date(Date.UTC(2026, 10, 16 + (i % 45))));
    const novel = i % 5 === 0;
    const path = `books/ספר ${i}.md`;
    books.push({ path, author, pages, published, due, novel });
    const typeLine = novel ? "type: novel" : i % 2 ? "type: book" : "tags: [book]";
    files.push({ path, text: `---\n${typeLine}\ntitle: ספר ${i}\nauthor: "[[אדם ${author}]]"\nstatus: ${["to-read", "reading", "done"][i % 3]}\npages: ${pages}\npublished: ${published}\ndue: ${due}\nprice: ${10 + (i % 30)}\n---\n` });
  }
  // Articles link people with the same `author:` key: a typed reverse relation must leave them out.
  for (let a = 0; a < 30; a++) files.push({ path: `articles/מאמר ${a}.md`, text: `---\ntype: article\nauthor: "[[אדם ${a % 10}]]"\npages: 9999\n---\n` });
  return { files, books };
}
const lib = syntheticLibrary();
const vault: BasesFile[] = lib.files.map((f) => basesFileFromText(f.path, f.text));
const NOW = new Date(Date.UTC(2026, 10, 15, 9));

/** Working days after 15 Nov 2026 up to and including `to`, Sunday–Thursday — counted here, not by the app. */
function workdaysIndependent(to: string): number {
  let n = 0;
  for (let d = new Date(Date.UTC(2026, 10, 16)); iso(d) <= to; d = new Date(d.getTime() + 86_400_000)) if (d.getUTCDay() <= 4) n++;
  return n;
}

describe("the virtual base of a type (W12.T3)", () => {
  const base = YAML.parse(typeBaseText(reg, "book", { lang: "he" }));
  it("is a .base the Bases parser reads, with table, cards and kanban views", () => {
    const p = parseBase(typeBaseText(reg, "book"));
    expect(p.ok).toBe(true);
    expect(base.views.map((v: { type: string }) => v.type)).toEqual(["table", "cards", "kanban"]);
    expect(base.views[0].name).toBe("כל הספר");
  });
  it("columns: the name, then the pinned fields (inherited first)", () => {
    expect(base.views[0].order).toEqual(["file.name", "note.title", "note.author", "note.status"]);
  });
  it("kanban groups by the first select field, with its options as columns and a None column", () => {
    expect(base.views[2].groupBy).toEqual({ property: "note.status", direction: "ASC" });
    expect(base.views[2].groupOrder).toEqual(["to-read", "reading", "done", null]);
  });
  it("cards use a cover field as the image", () => {
    expect(base.views[1].image).toBe("note.cover");
  });
  it("formula fields become the base's formulas; labels its display names", () => {
    expect(base.formulas).toEqual({ ppu: "price / pages" });
    expect(base.properties["note.author"]).toEqual({ displayName: "מחבר" });
  });
  it("a type without pinned fields shows its first five", () => {
    const r = loadTypeRegistry([T("x", "fields:\n  a: text\n  b: text\n  c: text\n  d: text\n  e: text\n  f: text\n")]);
    expect(typeBaseModel(r, "x").views[0].order).toEqual(["file.name", "note.a", "note.b", "note.c", "note.d", "note.e"]);
  });
  it("no select field: no kanban view", () => {
    expect(typeBaseModel(reg, "person").views.map((v) => v.type)).toEqual(["table", "cards"]);
  });
  it("the filter covers the type, its child types, every label and the tag", () => {
    expect(typeFilter(reg, "book")).toEqual({ or: ['list(note.type).containsAny("book", "ספר", "Book", "novel", "רומן")', 'file.hasTag("book")'] });
  });
  it("the saved file's own filter finds the same notes as the registry (canonical type: values)", () => {
    const viaFile = runBase(typeBaseModel(reg, "book"), vault).rows.map((r) => r.file.path).sort();
    const viaRegistry = runTypeBase(reg, "book", vault).rows.map((r) => r.file.path).sort();
    expect(viaFile).toEqual(viaRegistry);
    expect(viaFile).toHaveLength(200);
  });
  it("in the app the registry chooses the notes, so `[[book]]` and other spellings count too", () => {
    const odd = [...vault, basesFileFromText("odd.md", "---\ntype: \"[[Book]]\"\n---\n")];
    expect(runTypeBase(reg, "book", odd).rows.map((r) => r.file.path)).toContain("odd.md");
  });
  it("Save as .base: the name of the type, at the vault root", () => {
    expect(typeBasePath(reg, "book", { lang: "he" })).toBe("ספר.base");
    expect(typeBasePath(reg, "book", { lang: "en" })).toBe("Book.base");
  });
});

describe("schema changes and the saved .base (W12.T3)", () => {
  it("a schema change changes the virtual base at once", () => {
    const before = typeBaseText(reg, "book");
    const r2 = loadTypeRegistry([WORK, { ...BOOK, text: BOOK.text.replace("pages: { type: number }", "pages: { type: number, pinned: true }") }, PERSON]);
    expect(typeBaseText(r2, "book")).not.toBe(before);
    expect(typeBaseModel(r2, "book").views[0].order).toContain("note.pages");
  });
  it("a saved file that is current needs nothing; after a change the new text is only proposed", () => {
    const saved = typeBaseText(reg, "book");
    expect(savedBaseUpdate(saved, reg, "book")).toBeNull();
    const r2 = loadTypeRegistry([WORK, { ...BOOK, text: BOOK.text.replace("tag: book", "tag: books") }, PERSON]);
    const next = savedBaseUpdate(saved, r2, "book");
    expect(next).toContain('file.hasTag("books")');
    expect(saved).toContain('file.hasTag("book")');
  });
  it("Save as .base writes a new file without asking, and an existing different file only on approval", async () => {
    const disk = new Map<string, string>();
    const asked: string[] = [];
    const deps = (answer: boolean) => ({
      read: async (p: string) => {
        if (!disk.has(p)) throw new Error("ENOENT");
        return disk.get(p)!;
      },
      write: async (p: string, t: string) => void disk.set(p, t),
      confirm: async (m: string) => (asked.push(m), answer),
    });
    expect(await saveTypeBase("A", "ספר.base", deps(false))).toBe("ספר.base");
    expect(asked).toHaveLength(0);
    expect(await saveTypeBase("B", "ספר.base", deps(false))).toBeNull();
    expect(disk.get("ספר.base")).toBe("A");
    expect(await saveTypeBase("B", "ספר.base", deps(true))).toBe("ספר.base");
    expect(disk.get("ספר.base")).toBe("B");
    expect(asked).toHaveLength(2);
  });
});

describe("a type with 1,000 notes in a 10,000-note vault opens in < 300 ms (W12.T3)", () => {
  // SYNTHETIC 10k vault (the W11.Q1 vault is generated the same way on the Mac; this one is built here).
  const big: BasesFile[] = [];
  for (let i = 0; i < 10_000; i++) {
    const typed = i % 10 === 0;
    big.push(basesFileFromText(`v/n${i}.md`, typed ? `---\ntype: book\ntitle: T${i}\nauthor: "[[p${i % 300}]]"\nstatus: done\npages: ${i % 500}\n---\nbody ${i}\n` : `---\ntitle: N${i}\n---\nbody [[n${i - 1}]]\n`));
  }
  it("runs the table view of 1,000 typed notes (median of 3 runs)", () => {
    const times: number[] = [];
    let rows = 0;
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      rows = runTypeBase(reg, "book", big).rows.length;
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(rows).toBe(1000);
    expect(times[1], `median ${times[1].toFixed(1)} ms (runs: ${times.map((x) => x.toFixed(0)).join(", ")})`).toBeLessThan(300);
  });
});

describe("table keyboard navigation in RTL, as Obsidian 1.14 (W12.T3)", () => {
  const size = { rows: 5, cols: 4 };
  it.each([
    ["ArrowLeft", true, { row: 2, col: 1 }, { row: 2, col: 2 }],
    ["ArrowRight", true, { row: 2, col: 1 }, { row: 2, col: 0 }],
    ["ArrowLeft", false, { row: 2, col: 1 }, { row: 2, col: 0 }],
    ["ArrowRight", false, { row: 2, col: 1 }, { row: 2, col: 2 }],
    ["ArrowDown", true, { row: 4, col: 1 }, { row: 4, col: 1 }],
    ["ArrowUp", true, { row: 0, col: 1 }, { row: 0, col: 1 }],
    ["Home", true, { row: 3, col: 3 }, { row: 3, col: 0 }],
    ["End", true, { row: 3, col: 0 }, { row: 3, col: 3 }],
    ["PageDown", true, { row: 0, col: 2 }, { row: 4, col: 2 }],
  ])("%s (rtl %s) from %j goes to %j", (key, rtl, at, want) => {
    expect(tableKeyMove(key, { rtl }, at, size)).toEqual(want);
  });
  it("Ctrl+Home / Ctrl+End go to the table's first / last cell; other keys are not moves", () => {
    expect(tableKeyMove("Home", { ctrl: true }, { row: 3, col: 2 }, size)).toEqual({ row: 0, col: 0 });
    expect(tableKeyMove("End", { ctrl: true }, { row: 0, col: 0 }, size)).toEqual({ row: 4, col: 3 });
    expect(tableKeyMove("a", {}, { row: 0, col: 0 }, size)).toBeNull();
  });
});

/* ─── W12.T6: typed relations and rollups ─────────────────────────────── */

const cell = (r: { cells: Record<string, BValue> }, id: string) => r.cells[id];
const num = (v: BValue) => (typeof v === "number" ? v : v === null ? null : Number(toText(v)));
const day = (v: BValue) => (v === null ? null : toText(v).slice(0, 10));

describe("typed relations (W12.T6)", () => {
  it("the reverse of book.author → person is `books` on person, computed (incoming), filtered to books", () => {
    expect(inverseRelations(reg, "person")).toEqual([
      { name: "article_author", fromType: "article", field: "author", stored: false },
      { name: "books", fromType: "book", field: "author", stored: false, label: { he: "מחבר" } },
    ]);
    const model = typeBaseModel(reg, "person");
    expect(model.relations.books).toMatchObject({ property: "author", incoming: true });
    expect(model.relations.books.filter).toEqual(typeFilter(reg, "book"));
  });
  it("an inherited relation (novel.author) is listed once, under the type that declared it", () => {
    expect(inverseRelations(reg, "person").filter((i) => i.field === "author" && i.fromType !== "article")).toHaveLength(1);
  });
  it("the reverse is never written: running the person base changes no file", () => {
    const before = JSON.stringify(vault.map((f) => f.fm));
    runTypeBase(reg, "person", vault, { now: NOW });
    expect(JSON.stringify(vault.map((f) => f.fm))).toBe(before);
  });
  it("twoWay makes the reverse a stored field of the target type", () => {
    const r2 = loadTypeRegistry([{ ...BOOK, text: BOOK.text.replace("inverse: books,", "inverse: books, twoWay: true,") }, WORK, PERSON]);
    expect(inverseRelations(r2, "person").find((i) => i.name === "books")).toMatchObject({ stored: true });
    expect(typeBaseModel(r2, "person").relations.books).toMatchObject({ property: "books", incoming: false });
  });
  it("articles that link a person with the same key are not among the person's books", () => {
    const rows = runTypeBase(reg, "person", vault, { now: NOW }).rows;
    const p0 = rows.find((r) => r.file.basename === "אדם 0")!;
    const want = lib.books.filter((b) => b.author === 0).length;
    expect(num(cell(p0, "rollup.book_count"))).toBe(want);
    expect((cell(p0, "relation.article_author") as BValue[]).length).toBe(3);
  });
  it("a rollup over a relation the type does not have is reported", () => {
    const r2 = loadTypeRegistry([T("x", "fields:\n  n: { type: rollup, relation: nothing, function: count }\n")]);
    expect(typeBaseProblems(r2, "x").join()).toMatch(/no relation 'nothing'/);
  });
});

describe("rollups on 200 books × 80 people, against an independent calculation (W12.T6)", () => {
  const rows = runTypeBase(reg, "person", vault, { now: NOW }).rows;
  const byPerson = new Map(rows.map((r) => [Number(r.file.basename.replace("אדם ", "")), r]));
  const expected = (p: number) => {
    const mine = lib.books.filter((b) => b.author === p);
    const pages = mine.map((b) => b.pages);
    const pub = mine.map((b) => b.published).sort();
    const due = mine.map((b) => b.due).sort();
    return {
      count: mine.length,
      sum: mine.length ? pages.reduce((a, b) => a + b, 0) : null,
      avg: mine.length ? pages.reduce((a, b) => a + b, 0) / mine.length : null,
      min: mine.length ? Math.min(...pages) : null,
      max: mine.length ? Math.max(...pages) : null,
      earliest: pub[0] ?? null,
      latest: pub[pub.length - 1] ?? null,
      workdays: due.length ? workdaysIndependent(due[0]) : null,
    };
  };
  it("80 person rows, 200 books in the vault", () => {
    expect(rows).toHaveLength(80);
    expect(lib.books).toHaveLength(200);
  });
  it.each(["count", "sum", "avg", "min", "max", "earliest", "latest", "workdays"] as const)("%s matches for all 80 people", (fn) => {
    const col = { count: "rollup.book_count", sum: "rollup.pages_sum", avg: "rollup.pages_avg", min: "rollup.pages_min", max: "rollup.pages_max", earliest: "rollup.first_pub", latest: "rollup.last_pub", workdays: "rollup.next_due" }[fn];
    const bad: string[] = [];
    for (let p = 0; p < 80; p++) {
      const want = expected(p)[fn];
      const v = cell(byPerson.get(p)!, col);
      const got = fn === "earliest" || fn === "latest" ? day(v) : num(v);
      const empty = want === null || (fn === "count" && want === 0);
      const ok = empty ? got === null || got === 0 : typeof want === "number" ? Math.abs((got as number) - want) < 1e-9 : got === want;
      if (!ok) bad.push(`${p}: want ${want}, got ${got}`);
    }
    expect(bad).toEqual([]);
  });
  it("people with no books: count 0 and sum 0 (as Notion), no average, min, max or dates", () => {
    const p = byPerson.get(75)!;
    expect(num(cell(p, "rollup.book_count"))).toBe(0);
    expect(num(cell(p, "rollup.pages_sum"))).toBe(0);
    for (const id of ["rollup.pages_avg", "rollup.pages_min", "rollup.pages_max", "rollup.first_pub", "rollup.last_pub", "rollup.next_due"]) expect(cell(p, id), id).toBeNull();
  });
});

describe("relation and rollup columns sort and filter (W12.T6)", () => {
  const model = typeBaseModel(reg, "person");
  it("relation and rollup columns are in every person view", () => {
    expect(model.views[0].order).toEqual(expect.arrayContaining(["rollup.book_count", "rollup.pages_sum", "relation.books", "relation.article_author"]));
  });
  it("sorting by a rollup column orders the people by it", () => {
    const sorted = runBase({ ...model, views: [{ ...model.views[0], sort: [{ property: "rollup.pages_sum", direction: "DESC" }] }] }, vault, { now: NOW }).rows;
    const sums = sorted.map((r) => num(r.cells["rollup.pages_sum"])).filter((x): x is number => x !== null);
    expect(sums).toEqual([...sums].sort((a, b) => b - a));
    expect(sums.length).toBe(80);
    expect(sums.slice(70)).toEqual(Array(10).fill(0));
  });
  it("a view filter on a rollup keeps only the matching people", () => {
    const res = runBase({ ...model, views: [{ ...model.views[0], filters: "rollup.book_count >= 3" }] }, vault, { now: NOW });
    const want = [...Array(80).keys()].filter((p) => lib.books.filter((b) => b.author === p).length >= 3).length;
    expect(res.rows).toHaveLength(want);
    expect(want).toBeGreaterThan(0);
  });
});

describe("renaming a person keeps the relations (linkRewrite, W12.T6)", () => {
  it("every book's author link follows the rename, and the reverse relation still counts them", () => {
    const oldPath = "people/אדם 3.md";
    const newPath = "people/אדם שלוש.md";
    const renamed = lib.files.map((f) => {
      const text = f.path.startsWith("books/") ? rewriteLinks(f.text, f.path, oldPath, newPath) : f.text;
      return basesFileFromText(f.path === oldPath ? newPath : f.path, text);
    });
    const changed = renamed.filter((f) => f.fm.author === "[[אדם שלוש]]").length;
    expect(changed).toBe(lib.books.filter((b) => b.author === 3).length);
    const row = runTypeBase(reg, "person", renamed, { now: NOW }).rows.find((r) => r.file.path === newPath)!;
    expect(num(row.cells["rollup.book_count"])).toBe(changed);
  });
});
