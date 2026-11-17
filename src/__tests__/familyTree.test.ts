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
    expect(g.people[0]).toEqual({ xref: "@I1@", name: "אברהם כהן", given: "אברהם", surname: "כהן", rawName: "אברהם /כהן/", sex: "M", born: "12 MAR 1900", birthPlace: "ירושלים", died: "ABT 1980" });
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

/** Import a GEDCOM file into a vault graph and export it again (the screen's two paths). */
function roundTrip(text: string, labels?: { title: string; family: string; children: string; unnamed?: string }) {
  const plan = planGedcomImport(parseGedcom(text), { fileName: "x.ged", date: DATE, labels });
  const files = new Map(plan.files);
  files.set(EDGES_PATH, plan.edges.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const graph = graphFromFiles(files);
  const out = exportGedcom(peopleOf(graph.entities, graph.noteOf, graph.texts), graph.edges, { date: DATE });
  return { plan, out, back: parseGedcom(out) };
}

describe("audit r4 A3 #8: GEDCOM round trip", () => {
  const FILE = [
    "0 HEAD", "1 GEDC", "2 VERS 5.5.1",
    "0 @I1@ INDI", "1 NAME María /de la Cruz/", "1 SEX F", "1 FAMS @F1@",
    "0 @I2@ INDI", "1 NAME José /García López/", "1 SEX M", "1 FAMS @F1@",
    "0 @I3@ INDI", "1 NAME Ana /García/", "1 FAMC @F1@", "2 PEDI adopted",
    "0 @I4@ INDI", "1 NAME דוד /בן דוד/", "1 FAMC @F2@",
    "0 @I5@ INDI", "1 NAME רות /בן דוד/", "1 FAMC @F2@", "2 PEDI FOSTER",
    "0 @P9@ INDI", "1 SEX U", "1 FAMC @F2@",
    "0 @F1@ FAM", "1 HUSB @I2@", "1 WIFE @I1@", "1 CHIL @I3@",
    "0 @F2@ FAM", "1 CHIL @I4@", "1 CHIL @I5@", "1 CHIL @P9@",
    "0 TRLR",
  ].join("\n");

  it("a surname of several words keeps its /slashes/", () => {
    const { out, back } = roundTrip(FILE);
    expect(gedcom7Problems(out)).toEqual([]);
    expect(out).toContain("1 NAME María /de la Cruz/");
    expect(out).toContain("1 NAME José /García López/");
    expect(out).toContain("1 NAME דוד /בן דוד/");
    expect(back.people.find((p) => p.given === "María")!.surname).toBe("de la Cruz");
    // An edited name goes out as written: the file's /surname/ only while the name is the file's.
    const people = [{ entity: { id: "person:a", type: "person" as const, name: "María Cruz", aliases: [] }, props: { "gedcom-name": "María /de la Cruz/" } }];
    expect(exportGedcom(people, [])).toContain("1 NAME María /Cruz/");
  });

  it("a family with children only (siblings of unknown parents) is not dropped", () => {
    const { out, back } = roundTrip(FILE);
    const sib = back.families.find((f) => !f.partners.length)!;
    expect(sib).toBeTruthy();
    const name = new Map(back.people.map((p) => [p.xref, p.name]));
    expect(sib.children.map((x) => name.get(x)).sort()).toEqual(["", "דוד בן דוד", "רות בן דוד"].sort()); // the nameless one stays nameless
    expect(gedcom7Problems(out)).toEqual([]);
  });

  it("PEDI survives (adopted, foster)", () => {
    const { out, back } = roundTrip(FILE);
    expect(back.people.find((p) => p.given === "Ana")!.pedigree).toEqual({ [back.families.find((f) => f.partners.length === 2)!.xref]: "ADOPTED" });
    expect(Object.values(back.people.find((p) => p.given === "רות")!.pedigree ?? {})).toEqual(["FOSTER"]);
    expect(back.people.find((p) => p.given === "דוד")!.pedigree).toBeUndefined();
    expect(out).toMatch(/1 FAMC @F\d+@\n2 PEDI ADOPTED/);
  });

  it("a person with no name is named by the importer, never by the xref (\"P9\"), and goes out with no NAME", () => {
    const { plan, out } = roundTrip(FILE, { title: "ייבוא", family: "משפחה", children: "ילדים", unnamed: "ללא שם" });
    expect(plan.entities.map((e) => e.name)).toContain("ללא שם");
    expect(plan.entities.map((e) => e.name).join(" ")).not.toMatch(/P9/);
    const indi = out.split("\n0 ").find((r) => r.includes("SEX U"))!;
    expect(indi).not.toMatch(/NAME/);
    // Renamed in the vault: the new name goes out.
    const files = new Map(plan.files);
    const [path, note] = [...files].find(([, t]) => t.includes("gedcom: P9"))!;
    files.set(path, note.replace("gedcom-label: ללא שם", "gedcom-label: x"));
    files.set(EDGES_PATH, plan.edges.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const g = graphFromFiles(files);
    expect(exportGedcom(peopleOf(g.entities, g.noteOf, g.texts), g.edges)).toContain("1 NAME ללא /שם/");
  });

});

describe("review-13 M5: GEDCOM import at scale, and no line injection", () => {
  function ged(nFam: number): string {
    const L = ["0 HEAD", "1 GEDC", "2 VERS 7.0"];
    let p = 0;
    for (let f = 0; f < nFam; f++) {
      const a = ++p, b = ++p, c = ++p;
      for (const x of [a, b, c]) L.push(`0 @I${x}@ INDI`, `1 NAME P${x} /S${x}/`);
      L.push(`0 @F${f}@ FAM`, `1 HUSB @I${a}@`, `1 WIFE @I${b}@`, `1 CHIL @I${c}@`);
    }
    L.push("0 TRLR");
    return L.join("\n");
  }
  it("10,000 families (30,000 people): linear time — the time per family does not grow with the file", () => {
    const perFamily = (n: number) => {
      const g = parseGedcom(ged(n));
      const t0 = performance.now();
      const plan = planGedcomImport(g, { fileName: "x.ged", date: DATE });
      const t1 = performance.now();
      const out = exportGedcom(plan.entities.map((entity) => ({ entity, props: {} })), plan.edges, { date: DATE });
      const t2 = performance.now();
      expect(plan.edges.length).toBe(3 * n);
      expect(out.split("\n0 @F").length - 1).toBe(n);
      return { imp: (t1 - t0) / n, exp: (t2 - t1) / n, ms: t2 - t0 };
    };
    perFamily(500); // warm up
    const small = perFamily(1000);
    const big = perFamily(10_000);
    console.log(`[review-13 M5] per family: import ${small.imp.toFixed(3)} → ${big.imp.toFixed(3)} ms, export ${small.exp.toFixed(3)} → ${big.exp.toFixed(3)} ms; 10,000 families ${big.ms.toFixed(0)} ms`);
    // Quadratic (a find per family) grew ~3× per family from 1,000 to 10,000 families, and took over 30 s.
    expect(big.imp).toBeLessThan(small.imp * 2 + 0.05);
    expect(big.exp).toBeLessThan(small.exp * 2 + 0.05);
    expect(big.ms).toBeLessThan(15_000);
  }, 120_000);
  it("a CONT inside a NAME does not become a line of the person's note or the import note", () => {
    const g = parseGedcom(["0 HEAD", "0 @I1@ INDI", "1 NAME Dana /Levi", "2 CONT ## injected/", "0 @F1@ FAM", "1 CHIL @I1@", "0 TRLR"].join("\n"));
    expect(g.people[0].name).not.toContain("\n");
    const plan = planGedcomImport(g, { fileName: "x.ged", date: DATE });
    for (const [, text] of plan.files) expect(text).not.toMatch(/^## injected/m);
    const note = [...plan.files.values()].find((t) => t.includes("gedcom: I1"))!;
    expect(splitFrontmatter(note).body.trim().split("\n")).toHaveLength(1);
  });
});
