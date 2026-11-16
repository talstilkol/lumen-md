/**
 * W13.G12 — the graph view exported: SVG with Hebrew labels in their own
 * direction (500 nodes, parsed back by the browser's XML parser), labels
 * cut by grapheme and never inside a letter's niqqud, GEXF 1.3 with viz
 * and typed attributes that passes the schema's rules
 * (helpers/gexf13.ts) and reads back with the same relations, and the
 * "Export view" menu: the file it hands over, its name, an empty view.
 * The PNG path needs a real canvas; it is checked in headless Chromium
 * (the lane's harness; screenshot in the PR).
 */
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement as h } from "react";
import { clipGraphemes, labelDirection, sceneToGexf, sceneToSvg, type Scene } from "../graph/exportImage";
import { GraphExportMenu, exportFileName } from "../ui/graph/GraphExportMenu";
import { entityScene } from "../ui/graph/entityScene";
import { EntityGraphView } from "../ui/EntityGraphView";
import { entityId, type Edge, type Entity, type EntityType } from "../entities/model";
import { gexf13Problems, localOf } from "./helpers/gexf13";

const NAMES = ["דוד בן־גוריון", "Tel Aviv", "תל אביב 2026", "iPhone של דנה", "שָׁלוֹם", "123", "רמב״ם", "Alice & <Bob>"];
function bigScene(n: number): Scene {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `${NAMES[i % NAMES.length]} ${i}`, x: Math.cos(i) * i, y: Math.sin(i) * i, color: [0.2, 0.4, 0.8, 1] as const, size: 4 + (i % 5), kind: i % 2 ? "person" : "place", attrs: { rank: i, score: i / 7, ok: i % 3 === 0 } }));
  const edges = Array.from({ length: n * 2 }, (_, i) => ({ source: `n${i % n}`, target: `n${(i * 7 + 1) % n}`, relation: i % 2 ? "born_in" : "member_of", attrs: { confidence: (i % 10) / 10 } }));
  return { title: "גרף ישויות", description: "500 צמתים", lang: "he", nodes, edges };
}
const parse = (s: string, type: DOMParserSupportedType) => new DOMParser().parseFromString(s, type);

describe("W13.G12 labels", () => {
  it("direction by the first strong character; numbers and punctuation first do not decide", () => {
    expect(labelDirection("תל אביב 2026")).toBe("rtl");
    expect(labelDirection("2026 תל אביב")).toBe("rtl");
    expect(labelDirection("iPhone של דנה")).toBe("ltr");
    expect(labelDirection("«רמב״ם»")).toBe("rtl");
    expect(labelDirection("123")).toBe("ltr");
    expect(labelDirection("مرحبا")).toBe("rtl");
  });
  it("cuts by grapheme: niqqud stays on its letter", () => {
    const s = "שָׁלוֹם עֲלֵיכֶם";
    const cut = clipGraphemes(s, 4);
    expect(cut).toBe("שָׁלוֹ…");
    expect(cut.normalize("NFD").replace(/[֑-ׇ]/g, "")).toBe("שלו…");
    expect(clipGraphemes("short", 40)).toBe("short");
  });
});

describe("W13.G12 SVG", () => {
  it("500 nodes: well-formed SVG with a title, a description and one label per node, each in its direction", () => {
    const svg = sceneToSvg(bigScene(500));
    const doc = parse(svg, "image/svg+xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const root = doc.documentElement;
    expect(root.getAttribute("xmlns") ?? root.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(root.getAttribute("lang")).toBe("he");
    expect(doc.querySelector("title")!.textContent).toBe("גרף ישויות");
    expect(doc.getElementsByTagName("circle")).toHaveLength(500);
    expect(doc.getElementsByTagName("line")).toHaveLength(1000);
    const texts = Array.from(doc.getElementsByTagName("text"));
    expect(texts).toHaveLength(500);
    const byText = new Map(texts.map((t) => [t.textContent!, t.getAttribute("direction")]));
    expect(byText.get("תל אביב 2026 2")).toBe("rtl");
    expect(byText.get("iPhone של דנה 3")).toBe("ltr");
    expect(byText.get("Tel Aviv 1")).toBe("ltr");
    expect(byText.get("Alice & <Bob> 7")).toBe("ltr"); // escaped in the file, read back as written
    expect(svg).toContain("unicode-bidi:plaintext");
    // Every coordinate is a finite number inside the picture.
    const W = Number(root.getAttribute("width"));
    const H = Number(root.getAttribute("height"));
    for (const c of Array.from(doc.getElementsByTagName("circle"))) {
      const x = Number(c.getAttribute("cx"));
      const y = Number(c.getAttribute("cy"));
      expect(x >= 0 && x <= W && y >= 0 && y <= H).toBe(true);
    }
  });

  it("one node, no edges, and no nodes at all still give a valid picture", () => {
    for (const nodes of [[], [{ id: "a", label: "א", x: 0, y: 0, color: [0, 0, 0, 1] as const, size: 4 }]]) {
      const doc = parse(sceneToSvg({ title: "x", nodes, edges: [] }), "image/svg+xml");
      expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
      expect(Number(doc.documentElement.getAttribute("height"))).toBeGreaterThan(0);
    }
  });
});

describe("W13.G12 GEXF 1.3", () => {
  it("passes the schema's rules and reads back with the same nodes, relations, positions and attributes", () => {
    const scene = bigScene(500);
    const text = sceneToGexf(scene, "2026-11-17");
    const doc = parse(text, "application/xml");
    expect(gexf13Problems(doc)).toEqual([]);
    const nodes = Array.from(doc.getElementsByTagNameNS("http://gexf.net/1.3", "node"));
    const edges = Array.from(doc.getElementsByTagNameNS("http://gexf.net/1.3", "edge"));
    expect(nodes).toHaveLength(500);
    expect(edges).toHaveLength(1000);
    expect(nodes[2].getAttribute("label")).toBe("תל אביב 2026 2");
    const decl = new Map(Array.from(doc.getElementsByTagNameNS("http://gexf.net/1.3", "attribute")).map((a) => [`${(a.parentNode as Element).getAttribute("class")}:${a.getAttribute("title")}`, a.getAttribute("type")]));
    expect(Object.fromEntries(decl)).toEqual({ "node:kind": "string", "node:rank": "integer", "node:score": "double", "node:ok": "boolean", "edge:relation": "string", "edge:confidence": "double" });
    // Round trip: the relation of each edge and the position of each node.
    const relFor = Array.from(doc.getElementsByTagNameNS("http://gexf.net/1.3", "attribute")).find((a) => a.getAttribute("title") === "relation")!.getAttribute("id");
    const back = edges.map((e) => `${e.getAttribute("source")}>${e.getAttribute("target")}:${Array.from(e.getElementsByTagNameNS("http://gexf.net/1.3", "attvalue")).find((v) => v.getAttribute("for") === relFor)!.getAttribute("value")}`);
    expect(back).toEqual(scene.edges.map((e) => `${e.source}>${e.target}:${e.relation}`));
    const pos = Array.from(nodes[7].children).find((c) => localOf(c) === "position")!;
    expect(Number(pos.getAttribute("x"))).toBeCloseTo(scene.nodes[7].x, 1);
    expect(Number(pos.getAttribute("y"))).toBeCloseTo(-scene.nodes[7].y, 1); // screen y runs down, Gephi's up
  });

  it("the checker catches what the schema forbids", () => {
    const bad = sceneToGexf({ title: "x", nodes: [{ id: "a", label: "a", x: 0, y: 0, color: [0, 0, 0, 1], size: 1 }], edges: [] })
      .replace('<viz:color r="0"', '<viz:color r="300"')
      .replace("</nodes>", '</nodes>\n<edges><edge id="e0" source="a" target="zz"/></edges>');
    expect(gexf13Problems(parse(bad, "application/xml"))).toEqual(expect.arrayContaining(["viz:color/@r", "edge e0 target is not a node"]));
  });

  it("an edge whose end is not in the view is left out", () => {
    const doc = parse(sceneToGexf({ title: "x", nodes: [{ id: "a", label: "a", x: 0, y: 0, color: [0, 0, 0, 1], size: 1 }], edges: [{ source: "a", target: "gone" }] }), "application/xml");
    expect(gexf13Problems(doc)).toEqual([]);
    expect(doc.getElementsByTagNameNS("http://gexf.net/1.3", "edge")).toHaveLength(0);
  });
});

describe("W13.G12 export menu", () => {
  const ent = (type: EntityType, name: string, extra: Partial<Entity> = {}): Entity => ({ id: entityId(type, name), type, name, aliases: [], ...extra });
  const dana = ent("person", "דנה כהן", { qid: "Q42", aliases: ["Dana"] });
  const haifa = ent("place", "חיפה");
  const prov = { note: "יומן/א.md", anchor: "a1", quote: "דנה נולדה בחיפה", paragraphHash: `sha256:${"0".repeat(64)}`, extractor: "user", model: null, date: "2026-11-01T00:00:00Z" };
  const born: Edge = { id: "e1", subject: dana.id, predicate: "born_in", object: haifa.id, provenance: prov, confidence: 0.9, status: "approved", when: "1990-01-01" };

  it("the entity scene carries positions, colours and provenance into GEXF", () => {
    const scene = entityScene({ title: "גרף", nodes: [dana, haifa], edges: [born], positions: new Float32Array([1, 2, 3, 4]), colors: new Float32Array([1, 0, 0, 1, 0, 0, 1, 1]), sizes: new Float32Array([4, 6]) });
    const doc = parse(sceneToGexf(scene, "2026-11-17"), "application/xml");
    expect(gexf13Problems(doc)).toEqual([]);
    const text = new XMLSerializer().serializeToString(doc);
    for (const s of ['value="Q42"', 'value="Dana"', 'value="born_in"', 'value="0.9"', 'value="דנה נולדה בחיפה"', 'value="1990-01-01"', 'r="255" g="0" b="0"']) expect(text).toContain(s);
  });

  it("hands over the file with a Hebrew-safe name; an empty view says so", async () => {
    expect(exportFileName("גרף ישויות: מִשְׁפָּחָה", "svg")).toBe("גרף-ישויות-משפחה.svg");
    expect(exportFileName("///", "gexf")).toBe("graph.gexf");
    const got: Array<{ blob: Blob; name: string }> = [];
    const scene = entityScene({ title: "גרף ישויות", nodes: [dana, haifa], edges: [born], positions: new Float32Array([0, 0, 10, 10]), colors: new Float32Array(8).fill(1), sizes: new Float32Array([4, 4]) });
    const { unmount } = render(h(GraphExportMenu, { scene: async () => scene, onFile: (blob: Blob, name: string) => got.push({ blob, name }) }));
    for (const [i, f] of ["svg", "gexf"].entries()) {
      await act(async () => void fireEvent.change(screen.getByTestId("graph-export-view"), { target: { value: f } }));
      await waitFor(() => expect(got).toHaveLength(i + 1));
    }
    expect(got.map((g) => g.name)).toEqual(["גרף-ישויות.svg", "גרף-ישויות.gexf"]);
    expect(got[0].blob.type).toContain("image/svg+xml");
    const svg = await got[0].blob.text();
    expect(svg).toContain('direction="rtl"');
    expect(svg).toContain("דנה כהן");
    expect(screen.getByTestId("graph-export-view-status").textContent).toContain("גרף-ישויות.gexf");
    unmount();
    render(h(GraphExportMenu, { scene: async () => ({ title: "x", nodes: [], edges: [] }), onFile: () => got.push({ blob: new Blob(), name: "no" }) }));
    await act(async () => void fireEvent.change(screen.getByTestId("graph-export-view"), { target: { value: "svg" } }));
    await waitFor(() => expect(screen.getByTestId("graph-export-view-status").textContent).not.toBe(""));
    await waitFor(() => expect(screen.getByTestId("graph-export-view-status").textContent).not.toMatch(/working|מכין/i));
    expect(got).toHaveLength(2);
  });

  it("the entity graph view offers it", () => {
    render(h(EntityGraphView, { entities: [dana, haifa], edges: [born], notes: new Map([["יומן/א.md", { tags: [] }]]), initialMode: "table" }));
    const sel = screen.getByTestId("entity-graph-export-view") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(["", "svg", "png", "gexf"]);
  });
});
