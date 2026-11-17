/**
 * Plan W12.T2 — typed objects in the UI, the pure part: the field form,
 * relation candidates, new notes from a type's template, and Object Studio's
 * writes (new type, new field, rename a field in 100 notes through the
 * review screen, undone in one step).
 *
 * All notes here are SYNTHETIC, generated in this file.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { loadTypeRegistry } from "../types/typeRegistry";
import { parseTypeFile } from "../types/typeSchema";
import { addFieldToTypeText, formFields, inputValue, newTypedNote, newTypeFile, planFieldRename, relationCandidates, renameFieldInTypeText, undoFileChanges, writeField } from "../types/typedForm";
import { basesFileFromText } from "../views/bases/base";
import { readProperties } from "../properties/frontmatter";

const T = (id: string, text: string) => ({ path: `.lumen/types/${id}.yaml`, text });
const PERSON = T("person", "# people I study\nlabel: { he: אדם, en: Person }\ntag: person\nfields:\n  born: hebrew-date\n  role: { type: select, options: [author, editor] }\n  pages: number\n  site: url\n");
const BOOK = T("book", "label: { he: ספר }\nfields:\n  author: { type: relation, to: person }\n  status: { type: select, options: [a, b] }\n");
const reg = loadTypeRegistry([PERSON, BOOK, T("author", "extends: person\n")]);
const props = (text: string) => Object.fromEntries(readProperties(text).map((p) => [p.key, p.value]));

describe("the field form (W12.T2)", () => {
  it("shows the type's fields in order, present or not", () => {
    const f = formFields(reg, basesFileFromText("a.md", "---\ntype: person\npages: 3\n---\n"));
    expect(f.types).toEqual(["person"]);
    expect(f.fields.map((x) => [x.field.name, x.present])).toEqual([
      ["born", false],
      ["role", false],
      ["pages", true],
      ["site", false],
    ]);
  });
  it("a tag makes the form appear too", () => {
    expect(formFields(reg, basesFileFromText("a.md", "---\ntags: [person]\n---\n")).types).toEqual(["person"]);
  });
  it("a value that does not fit is marked with the reason, and kept", () => {
    const f = formFields(reg, basesFileFromText("a.md", "---\ntype: person\npages: many\nrole: painter\n---\n"));
    expect(f.fields.find((x) => x.field.name === "pages")!.problem?.code).toBe("kind");
    expect(f.fields.find((x) => x.field.name === "role")!.problem?.code).toBe("option");
    expect(f.fields.find((x) => x.field.name === "pages")!.value).toBe("many");
  });
  it("a deleted type is reported, and no field is invented", () => {
    const f = formFields(reg, basesFileFromText("a.md", "---\ntype: magazine\nissue: 3\n---\n"));
    expect(f).toMatchObject({ types: [], fields: [], unknown: ["magazine"] });
  });
  it("the relation picker offers only notes of the target type (and its child types)", () => {
    const notes = [
      { ...basesFileFromText("people/Ada.md", "---\ntype: person\n---\n") },
      { ...basesFileFromText("people/Bo.md", "---\ntype: author\n---\n") },
      { ...basesFileFromText("books/Dune.md", "---\ntype: book\n---\n") },
      { ...basesFileFromText("misc/X.md", "# x\n") },
    ];
    const author = reg.get("book")!.effective.find((f) => f.name === "author")!;
    expect(relationCandidates(reg, author, notes)).toEqual(["Ada", "Bo"]);
  });
  it.each([
    ["number", "12", 12],
    ["number", "12,5", 12.5],
    ["number", "many", "many"],
    ["checkbox", true, true],
    ["multi-select", "a, b", ["a", "b"]],
    ["relation", "Ada", "[[Ada]]"],
    ["relation", "[[Ada]]", "[[Ada]]"],
    ["text", "", null],
  ] as const)("input for %s %j is written as %j", (kind, raw, want) => {
    expect(inputValue(kind, raw as never)).toEqual(want);
  });
  it("a multiple relation from a comma list is a list of links", () => {
    expect(inputValue("relation", "Ada, Bo", { multiple: true })).toEqual(["[[Ada]]", "[[Bo]]"]);
  });
  it("writing a field changes only that key; the body and the other keys stay byte for byte", () => {
    const text = "---\ntype: person # who\nrole: author\n---\n\n# Ada\n\nbody\n";
    const f = formFields(reg, basesFileFromText("a.md", text)).fields.find((x) => x.field.name === "role")!;
    const after = writeField(text, f, "editor");
    expect(after).toBe(text.replace("role: author", "role: editor"));
  });
});

describe("a new note of a type, from its template (W12.T2)", () => {
  it("opens with the type's fields in the frontmatter and the template's body", () => {
    const r = loadTypeRegistry([T("book", "label: { he: ספר }\ntemplate: \"# {{title}}\\n\\nנקרא ב-{{date}}\\n\"\nfields:\n  author: { type: relation, to: book }\n  status: { type: select, options: [a, b], default: a }\n")]);
    const made = newTypedNote(r, "book", { title: "דיונה", now: new Date(Date.UTC(2026, 10, 15, 10)) });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(props(made.text)).toMatchObject({ type: "book", status: "a" });
    expect(made.text.endsWith("\n# דיונה\n\nנקרא ב-2026-11-15\n")).toBe(true);
  });
  it("a template note (template: path) is read by the caller and its body used", () => {
    const made = newTypedNote(reg, "person", { title: "Ada", templateBody: "## {{title}}\n" });
    expect(made.ok && made.text.endsWith("\n## Ada\n")).toBe(true);
  });
  it("without a template, a heading", () => {
    const made = newTypedNote(reg, "person", { title: "Ada" });
    expect(made.ok && made.text.endsWith("\n# Ada\n")).toBe(true);
  });
});

describe("Object Studio writes (W12.T2)", () => {
  it("a new type file reads back as the type it describes", () => {
    const f = newTypeFile("אדם", { he: "אדם", en: "Person" }, { tag: "person" });
    expect(f.path).toBe(".lumen/types/אדם.yaml");
    const p = parseTypeFile(f.path, f.text);
    expect(p.ok && p.type).toMatchObject({ id: "אדם", label: { he: "אדם", en: "Person" }, tag: "person", fields: [] });
  });
  it("adding fields keeps the file's comments and existing keys; a duplicate is refused", () => {
    let text = PERSON.text;
    text = addFieldToTypeText(text, "died", "date");
    text = addFieldToTypeText(text, "school", "relation", { to: "org" });
    // The original file is kept byte for byte; two lines are added after the last field.
    expect(text).toBe(PERSON.text + "  died: { type: date }\n  school: { type: relation, to: org }\n");
    const p = parseTypeFile(PERSON.path, text);
    expect(p.ok && p.type.fields.map((f) => f.name)).toEqual(["born", "role", "pages", "site", "died", "school"]);
    expect(() => addFieldToTypeText(text, "Born", "text")).toThrow(/already exists/);
  });
  it("renaming a field in the type file changes only its key", () => {
    const after = renameFieldInTypeText(PERSON.text, "pages", "page_count");
    expect(after).toBe(PERSON.text.replace("  pages: number", "  page_count: number"));
  });
});

describe("renaming a field in 100 notes: through the review screen, undone in one step (W12.T2)", () => {
  /** SYNTHETIC: 100 people with `role:`, 20 books with `role:` too (another type: untouched), 5 people without it. */
  const notes = [
    ...Array.from({ length: 100 }, (_, i) => ({ path: `people/p${i}.md`, text: `---\ntype: ${i % 4 === 0 ? "author" : "person"}\nrole: author # r${i}\npages: ${i}\n---\n\n# P${i}\n` })),
    ...Array.from({ length: 20 }, (_, i) => ({ path: `books/b${i}.md`, text: `---\ntype: book\nrole: author\n---\n` })),
    ...Array.from({ length: 5 }, (_, i) => ({ path: `people/x${i}.md`, text: `---\ntype: person\n---\n` })),
  ].map((n) => ({ ...n, note: basesFileFromText(n.path, n.text) }));
  const plan = planFieldRename(reg, "person", "role", "תפקיד", PERSON, notes);
  it("changes the type file and exactly the 100 people that have the field (child types included)", () => {
    expect(plan.changes[0].path).toBe(PERSON.path);
    expect(plan.changes.slice(1).map((c) => c.path)).toEqual(notes.slice(0, 100).map((n) => n.path));
    expect(plan.skipped).toEqual([]);
  });
  it("each note changes only the key: its value, comment and body stay", () => {
    for (const c of plan.changes.slice(1)) expect(c.after).toBe(c.before.replace("\nrole: author", "\nתפקיד: author"));
  });
  it("an inherited field is renamed on the type that declares it, not on a child", () => {
    expect(() => planFieldRename(reg, "author", "role", "x", T("author", "extends: person\n"), notes)).toThrow(/inherited from person/);
  });
  it("one undo restores all 101 files; a file changed since is left alone and reported", async () => {
    const disk = new Map<string, string>(plan.changes.map((c) => [c.path, c.after]));
    disk.set("people/p7.md", disk.get("people/p7.md")! + "edited later\n");
    const r = await undoFileChanges(plan.changes, { read: async (p) => disk.get(p) ?? null, write: async (p, t) => void disk.set(p, t) });
    expect(r.restored).toHaveLength(100);
    expect(r.changedSince).toEqual(["people/p7.md"]);
    for (const c of plan.changes) if (c.path !== "people/p7.md") expect(disk.get(c.path)).toBe(c.before);
  });
});
