/**
 * Review Z7-L3 and Z7-L4 (#938), on synthetic Notion exports (fixtures/notionScenarios.ts helpers).
 * L3: the import gave a database a type id the vault already has; its type file was then skipped ("typeExists")
 * while every row was still marked `type: books` with Notion's columns, against the user's schema.
 * L4: relation typing mapped row names across databases, the last one winning, so a name two databases share
 * gave a wrong relation target.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convertNotion } from "../../storage/import/notion";
import { databaseType } from "../../storage/import/notionTypes";
import { splitFrontmatter } from "../../storage/import/frontmatter";
import { loadTypeRegistry } from "../../types/typeRegistry";
import { commitImport, prepareImport, withoutTypes } from "../../storage/import/commit";
import { setVaultBackend } from "../../storage/vault";
import { createMemoryBackend } from "../../storage/vault/memory";
import type { VaultBackend } from "../../storage/vault/types";
import * as workspace from "../../storage/workspace";
import type { ConvertedVault } from "../../storage/import/types";
import { csv, files, id } from "../fixtures/notionScenarios";

const registry = (v: ConvertedVault) => loadTypeRegistry([...(v.types ?? new Map())].map(([tid, yaml]) => ({ path: `.lumen/types/${tid}.yaml`, text: yaml })));
const typeOf = (v: ConvertedVault, path: string) => (splitFrontmatter(v.notes.get(path) ?? "").props as Record<string, unknown>).type;
const BOOKS = files({ [`Books ${id(1)}.csv`]: csv([["Name", "Pages"], ["Dune", "412"]]) });
const USER_BOOKS = "name: Books\nfields:\n  author:\n    type: relation\n    to: people\n  year:\n    type: number\n";

describe("Z7-L3: an imported database never takes a type id the vault has", () => {
  it("the vault has `books`: the database becomes `books-2`, and its rows are typed `books-2`", () => {
    const v = convertNotion(BOOKS, { folder: "Imported/Notion", types: true, existingTypeIds: ["books"] });
    expect([...v.types!.keys()]).toEqual(["books-2"]);
    const row = [...v.notes.keys()].find((p) => p.endsWith(".md") && p.includes("Dune"))!;
    expect(typeOf(v, row)).toBe("books-2");
  });

  let previous: VaultBackend | null = null;
  beforeEach(() => {
    previous = setVaultBackend(createMemoryBackend());
  });
  afterEach(() => {
    setVaultBackend(previous);
  });

  it("through prepareImport and commitImport: the user's books.yaml is untouched and no row claims it", async () => {
    await workspace.writeWorkspaceFile(".lumen/types/books.yaml", USER_BOOKS);
    const prep = await prepareImport(BOOKS, "Notion", "notion", { notionTypes: true });
    expect([...prep.vault.types!.keys()]).toEqual(["books-2"]);
    const { report } = await commitImport(prep);
    expect(await workspace.readWorkspaceFile(".lumen/types/books.yaml")).toBe(USER_BOOKS);
    expect(await workspace.workspaceHasFile(".lumen/types/books-2.yaml")).toBe(true);
    const rows = (await workspace.listWorkspace()).filter((f) => f.path.startsWith(report.folder) && f.path.endsWith("Dune.md"));
    expect(rows).toHaveLength(1);
    expect((splitFrontmatter(await workspace.readWorkspaceFile(rows[0].path)).props as Record<string, unknown>).type).toBe("books-2");
  });

  it("a type file that appears after the import was prepared is kept, and the rows are then not typed with it", async () => {
    const prep = await prepareImport(BOOKS, "Notion", "notion", { notionTypes: true });
    expect([...prep.vault.types!.keys()]).toEqual(["books"]);
    await workspace.writeWorkspaceFile(".lumen/types/books.yaml", USER_BOOKS);
    const { report } = await commitImport(prep);
    expect(await workspace.readWorkspaceFile(".lumen/types/books.yaml")).toBe(USER_BOOKS);
    const row = (await workspace.listWorkspace()).find((f) => f.path.startsWith(report.folder) && f.path.endsWith("Dune.md"))!;
    expect("type" in (splitFrontmatter(await workspace.readWorkspaceFile(row.path)).props as Record<string, unknown>)).toBe(false);
    expect(withoutTypes('---\ntype: "books"\nPages: 412\n---\n# Dune\n', new Set(["books"]))).toBe("---\nPages: 412\n---\n# Dune\n");
  });
});

describe("Z7-L4: a row name two databases share does not decide a relation alone", () => {
  it("a link to “Intro” and to “Ch 2” (only in Courses) is a relation to courses, whichever database came last", () => {
    const v = convertNotion(
      files({
        [`Lessons ${id(2)}.csv`]: csv([
          ["Name", "Course"],
          ["l1", `Intro (../Courses%20${id(3)}/Intro%20${id(4)}.md), Ch 2 (../Courses%20${id(3)}/Ch%202%20${id(5)}.md)`],
        ]),
        [`Courses ${id(3)}.csv`]: csv([["Name"], ["Intro"], ["Ch 2"]]),
        [`Talks ${id(6)}.csv`]: csv([["Name"], ["Intro"]]),
      }),
      { folder: "Imported/Notion", types: true },
    );
    const reg = registry(v);
    expect(reg.errors).toEqual([]);
    const course = reg.get("lessons")!.fields.find((f) => f.name === "Course")!;
    expect([course.kind, course.to]).toEqual(["relation", "courses"]);
  });

  it("links only to a shared name: no single database, so the links stay a list", () => {
    const r = databaseType({ title: "L", folder: "L", columns: ["Name", "Course"], typed: [["l1"], [["[[Intro]]"]]] }, "l", { typesOfRow: (n) => (n === "Intro" ? ["courses", "talks"] : []) });
    expect(r.report.find((x) => x.column === "Course")).toMatchObject({ status: "converted", kind: "multi-select" });
    const one = databaseType({ title: "L", folder: "L", columns: ["Name", "Course"], typed: [["l1"], [["[[Intro]]"]]] }, "l", { typesOfRow: () => ["courses"] });
    expect(one.report.find((x) => x.column === "Course")).toMatchObject({ status: "kept", kind: "relation" });
  });
});
