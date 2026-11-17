/**
 * Plan W12.T5 — Bases against Obsidian 1.14 / 1.15, by the help pages.
 * Every test names the help paragraph or changelog line it checks:
 *
 *   KANBAN  https://obsidian.md/help/bases/views/kanban
 *     §Grouping  "Files with no value for that property go into a None column."
 *     §Grouping  "If you group by a formula or by a file property other than
 *                file.folder, you cannot move cards or columns."
 *     §Moving    "Dragging a card to another column changes the grouped
 *                property in that note. Only Markdown notes can be moved."
 *     §Moving    "…grouping by file.folder, where dragging moves the file."
 *     §Settings  Image property, Image fit (Cover / Contain), Image aspect ratio.
 *   1.15.0     https://obsidian.md/changelog/2026-10-22-desktop-v1.15.0
 *              "Filters can be dragged to reorder … moving them between All
 *              views and This view."
 *
 * (The help text above is paraphrased from the pages; the URLs are the source.)
 *
 * The .base files are REAL: fixtures/obsidian-corpus (public vaults written
 * by Obsidian 1.14–1.15, MIT; manifest.json). The obsidian-help corpus
 * (W11.P3) has no .base file at its pinned commit, so it cannot be used for
 * this. The notes the views run over are SYNTHETIC, made here.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { basesFileFromText, moveFilter, parseBase, runBase, type BaseRow } from "../views/bases/base";
import { applyKanbanSet, coverOf, coverStyle, kanbanColumns, kanbanGrouping, kanbanKeyTarget, planKanbanMove } from "../views/bases/kanban";
import { filterKeyTarget, filterRows } from "../views/bases/filterRows";
import { readProperties } from "../properties/frontmatter";

const CORPUS = join(__dirname, "fixtures", "obsidian-corpus");
const real = (p: string) => readFileSync(join(CORPUS, p), "utf8");
const BOOKS = real("noat/00 Meta/Bases/Books.base");
const JOBS = real("noat/00 Meta/Bases/Job Hunt.base");
const MANIFEST = JSON.parse(readFileSync(join(CORPUS, "manifest.json"), "utf8")) as { vaults: Array<{ id: string; files: Array<{ path: string }> }> };
const REAL_BASES = MANIFEST.vaults.flatMap((vlt) => vlt.files.filter((f) => f.path.endsWith(".base")).map((f) => ({ path: `${vlt.id}/${f.path}`, text: real(`${vlt.id}/${f.path}`) })));

const parsed = (text: string) => {
  const p = parseBase(text);
  if (!p.ok) throw new Error(p.error);
  return p.base;
};
const viewOf = (text: string, type: string) => parsed(text).views.findIndex((v) => v.type === type);

/* SYNTHETIC notes for the real Books.base (status values from its groupOrder). */
const books = [
  basesFileFromText("Books/A.md", "---\ntags: [book]\nstatus: To read\ncover: https://example.org/a.jpg\n---\n"),
  basesFileFromText("Books/B.md", "---\ntags: [book]\nstatus: Reading\n---\n"),
  basesFileFromText("Books/C.md", "---\ntags: [book]\n---\n# no status\n"),
  basesFileFromText("Books/D.md", "---\ntags: [book]\nstatus: [Finished]\n---\n"),
];

describe("kanban §Grouping: the None column (W12.T5)", () => {
  const base = parsed(BOOKS);
  const v = viewOf(BOOKS, "kanban");
  it("the real Books.base lists null first in groupOrder: the None column comes first", () => {
    expect(base.views[v].groupOrder?.[0]).toBeNull();
  });
  it("a note with no status is in the None column; every listed value is a column, even an empty one", () => {
    const allNotes = books.map((b) => basesFileFromText(b.path, `---\nstatus: ${b.fm.status === undefined ? "" : JSON.stringify(b.fm.status)}\n---\n`));
    const cols = kanbanColumns(runBase({ ...base, filters: undefined, views: base.views.map((x) => ({ ...x, filters: undefined })) }, allNotes, { view: v }));
    expect(cols.map((c) => c.key)).toEqual([null, "To read", "Reading", "Finished", "Abandoned"]);
    expect(cols[4].rows).toEqual([]);
    expect(cols[0].rows.map((r) => r.file.basename)).toEqual(["C"]);
  });
  it("without groupOrder, notes with no value are still one None group (key null)", () => {
    const b = parsed("views:\n  - type: kanban\n    name: K\n    groupBy: { property: note.status, direction: ASC }\n");
    const cols = kanbanColumns(runBase(b, [basesFileFromText("x.md", "---\nstatus: a\n---\n"), basesFileFromText("y.md", "# none\n")]));
    expect(cols.map((c) => c.key)).toEqual(["a", null]);
  });
});

describe("kanban §Moving cards: a drop writes the grouped property (W12.T5)", () => {
  const row = (path: string, text: string, property = "note.status"): BaseRow => {
    const file = basesFileFromText(path, text);
    return { file, cells: { [property]: (runBase(parsed(`views:\n  - type: table\n    name: T\n    order: [${property}]\n`), [file]).rows[0]?.cells[property]) ?? null } };
  };
  const col = (key: string | null, value: unknown = key) => ({ key, value: value as never, rows: [] });
  it("a set: only the grouped key changes in the note, in the style it had", () => {
    const text = "---\ntitle: A\nstatus: To read # comment\nrating: 4\n---\n# A\n";
    const m = planKanbanMove(row("Books/A.md", text), "note.status", col("Reading"));
    expect(m).toEqual({ kind: "set", path: "Books/A.md", key: "status", value: "Reading" });
    if (m.kind !== "set") return;
    const after = applyKanbanSet(text, m);
    const a = after.split("\n");
    const b = text.split("\n");
    expect(a.length).toBe(b.length);
    const changed = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
    expect(changed).toEqual([2]);
    expect(a[2]).toMatch(/^status: Reading/);
    expect(Object.fromEntries(readProperties(after).map((p) => [p.key, p.value]))).toMatchObject({ title: "A", status: "Reading", rating: 4 });
  });
  it("the group of the real Job Hunt.base is written as `status:` (its groupBy has no note. prefix)", () => {
    const base = parsed(JOBS);
    const gb = base.views[viewOf(JOBS, "kanban")].groupBy!.property;
    expect(gb).toBe("note.status");
    expect(kanbanGrouping(gb)).toEqual({ kind: "property", key: "status" });
  });
  it("dropping on None empties the property; a list stays a list; a number stays a number", () => {
    expect(planKanbanMove(row("a.md", "---\nstatus: x\n---\n"), "note.status", col(null, null))).toMatchObject({ kind: "set", value: null });
    expect(planKanbanMove(row("a.md", "---\nstatus: [x]\n---\n"), "note.status", col("y"))).toMatchObject({ kind: "set", value: ["y"] });
    expect(planKanbanMove(row("a.md", "---\npriority: 1\n---\n", "note.priority"), "note.priority", col("2", 2))).toMatchObject({ kind: "set", value: 2 });
  });
  it("dropping on the column it is in changes nothing", () => {
    expect(planKanbanMove(row("a.md", "---\nstatus: x\n---\n"), "note.status", col("x"))).toEqual({ kind: "refuse", reason: "same" });
  });
  it("only Markdown notes can be moved", () => {
    expect(planKanbanMove(row("img.png", null as never), "note.status", col("x"))).toEqual({ kind: "refuse", reason: "notMarkdown" });
  });
  it("grouped by file.folder, a drop moves the file to that folder (the root for None)", () => {
    const r = row("Inbox/Note.md", "# n\n", "file.folder");
    expect(planKanbanMove(r, "file.folder", col("Projects/2026"))).toEqual({ kind: "move", from: "Inbox/Note.md", to: "Projects/2026/Note.md" });
    expect(planKanbanMove(r, "file.folder", col(null, null))).toEqual({ kind: "move", from: "Inbox/Note.md", to: "Note.md" });
    expect(planKanbanMove(r, "file.folder", col("Inbox"))).toEqual({ kind: "refuse", reason: "same" });
  });
});

describe("kanban §Grouping: formula and file groups are read-only (W12.T5)", () => {
  it.each([
    ["formula.closes", "formula"],
    ["file.ext", "file"],
    ["file.mtime", "file"],
  ])("grouped by %s: cards cannot be moved (%s)", (property, reason) => {
    expect(kanbanGrouping(property)).toEqual({ kind: "readOnly", reason });
    const r: BaseRow = { file: basesFileFromText("a.md", "# a\n"), cells: {} };
    expect(planKanbanMove(r, property, { key: "x", value: "x", rows: [] })).toEqual({ kind: "refuse", reason });
  });
  it("file.folder is the one file property that moves", () => {
    expect(kanbanGrouping("file.folder")).toEqual({ kind: "folder" });
  });
});

describe("kanban keyboard: Alt+arrows move a card as the text runs (W12.T5)", () => {
  it.each([
    ["ArrowLeft", true, 1, 2],
    ["ArrowRight", true, 1, 0],
    ["ArrowRight", false, 1, 2],
    ["ArrowLeft", false, 1, 0],
    ["ArrowLeft", true, 3, null],
    ["ArrowRight", false, 3, null],
  ])("%s (rtl %s) from column %i → %s", (key, rtl, from, to) => {
    expect(kanbanKeyTarget(key, { alt: true, rtl }, from, 4)).toBe(to);
  });
  it("without Alt the arrows do not move a card", () => {
    expect(kanbanKeyTarget("ArrowLeft", { rtl: true }, 1, 4)).toBeNull();
  });
});

describe("cards §Settings: Image property, Image fit, Image aspect ratio (W12.T5)", () => {
  it("the real Books.base cards view: image, imageFit, imageAspectRatio and cardSize are read", () => {
    const base = parsed(BOOKS);
    const cards = base.views.find((v) => v.type === "cards")!;
    expect(cards.image).toMatch(/^note\./);
    expect(cards.imageAspectRatio).toBe(1.4);
    expect(cards.cardSize).toBe(200);
    expect(["cover", "contain"]).toContain(coverStyle(cards).fit);
  });
  it("cover fills and crops (the default); contain fits without cropping; a bad ratio is ignored", () => {
    expect(coverStyle({})).toEqual({ fit: "cover", ratio: null });
    expect(coverStyle({ imageFit: "contain", imageAspectRatio: 0.5 })).toEqual({ fit: "contain", ratio: 0.5 });
    expect(coverStyle({ imageAspectRatio: -1 })).toEqual({ fit: "cover", ratio: null });
  });
  it("an empty imageFit (as one real file has) reads as no setting", () => {
    expect(parsed("views:\n  - type: cards\n    name: C\n    image: note.cover\n    imageFit: \"\"\n").views[0].imageFit).toBeUndefined();
  });
  it("the image property: an https URL, a colour, or a vault link; other text shows no cover", () => {
    expect(coverOf("https://example.org/a.jpg")).toEqual({ src: "https://example.org/a.jpg" });
    expect(coverOf("#3366ff")).toEqual({ color: "#3366ff" });
    expect(coverOf({ $: "link", path: "covers/a.png" })).toEqual({ link: "covers/a.png" });
    expect(coverOf("http://insecure.example/a.jpg")).toBeNull();
    expect(coverOf("just text")).toBeNull();
  });
});

describe("1.15: filters dragged to reorder, and moved between All views and This view (W12.T5)", () => {
  const base = parsed(BOOKS);
  const v = viewOf(BOOKS, "kanban");
  it("the rows of the real Books.base: its All-views filter and the kanban view's own", () => {
    const rows = filterRows(base, v);
    expect(rows.view.map((r) => r.text)).toEqual(['file.ext == "md"']);
    expect(rows.all.length).toBeGreaterThan(0);
  });
  it("moving a view filter to All views and back leaves the file with the same data", () => {
    const rows = filterRows(base, v);
    const a = moveFilter(BOOKS, { view: v, index: 0 }, { view: null, index: rows.all.length });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(filterRows(parsed(a.text), v).view).toEqual([]);
    expect(filterRows(parsed(a.text), v).all.map((r) => r.text)).toEqual([...rows.all.map((r) => r.text), 'file.ext == "md"']);
    const b = moveFilter(a.text, { view: null, index: rows.all.length }, { view: v, index: 0 });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const back = filterRows(parsed(b.text), v);
    expect({ all: back.all.map((r) => r.text), view: back.view.map((r) => r.text) }).toEqual({ all: rows.all.map((r) => r.text), view: rows.view.map((r) => r.text) });
    // Views, formulas and properties are untouched by the two moves.
    expect(parsed(b.text).views.map((x) => [x.name, x.order, x.groupOrder])).toEqual(base.views.map((x) => [x.name, x.order, x.groupOrder]));
  });
  it("reordering two filters of a real base writes only that order", () => {
    // The first real file with two or more statements in one and-list (All views or a view).
    const found = REAL_BASES.flatMap((f) => {
      const b = parsed(f.text);
      const scopes = [{ view: null as number | null }, ...b.views.map((_, i) => ({ view: i as number | null }))];
      return scopes.map((sc) => ({ f, b, sc, rows: sc.view === null ? filterRows(b, 0).all : filterRows(b, sc.view).view })).filter((x) => x.rows.length >= 2);
    })[0];
    expect(found, "a real .base with two filters in one list").toBeDefined();
    const scope = found.sc.view === null ? ({ view: null } as const) : { view: found.sc.view };
    const w = moveFilter(found.f.text, { ...scope, index: 1 }, { ...scope, index: 0 });
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    const after = scope.view === null ? filterRows(parsed(w.text), 0).all : filterRows(parsed(w.text), scope.view).view;
    expect(after.map((r) => r.text)).toEqual([found.rows[1].text, found.rows[0].text, ...found.rows.slice(2).map((r) => r.text)]);
  });
  it("Alt+ArrowUp / Alt+ArrowDown move a row by one; not past the ends; not without Alt", () => {
    const r = { scope: { view: null }, index: 1, text: "x" } as const;
    expect(filterKeyTarget("ArrowUp", true, r, 3)).toBe(0);
    expect(filterKeyTarget("ArrowDown", true, r, 3)).toBe(2);
    expect(filterKeyTarget("ArrowDown", true, { ...r, index: 2 }, 3)).toBeNull();
    expect(filterKeyTarget("ArrowUp", false, r, 3)).toBeNull();
  });
});

describe("every real kanban .base in the corpus reads and plans moves by these rules (W12.T5)", () => {
  const kanbans = REAL_BASES.filter((f) => /type: kanban/.test(f.text));
  it("there are real kanban bases to check", () => {
    expect(kanbans.length).toBeGreaterThanOrEqual(5);
  });
  it("each parses, and the grouping kind of every grouped kanban view follows the help page", () => {
    let grouped = 0;
    for (const f of kanbans) {
      const b = parsed(f.text);
      // A kanban view without groupBy (the Airtable importer writes one) shows "pick a property to group by".
      for (const view of b.views.filter((x) => x.type === "kanban" && x.groupBy)) {
        grouped++;
        const g = kanbanGrouping(view.groupBy!.property);
        expect(g.kind, `${f.path}: ${view.groupBy!.property}`).toBe(view.groupBy!.property.startsWith("formula.") ? "readOnly" : view.groupBy!.property === "file.folder" ? "folder" : view.groupBy!.property.startsWith("file.") ? "readOnly" : "property");
      }
    }
    expect(grouped).toBeGreaterThanOrEqual(5);
  });
});
