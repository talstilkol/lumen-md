/**
 * Plan W12.V4: the argument map — built-in `claim` and `evidence` types
 * with supports / contradicts / qualifies (typed relations, W12.T6),
 * layered sources → claims → conclusions, RTL, a flag on a claim without a
 * source, export to JSON Canvas and Excalidraw, and a nested list as the
 * alternative. The notes are SYNTHETIC.
 */
import { describe, expect, it } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import axe from "axe-core";
import { argumentTypes } from "../argument/argumentTypes";
import { argumentBoxes, argumentGraph, argumentToJsonCanvas, layoutArgument, linkTargets, readingOrder, unsupportedClaims, type ArgNoteInput } from "../argument/argumentMap";
import { ArgumentMapView, frontmatterOf, parseArgumentBlock, relationLabels } from "../viz/ArgumentMapBlock";
import { loadTypeRegistry, typesOfNote } from "../types/typeRegistry";
import { parseJsonCanvas, jsonCanvasToExcalidraw } from "../canvas/jsonCanvas";

const note = (path: string, fm: string): ArgNoteInput => ({ path, fm: frontmatterOf(`---\n${fm}\n---\n`) });
const NOTES: ArgNoteInput[] = [
  note("מחקר/דוח הלמ״ס.md", "type: evidence\nsupports: ['[[השכר עלה]]']"),
  note("מחקר/ראיון.md", "type: evidence\nsupports: ['[[השכר עלה]]']\nqualifies: ['[[רק בהייטק]]']"),
  note("מחקר/כתבה.md", "type: evidence\ncontradicts: ['[[השכר עלה]]']"),
  note("מחקר/השכר עלה.md", "type: claim\nsupports: ['[[המדיניות הצליחה]]']"),
  note("מחקר/רק בהייטק.md", "type: claim\nsupports: [\"[[המדיניות הצליחה|הצלחה]]\"]"),
  note("מחקר/המדיניות הצליחה.md", "type: claim\nconclusion: true"),
  note("מחקר/השערה פרועה.md", "type: טענה\nsupports: ['[[המדיניות הצליחה]]']"),
  note("מחקר/סתם פתק.md", "title: not part of it"),
];

describe("the argument types (W12.V4)", () => {
  it("claim and evidence are built-in types with the three relations to claims", () => {
    const reg = loadTypeRegistry([], argumentTypes());
    expect(reg.errors).toEqual([]);
    const claim = reg.types.get("claim")!;
    expect(claim.label).toEqual({ he: "טענה", en: "Claim" });
    expect(claim.fields.filter((f) => f.kind === "relation").map((f) => [f.name, f.to, f.multiple])).toEqual([
      ["supports", "claim", true],
      ["contradicts", "claim", true],
      ["qualifies", "claim", true],
    ]);
    expect(reg.types.get("evidence")!.label.he).toBe("מקור");
    expect(typesOfNote(reg, { path: "x.md", fm: { type: "claim" }, tags: [] }).types.map((x) => x.id)).toEqual(["claim"]);
  });
});

describe("the graph and its layout", () => {
  const g = argumentGraph(NOTES);
  it("nodes of the two types only; relations resolved by name, alias and list; the Hebrew label counts as the type", () => {
    expect(g.nodes.map((n) => [n.label, n.kind])).toEqual([
      ["דוח הלמ״ס", "source"],
      ["ראיון", "source"],
      ["כתבה", "source"],
      ["השכר עלה", "claim"],
      ["רק בהייטק", "claim"],
      ["המדיניות הצליחה", "conclusion"],
      ["השערה פרועה", "claim"],
    ]);
    expect(g.edges.length).toBe(7);
    expect(g.edges.find((e) => e.from.endsWith("כתבה.md"))!.relation).toBe("contradicts");
    expect(linkTargets(["[[A|b]]", "C"])).toEqual(["A", "C"]);
  });
  it("a claim without a source is flagged (a contradiction is not support)", () => {
    expect([...unsupportedClaims(g)]).toEqual(["מחקר/השערה פרועה.md"]);
    const onlyAgainst = argumentGraph([note("a.md", "type: evidence\ncontradicts: ['[[b]]']"), note("b.md", "type: claim")]);
    expect([...unsupportedClaims(onlyAgainst)]).toEqual(["b.md"]);
  });
  it("layers: sources → claims → conclusions; a cycle doesn't hang the layout", () => {
    const lo = layoutArgument(g);
    expect(lo.layers.map((l) => l.map((id) => id.split("/")[1].replace(".md", "")))).toEqual([
      ["דוח הלמ״ס", "ראיון", "כתבה"],
      ["השכר עלה", "רק בהייטק", "השערה פרועה"],
      ["המדיניות הצליחה"],
    ]);
    const cyc = argumentGraph([note("a.md", "type: claim\nsupports: ['[[b]]']"), note("b.md", "type: claim\nsupports: ['[[a]]']")]);
    expect(layoutArgument(cyc).layers.flat().sort()).toEqual(["a.md", "b.md"]);
  });
  it("RTL: the sources are on the right", () => {
    const lo = layoutArgument(g);
    const rtl = argumentBoxes(lo, "rtl");
    const ltr = argumentBoxes(lo, "ltr");
    const src = "מחקר/דוח הלמ״ס.md";
    const end = "מחקר/המדיניות הצליחה.md";
    expect(rtl.get(src)!.x).toBeGreaterThan(rtl.get(end)!.x);
    expect(ltr.get(src)!.x).toBeLessThan(ltr.get(end)!.x);
  });
  it("export: a valid JSON Canvas of file nodes and labelled, coloured edges, and an Excalidraw scene from it", () => {
    const canvas = argumentToJsonCanvas(g, layoutArgument(g), "rtl", { supports: "תומך", contradicts: "סותר", qualifies: "מסייג" });
    const { canvas: back, warnings } = parseJsonCanvas(JSON.stringify(canvas));
    expect(warnings).toEqual([]);
    expect(back.nodes.length).toBe(7);
    expect(back.nodes.every((n) => n.type === "file")).toBe(true);
    expect(back.edges.map((e) => e.label).sort()).toEqual(["מסייג", "סותר", "תומך", "תומך", "תומך", "תומך", "תומך"].sort());
    expect(back.edges.find((e) => e.label === "סותר")!.color).toBe("1");
    const ex = jsonCanvasToExcalidraw(canvas, { updated: 0 });
    expect(ex.file.elements.length).toBeGreaterThan(7);
  });
  it("the block's options", () => {
    expect(parseArgumentBlock("folder: /מחקר/")).toEqual({ folder: "מחקר" });
    expect(parseArgumentBlock("")).toEqual({ folder: "" });
  });
});

describe("the map view", () => {
  const g = argumentGraph(NOTES);
  for (const dir of ["rtl", "ltr"] as const)
    it(`${dir}: arrows walk the notes layer by layer, Enter opens; the list and the flag; axe clean`, async () => {
      const opened: string[] = [];
      const { container, getByRole } = render(
        <div dir={dir} lang={dir === "rtl" ? "he" : "en"}>
          <ArgumentMapView g={g} dir={dir} title="מפה" onOpen={(p) => opened.push(p)} />
        </div>,
      );
      const plot = container.querySelector("[data-viz-plot]") as HTMLElement;
      plot.focus();
      const next = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
      const order = readingOrder(layoutArgument(g));
      for (let i = 0; i < 4; i++)
        act(() => {
          fireEvent.keyDown(plot, { key: next });
        });
      act(() => {
        fireEvent.keyDown(plot, { key: "Enter" });
      });
      expect(opened).toEqual([order[3]]);
      // The SVG marks the unsupported claim.
      expect(container.querySelector('[data-node="מחקר/השערה פרועה.md"] rect')!.getAttribute("stroke-width")).toBe("3");
      expect((await axe.run(container, { resultTypes: ["violations"] })).violations.map((v) => v.id)).toEqual([]);
      act(() => {
        fireEvent.click(getByRole("button", { expanded: false }));
      });
      const list = container.querySelector(".lumen-viz-arg-list")!;
      expect((list as HTMLElement).hidden).toBe(false);
      const claim = list.querySelector('[data-claim="מחקר/השכר עלה.md"]')!;
      expect([...claim.querySelectorAll("li")].map((li) => li.getAttribute("data-relation"))).toEqual(["supports", "supports", "contradicts"]);
      expect(list.querySelector('[data-claim="מחקר/השערה פרועה.md"]')!.textContent).toContain("no source");
      expect((await axe.run(container, { resultTypes: ["violations"] })).violations.map((v) => v.id)).toEqual([]);
      expect(Object.keys(relationLabels())).toEqual(["supports", "contradicts", "qualifies"]);
    });
});
