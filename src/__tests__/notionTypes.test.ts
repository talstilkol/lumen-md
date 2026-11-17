/**
 * Plan W12.T7: a Notion database imported as a type (`.lumen/types/<id>.yaml`)
 * and a `.base`, its relations and rollups kept, and a report line for every
 * column: kept, converted (how) or lost (why).
 *
 * The exports are SYNTHETIC: W8.2's twenty scenarios (fixtures/
 * notionScenarios.ts) and a few more here. The Notion API database object
 * in the last test is written in the shape of Notion's API reference
 * (developers.notion.com, "Database object"), not taken from a real export.
 */
import { describe, expect, it } from "vitest";
import { convertNotion } from "../storage/import/notion";
import { databaseType, databaseTypeId, notionFormulaToBases } from "../storage/import/notionTypes";
import { splitFrontmatter, withFrontmatter } from "../storage/import/frontmatter";
import { loadTypeRegistry, typesOfNote } from "../types/typeRegistry";
import { checkNote } from "../types/fieldValues";
import type { ConvertedVault } from "../storage/import/types";
import { SC, csv, files, htmlTable, id } from "./fixtures/notionScenarios";

const typed = (f: Map<string, Uint8Array>) => convertNotion(f, { folder: "Imported/Notion", types: true });
const registry = (v: ConvertedVault) => loadTypeRegistry([...(v.types ?? new Map())].map(([tid, yaml]) => ({ path: `.lumen/types/${tid}.yaml`, text: yaml })));

/** The vault with the `type:` the typed import adds taken out again: what W8.2's checks were written against. */
function untyped(v: ConvertedVault): ConvertedVault {
  const notes = new Map<string, string>();
  for (const [p, text] of v.notes) {
    if (!p.endsWith(".md")) {
      notes.set(p, text);
      continue;
    }
    const { props, body } = splitFrontmatter(text);
    if (!("type" in props)) {
      notes.set(p, text);
      continue;
    }
    const { type: _t, ...rest } = props as Record<string, unknown>;
    void _t;
    notes.set(p, withFrontmatter(rest as never, body));
  }
  return { ...v, notes };
}

describe("W8.2's 20 scenarios, imported as types (W12.T7)", () => {
  it("every scenario still works; every type loads; every row is its type with values that fit; every column is reported", () => {
    const failed: string[] = [];
    for (const s of SC) {
      const v = typed(s.files);
      try {
        s.check(untyped(v));
      } catch (e) {
        failed.push(`${s.name}: ${(e as Error).message.split("\n")[0]}`);
      }
      const reg = registry(v);
      expect(reg.errors, s.name).toEqual([]);
      expect(v.types!.size, s.name).toBeGreaterThan(0);
      for (const [p, text] of v.notes) {
        if (!p.endsWith(".md")) continue;
        const fm = splitFrontmatter(text).props as Record<string, unknown>;
        if (!("type" in fm)) continue;
        expect(typesOfNote(reg, { fm }).types.map((t) => t.id), `${s.name} ${p}`).toEqual([fm.type]);
        expect(checkNote(reg, { fm }), `${s.name} ${p}`).toEqual([]);
      }
      // A report line for every column, and no column lost without a reason.
      const lines = v.typeReport!.filter((l) => l.startsWith("| ") && !l.startsWith("| column") && !l.startsWith("| ---"));
      expect(lines.length, s.name).toBeGreaterThan(0);
      for (const l of lines) if (l.includes("| lost |")) expect(l.split("|")[4].trim(), `${s.name}: ${l}`).not.toBe("");
    }
    expect(failed).toEqual([]);
  });

  it("the plain import (types off) is unchanged: no `type:`, no type files", () => {
    const v = convertNotion(SC[0].files, { folder: "Imported/Notion" });
    expect(v.types).toBeUndefined();
    expect(splitFrontmatter(v.notes.get("Tasks/Write.md")!).props).toEqual({ Status: "Doing", Points: 3 });
  });
});

describe("columns to fields", () => {
  it("kinds from the values: select, number, checkbox, date, url; a reserved name stays a property", () => {
    const v = typed(
      files({
        [`Books ${id(11)}.csv`]: csv([
          ["Name", "Status", "Pages", "Read", "Finished", "Link", "Tags"],
          ["Dune", "Reading", "412", "Yes", "January 3, 2026", "https://example.com/dune", "sf"],
          ["Emma", "Done", "300", "No", "February 1, 2026", "https://example.com/emma", "classic"],
          ["Ulysses", "Done", "730", "No", "", "https://example.com/u", ""],
        ]),
      }),
    );
    const t = registry(v).get("books")!;
    expect(t.fields.map((f) => [f.name, f.kind])).toEqual([
      ["Status", "select"],
      ["Pages", "number"],
      ["Read", "checkbox"],
      ["Finished", "date"],
      ["Link", "url"],
    ]);
    expect(t.fields[0].options).toEqual(["Reading", "Done"]);
    expect(v.warnings).toContainEqual({ path: "Books.base", reason: "notionColumnConverted", detail: "Tags: kept as the note's `Tags` property; a type can't declare Tags" });
  });

  it("a relation to another imported database's rows is relation → its type; to pages outside, links kept as text", () => {
    const v = typed(
      files({
        [`Tasks ${id(12)}.csv`]: csv([
          ["Name", "Project", "Elsewhere"],
          ["a", `Apollo (../Projects%20${id(13)}/Apollo%20${id(14)}.md)`, "Emma (https://www.notion.so/Emma-1)"],
        ]),
        [`Projects ${id(13)}.csv`]: csv([["Name"], ["Apollo"]]),
      }),
    );
    const reg = registry(v);
    expect(reg.errors).toEqual([]);
    const project = reg.get("tasks")!.fields.find((f) => f.name === "Project")!;
    expect([project.kind, project.to, project.multiple]).toEqual(["relation", "projects", true]);
    expect(reg.get("tasks")!.fields.find((f) => f.name === "Elsewhere")!.kind).toBe("multi-select");
    expect(v.warnings.some((w) => w.reason === "notionColumnConverted" && w.detail!.startsWith("Elsewhere: links to pages outside"))).toBe(true);
  });

  it("an HTML-export formula column without its definition: converted, its values kept, the report says why", () => {
    const v = typed(files({ [`Budget ${id(15)}.html`]: htmlTable("Budget", [["Name", "Title"], ["Price", "Number"], ["With VAT", "Formula"]], [["Desk", "100", "117"]]) }));
    expect(registry(v).get("budget")!.fields.find((f) => f.name === "With VAT")!.kind).toBe("number");
    expect(v.typeReport!.join("\n")).toMatch(/\| With VAT \| converted \| number \| a Notion formula or rollup: its values came across as number; the formula is not in Notion's export \|/);
  });

  it("an API schema in the export: the formula through Notion's functions in Bases, the rollup as a rollup field; an unknown formula stays its values", () => {
    const schema = {
      object: "database",
      title: [{ plain_text: "Orders" }],
      properties: {
        Name: { type: "title" },
        Price: { type: "number" },
        "With VAT": { type: "formula", formula: { expression: 'round(prop("Price") * 1.17, 2)' } },
        Odd: { type: "formula", formula: { expression: "style(\"x\", \"b\")))" } },
        Customer: { type: "relation" },
        Spent: { type: "rollup", rollup: { relation_property_name: "Customer", rollup_property_name: "Total", function: "sum" } },
        Median: { type: "rollup", rollup: { relation_property_name: "Customer", rollup_property_name: "Total", function: "median" } },
      },
    };
    const v = typed(
      files({
        [`Orders ${id(16)}.csv`]: csv([
          ["Name", "Price", "With VAT", "Odd", "Customer", "Spent", "Median"],
          ["o1", "100", "117", "x", `Dana (../Customers%20${id(17)}/Dana%20${id(18)}.md)`, "500", "250"],
        ]),
        [`Customers ${id(17)}.csv`]: csv([["Name", "Total"], ["Dana", "500"]]),
        "orders-schema.json": JSON.stringify(schema),
      }),
    );
    const reg = registry(v);
    expect(reg.errors).toEqual([]);
    const f = (n: string) => reg.get("orders")!.fields.find((x) => x.name === n)!;
    expect([f("With VAT").kind, f("With VAT").formula]).toEqual(["formula", 'round(note["Price"] * 1.17, 2)']);
    expect([f("Spent").kind, f("Spent").relation, f("Spent").property, f("Spent").fn]).toEqual(["rollup", "Customer", "Total", "sum"]);
    expect(f("Odd").kind).toBe("text");
    expect(f("Median").kind).toBe("number");
    const report = v.typeReport!.join("\n");
    expect(report).toContain("| Odd | converted |");
    expect(report).toContain("| Median | converted | number | the rollup function median has no equivalent; its values were kept |");
  });
});

describe("helpers", () => {
  it("type ids from titles, unique", () => {
    expect(databaseTypeId("Reading List", new Set())).toBe("reading-list");
    expect(databaseTypeId("משימות", new Set(["משימות"]))).toBe("משימות-2");
  });
  it("prop(\"…\") → note[\"…\"], checked by the Bases parser", () => {
    expect(notionFormulaToBases('prop("Due") > now()')).toBe('note["Due"] > now()');
    expect(notionFormulaToBases("((")).toBeNull();
  });
  it("a column with no values is kept as text and says so", () => {
    const r = databaseType({ title: "T", folder: "T", columns: ["Name", "Empty"], typed: [["a"], [null]] }, "t", { typeOfRow: () => null });
    expect(r.report[1]).toEqual({ column: "Empty", status: "kept", kind: "text", note: "empty in every row" });
  });
});

describe("writing the types into the vault, and undo (fake OPFS)", () => {
  it("types go to .lumen/types/, an existing one is left as it is (the import takes the next id), undo takes the new ones back to the same vault hash", async () => {
    const { installFakeOpfs } = await import("./helpers/fakeOpfs");
    installFakeOpfs();
    localStorage.clear();
    const { collectVault } = await import("../storage/exportAll");
    const { readWorkspaceFile, workspaceHasEntry, writeWorkspaceFile } = await import("../storage/workspace");
    const { commitImport, prepareImport, undoImport } = await import("../storage/import/commit");
    const { reportMarkdown } = await import("../storage/import/report");
    const hash = async () => (await collectVault()).map((f) => `${f.path}\0${[...f.data].join(",")}`).join("\n");
    await writeWorkspaceFile(".lumen/types/projects.yaml", "label: { en: Mine }\nfields: {}\n");
    const before = await hash();
    const exp = files({
      [`Tasks ${id(21)}.csv`]: csv([["Name", "Project"], ["a", `Apollo (../Projects%20${id(22)}/Apollo%20${id(23)}.md)`]]),
      [`Projects ${id(22)}.csv`]: csv([["Name"], ["Apollo"]]),
    });
    const prep = await prepareImport(exp, "notion.zip", "notion", { notionTypes: true });
    const { report, undo } = await commitImport(prep);
    expect(await workspaceHasEntry(".lumen/types/tasks.yaml")).toBe(true);
    expect(await readWorkspaceFile(".lumen/types/projects.yaml")).toBe("label: { en: Mine }\nfields: {}\n");
    // Review Z7-L3: the vault's own `projects` is taken, so the database is `projects-2` (its rows too), not skipped.
    expect(report.warnings.filter((w) => w.reason === "typeExists")).toEqual([]);
    expect(Object.keys(undo.typeFiles ?? {}).sort()).toEqual([".lumen/types/projects-2.yaml", ".lumen/types/tasks.yaml"]);
    expect(reportMarkdown(report)).toContain("### Tasks → `tasks`");
    expect(await undoImport(undo)).toBe("removed");
    expect(await hash()).toBe(before);
  });
});
