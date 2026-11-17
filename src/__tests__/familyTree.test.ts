/**
 * W13.G7 — family trees:
 * - GEDCOM 5.5.1 (BOM, CRLF, CONC/CONT, @@, Hebrew names and dates) is read
 *   whole: 0 people lost, duplicates told apart, a lone person kept;
 * - the import writes a person note each, an import note with a paragraph
 *   per family, and spouse / child edges that pass the edge schema and whose
 *   provenance resolves to that paragraph ("ok");
 * - round trip: import → the vault graph → GEDCOM 7.0 export → read back:
 *   the same people, couples and parent–child pairs, dates and places;
 * - the export is valid GEDCOM 7.0 by the spec's structural rules
 *   (helpers/gedcom7.ts);
 * - the charts: hourglass, ancestors, descendants; no two boxes share a slot;
 * - the tree view: keyboard (↑ parent, ↓ child, Enter centres), RTL, axe;
 * - the screen's import: preview, all-or-nothing write, a second import of
 *   the same file overwrites nothing and loses nobody.
 * Synthetic data.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement as h } from "react";
import axe from "axe-core";
import { applyLocale, loadLocale } from "../i18n";
import { exportGedcom, gedcomIso, gedcomYear, parseGedcom, peopleOf, planGedcomImport } from "../entities/gedcom";
import { buildFamily, layoutChart } from "../entities/family";
import { graphFromFiles } from "../entities/graphData";
import { validateEdge } from "../entities/schema";
import { edgeSourceState } from "../entities/provenance";
import { EDGES_PATH, readEdges } from "../entities/store";
import { FamilyTreeView } from "../ui/FamilyTreeView";
import { GedcomImport } from "../ui/GedcomImport";
import type { EntityVault } from "../entities/vaultIo";
import { gedcom7Problems } from "./helpers/gedcom7";
import { splitFrontmatter } from "../entities/frontmatter";
import { entityNotePath } from "../entities/model";

const SAMPLE = [
  "﻿0 HEAD",
  "1 GEDC",
  "2 VERS 5.5.1",
  "2 FORM LINEAGE-LINKED",
  "1 CHAR UTF-8",
  "1 SOUR MYHERITAGE",
  "0 @I1@ INDI",
  "1 NAME אברהם /כהן/",
  "1 SEX M",
  "1 BIRT",
  "2 DATE 12 MAR 1900",
  "2 PLAC ירושלים",
  "1 DEAT",
  "2 DATE ABT 1980",
  "1 FAMS @F1@",
  "0 @I2@ INDI",
  "1 NAME שרה /לוי/",
  "1 SEX F",
  "1 BIRT",
  "2 DATE @#DHEBREW@ 1 TSH 5665",
  "1 FAMS @F1@",
  "0 @I3@ INDI",
  "1 NAME יצחק /כהן/",
  "1 SEX M",
  "1 BIRT",
  "2 DATE 1925",
  "1 FAMC @F1@",
  "1 FAMS @F2@",
  "0 @I4@ INDI",
  "1 NAME רבקה /כהן/",
  "1 SEX F",
  "1 FAMS @F2@",
  "1 NOTE A long note that runs on",
  "2 CONC  over two lines",
  "2 CONT and a second line, with an email user@@example.org",
  "0 @I5@ INDI",
  "1 NAME יעקב /כהן/",
  "1 SEX M",
  "1 BIRT",
  "2 DATE 1950",
  "1 FAMC @F2@",
  "0 @I6@ INDI",
  "1 NAME יעקב /כהן/",
  "1 SEX M",
  "1 BIRT",
  "2 DATE 1890",
  "0 @I7@ INDI",
  "1 NAME Esau /Cohen/",
  "1 SEX M",
  "1 FAMC @F2@",
  "0 @I8@ INDI",
  "1 NAME דינה",
  "1 SEX F",
  "1 FAMC @F3@",
  "0 @F1@ FAM",
  "1 HUSB @I1@",
  "1 WIFE @I2@",
  "1 CHIL @I3@",
  "1 MARR",
  "2 DATE 1924",
  "0 @F2@ FAM",
  "1 HUSB @I3@",
  "1 WIFE @I4@",
  "1 CHIL @I5@",
  "1 CHIL @I7@",
  "0 @F3@ FAM",
  "1 WIFE @I4@",
  "1 CHIL @I8@",
  "1 CHIL @I99@",
  "0 TRLR",
].join("\r\n");

const DATE = new Date("2026-11-17T00:00:00Z");

beforeEach(async () => {
  await loadLocale("he");
  applyLocale("he");
});
afterEach(() => {
  applyLocale("en");
  document.documentElement.dir = "";
});

describe("W13.G7 reading GEDCOM", () => {
  it("every individual and family, names, dates, CONC/CONT, a dangling pointer reported", () => {
    const g = parseGedcom(SAMPLE);
    expect(g.version).toBe("5.5.1");
    expect(g.people).toHaveLength(8);
    expect(g.families).toHaveLength(3);
    expect(g.people[0]).toEqual({ xref: "@I1@", name: "אברהם כהן", given: "אברהם", surname: "כהן", sex: "M", born: "12 MAR 1900", birthPlace: "ירושלים", died: "ABT 1980" });
    expect(g.people[1].born).toBe("@#DHEBREW@ 1 TSH 5665");
    expect(g.people[7].name).toBe("דינה");
    expect(g.problems).toEqual(["@F3@: @I99@ is not an individual"]);
    expect(gedcomYear("ABT 1980")).toBe("1980");
    expect(gedcomYear("@#DHEBREW@ 1 TSH 5665")).toBeNull();
    expect(gedcomIso("12 MAR 1900")).toBe("1900-03-12");
  });
});

describe("W13.G7 import", () => {
  it("0 people lost: duplicates told apart by birth year; edges pass the schema and quote their family's paragraph", () => {
    const plan = planGedcomImport(parseGedcom(SAMPLE), { fileName: "משפחת כהן.ged", date: DATE });
    expect(plan.entities).toHaveLength(8);
    expect(plan.idOf.size).toBe(8);
    expect(new Set(plan.entities.map((e) => e.id)).size).toBe(8);
    expect(plan.entities.map((e) => e.name)).toContain("יעקב כהן (1890)");
    const note = plan.files.get("ייבוא/GEDCOM משפחת כהן.md")!;
    expect(note).toContain("^gF1");
    const kinds = plan.edges.map((e) => e.predicate).sort();
    expect(kinds.filter((k) => k === "spouse")).toHaveLength(2);
    expect(kinds.filter((k) => k === "child")).toHaveLength(2 + 4 + 1);
    for (const e of plan.edges) {
      expect(validateEdge(e)).toEqual({ ok: true, problems: [] });
      expect(edgeSourceState(e.provenance, note)).toBe("ok");
    }
    const abraham = [...plan.files].find(([p]) => p.endsWith("אברהם כהן.md"))![1];
    expect(abraham).toMatch(/born: 1900-03-12/);
    expect(abraham).toMatch(/birth-place: ירושלים/);
    expect(abraham).toMatch(/died: ABT 1980/);
  });

  it("names already in the vault are never taken", () => {
    const plan = planGedcomImport(parseGedcom(SAMPLE), { fileName: "x.ged", taken: new Set(["person:אברהם-כהן"]), date: DATE });
    expect(plan.entities.map((e) => e.name)).toContain("אברהם כהן (1900)");
  });
});

/** Relations by name: "A + B" for couples, "A > C" for parent → child. */
function relations(text: string): string[] {
  const g = parseGedcom(text);
  const name = new Map(g.people.map((p) => [p.xref, p.name]));
  const out = new Set<string>();
  for (const f of g.families) {
    const ps = f.partners.filter((x) => name.has(x)).map((x) => name.get(x)!).sort();
    if (ps.length === 2) out.add(`${ps[0]} + ${ps[1]}`);
    for (const p of ps) for (const c of f.children) if (name.has(c)) out.add(`${p} > ${name.get(c)}`);
  }
  return [...out].sort();
}

describe("W13.G7 round trip and GEDCOM 7", () => {
  it("import → vault graph → export → read back: the same people, relations, dates and places", () => {
    const plan = planGedcomImport(parseGedcom(SAMPLE), { fileName: "משפחת כהן.ged", date: DATE });
    const files = new Map(plan.files);
    files.set(EDGES_PATH, plan.edges.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const graph = graphFromFiles(files);
    expect(graph.entities.filter((e) => e.type === "person")).toHaveLength(8);
    const out = exportGedcom(peopleOf(graph.entities, graph.noteOf, graph.texts), graph.edges, { date: DATE });
    expect(gedcom7Problems(out)).toEqual([]);
    const back = parseGedcom(out);
    expect(back.version).toBe("7.0");
    expect(back.people.map((p) => p.name).sort()).toEqual(parseGedcom(SAMPLE).people.map((p) => p.name).sort());
    expect(relations(out)).toEqual(relations(SAMPLE));
    const abraham = back.people.find((p) => p.name === "אברהם כהן")!;
    expect(abraham).toMatchObject({ sex: "M", born: "12 MAR 1900", birthPlace: "ירושלים", died: "ABT 1980" });
    // A 5.5.1 Hebrew-calendar date goes out in 7.0's form.
    expect(back.people.find((p) => p.name === "שרה לוי")!.born).toBe("HEBREW 1 TSH 5665");
  });

  it("the GEDCOM 7 checker catches what the spec forbids", () => {
    expect(gedcom7Problems("0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 @I1@ INDI\n1 FAMC @F9@\n1 NOTE a\n2 CONC b\n0 TRLR\n")).toEqual(expect.arrayContaining(["HEAD.GEDC.VERS is not 7.0", "@I1@: FAMC @F9@ points nowhere", "CONC is not GEDCOM 7"]));
  });
});

describe("W13.G7 charts", () => {
  const plan = planGedcomImport(parseGedcom(SAMPLE), { fileName: "x.ged", date: DATE });
  const people = plan.entities.map((entity) => ({ entity, props: {} }));
  const fam = buildFamily(people, plan.edges);
  const id = (n: string) => plan.entities.find((e) => e.name === n)!.id;

  it("hourglass, ancestors, descendants: generations in place, no shared slots, parents over their child", () => {
    const hg = layoutChart(fam, id("יצחק כהן"), "hourglass", 3);
    const gen = new Map(hg.boxes.map((b) => [b.id, b.gen]));
    expect(gen.get(id("אברהם כהן"))).toBe(-1);
    expect(gen.get(id("שרה לוי"))).toBe(-1);
    expect(gen.get(id("יעקב כהן"))).toBe(1);
    expect(gen.get(id("רבקה כהן"))).toBe(0);
    const slots = hg.boxes.map((b) => `${b.gen}:${b.col}`);
    expect(new Set(slots).size).toBe(slots.length);
    const col = new Map(hg.boxes.map((b) => [b.id, b.col]));
    expect((col.get(id("אברהם כהן"))! + col.get(id("שרה לוי"))!) / 2).toBeCloseTo(col.get(id("יצחק כהן"))!, 5);
    expect(layoutChart(fam, id("יעקב כהן"), "ancestors", 2).boxes.map((b) => b.gen).sort((a, b) => a - b)).toEqual([-2, -2, -1, -1, 0]);
    expect(layoutChart(fam, id("אברהם כהן"), "descendants", 1).boxes.every((b) => b.gen >= 0)).toBe(true);
  });
});

describe("W13.G7 tree view", () => {
  it("keyboard: ↑ parent, ↓ child, Enter centres; RTL; axe", async () => {
    document.documentElement.dir = "rtl";
    const plan = planGedcomImport(parseGedcom(SAMPLE), { fileName: "x.ged", date: DATE });
    const people = plan.entities.map((entity) => ({ entity, props: splitFrontmatter(plan.files.get(entityNotePath(entity))!).props }));
    const isaac = plan.entities.find((e) => e.name === "יצחק כהן")!.id;
    const { container } = render(h(FamilyTreeView, { people, edges: plan.edges, start: isaac }));
    const box = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button[data-person]")].find((b) => b.textContent!.startsWith(name))!;
    box("יצחק כהן").focus();
    fireEvent.keyDown(screen.getByTestId("family-chart"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(box("אברהם כהן"));
    fireEvent.keyDown(screen.getByTestId("family-chart"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(box("יצחק כהן"));
    fireEvent.keyDown(screen.getByTestId("family-chart"), { key: "ArrowDown" });
    // ↓ reaches a child: the first of Isaac's, born first (Jacob 1950; Esau has no year).
    expect((document.activeElement as HTMLElement).dataset.person).toBe(buildFamily(people, plan.edges).children.get(isaac)![0]);
    expect(fam(plan).children.get(isaac)).toContain((document.activeElement as HTMLElement).dataset.person);
    await act(async () => void fireEvent.click(box("אברהם כהן")));
    expect(screen.getByTestId("family-status").textContent).toContain("אברהם כהן");
    expect(box("אברהם כהן").getAttribute("aria-current")).toBe("true");
    expect(box("אברהם כהן").getAttribute("aria-label")).toBe("אברהם כהן, 1900–1980, ילדים: 1");
    expect(box("שרה לוי").textContent).toContain("תרס״ה"); // a Hebrew-calendar birth year in Hebrew numerals
    const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});
const fam = (plan: ReturnType<typeof planGedcomImport>) => buildFamily(plan.entities.map((entity) => ({ entity, props: {} })), plan.edges);

describe("W13.G7 the screen's import", () => {
  it("preview, write all at once, and a second import overwrites nothing and loses nobody", async () => {
    const disk = new Map<string, string>([[EDGES_PATH, ""]]);
    const vault: EntityVault = {
      listWorkspace: async () => [...disk.keys()].map((path) => ({ path })),
      readWorkspaceFile: async (p) => disk.get(p) ?? Promise.reject(new Error("no")),
      writeWorkspaceFile: async (p, c) => void disk.set(p, c),
      deleteWorkspaceFile: async (p) => void disk.delete(p),
      workspaceHasFile: async (p) => disk.has(p),
      workspaceHasEntry: async (p) => disk.has(p),
    };
    const file = new File([SAMPLE], "כהן.ged", { type: "text/plain" });
    for (const round of [1, 2]) {
      const files = new Map(disk);
      const graph = graphFromFiles(files);
      const { unmount } = render(h(GedcomImport, { files, taken: new Set(graph.entities.map((e) => e.id)), vault, onImported: () => {} }));
      await act(async () => void fireEvent.change(screen.getByTestId("gedcom-file"), { target: { files: [file] } }));
      await waitFor(() => expect(screen.getByTestId("gedcom-preview").textContent).toContain("8 אנשים, 3 משפחות, 1 בעיות"));
      await act(async () => void fireEvent.click(screen.getByTestId("gedcom-import-run")));
      await waitFor(() => expect(screen.getByTestId("gedcom-status").textContent).toContain("יובאו 8 אנשים"));
      const people = [...disk.keys()].filter((p) => p.startsWith("ישויות/אנשים/"));
      expect(people).toHaveLength(8 * round);
      expect(readEdges(disk.get(EDGES_PATH)!).edges).toHaveLength(9 * round);
      unmount();
    }
  });
});
