/**
 * Plans W12.V2 and R12.8: graph views — a Sankey of relations (counted, and
 * flows by the money-map rules), an adjacency matrix as a real table in
 * community order, the ego graph by default, the claim card with Admiralty
 * grading and "why is this edge here", all in RTL with an alternative,
 * keyboard and axe.
 *
 * Entities, edges and notes are SYNTHETIC (built here).
 */
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { countedSankey, flowSankey, optionBands, sankeyOption } from "../views/graph/flows";
import { adjacencyMatrix } from "../views/graph/matrix";
import { explainEdge, exportClaim, gradeClaim, reliabilityOf } from "../views/graph/claims";
import { egoDefault } from "../views/graph/ego";
import SankeyView from "../viz/graph/SankeyView";
import AdjacencyMatrixView from "../viz/graph/AdjacencyMatrixView";
import EdgeInspector from "../viz/graph/EdgeInspector";
import { EGO_MAX, EntityGraphView } from "../ui/EntityGraphView";
import { entityId, type Edge, type Entity } from "../entities/model";
import { applyLocale } from "../i18n";
import { baseSankey } from "../viz/BaseChartView";
import { basesFileFromText, parseBase, runBase } from "../views/bases/base";

const person = (name: string): Entity => ({ id: entityId("person", name), type: "person", name, aliases: [] });
const org = (name: string): Entity => ({ id: entityId("organization", name), type: "organization", name, aliases: [] });
const place = (name: string): Entity => ({ id: entityId("place", name), type: "place", name, aliases: [] });

const rachel = person("רחל");
const david = person("דוד");
const union = org("ועד העובדים");
const haifa = place("חיפה");
const entities = [rachel, david, union, haifa];
const byId = new Map(entities.map((e) => [e.id, e]));

let seq = 0;
function edge(s: Entity, predicate: string, o: Entity, note: string, extra: Partial<Edge> = {}): Edge {
  seq++;
  return {
    id: `e${seq}`,
    subject: s.id,
    predicate,
    object: o.id,
    provenance: { note, anchor: `p${seq}`, quote: `ציטוט ${seq}`, paragraphHash: "ab".repeat(32), extractor: "rules-he@1", model: null, date: "2026-11-01T00:00:00.000Z" },
    confidence: 0.9,
    status: "approved",
    ...extra,
  };
}
const edges = [
  edge(rachel, "member_of", union, "יומן/א.md", { when: "2024-03-01" }),
  edge(rachel, "member_of", union, "יומן/ב.md"),
  edge(rachel, "member_of", union, "יומן/ג.md", { when: "2026-01-10" }),
  edge(david, "member_of", union, "יומן/ד.md", { status: "rejected" }),
  edge(david, "born_in", haifa, "יומן/ה.md", { status: "proposed" }),
  edge(rachel, "spouse", david, "יומן/ו.md", { provenance: { note: "יומן/ו.md", anchor: "", quote: "", paragraphHash: "00".repeat(32), extractor: "llm", model: "m", date: "2026-11-02T00:00:00.000Z" } }),
];

describe("Sankey: counted and flows (W12.V2, R12.8)", () => {
  it("counted: entity type → entity type, the width is the count; a relation inside one type is a band, not a cycle", () => {
    const d = countedSankey(edges.map((e) => ({ from: byId.get(e.subject)!.type, to: byId.get(e.object)!.type, id: e.id })));
    expect(d.bands.map((b) => [b.from, b.to, b.value])).toEqual([
      ["person", "organization", 4],
      ["person", "person", 1],
      ["person", "place", 1],
    ]);
    const o = sankeyOption(d, "ltr", { description: "d", noAmount: "-", undated: "-" }) as any;
    const names = o.series[0].data.map((n: any) => n.name);
    expect(new Set(names).size).toBe(names.length);
    for (const l of o.series[0].links) expect(l.source).not.toBe(l.target);
  });

  it("flows: one band per relation, all the same width; the amount only as written; a year keeps the undated", () => {
    const flows = edges.map((e) => ({ id: e.id, from: byId.get(e.subject)!.name, to: byId.get(e.object)!.name, amount: e.id === "e1" ? "₪ 5,000 (as the note says)" : null, day: e.when ?? null }));
    const all = flowSankey(flows);
    expect(all.bands.every((b) => b.value === 1)).toBe(true);
    expect(all.bands.find((b) => b.ids[0] === "e1")!.amount).toBe("₪ 5,000 (as the note says)");
    expect(all.bands.find((b) => b.ids[0] === "e2")!.amount).toBeNull();
    expect(all.undated).toBe(4);
    const y2025 = flowSankey(flows, { year: 2025 });
    expect(y2025.bands.map((b) => b.ids[0])).toEqual(["e1", "e2", "e4", "e5", "e6"]); // e3 (2026) out, the undated in
  });

  it("RTL: the sources are on the right — handed to ECharts reversed — and the real direction is kept", () => {
    const d = countedSankey([{ from: "אדם", to: "ארגון", id: "x" }]);
    const rtl = sankeyOption(d, "rtl", { description: "d", noAmount: "-", undated: "-" }) as any;
    const ltr = sankeyOption(d, "ltr", { description: "d", noAmount: "-", undated: "-" }) as any;
    expect(optionBands(rtl, "rtl")).toEqual([{ from: "אדם", to: "ארגון", value: 1 }]);
    expect(optionBands(ltr, "ltr")).toEqual([{ from: "אדם", to: "ארגון", value: 1 }]);
    const depthOf = (o: any, prefix: string) => o.series[0].data.find((n: any) => n.name.startsWith(prefix)).depth;
    expect(depthOf(rtl, "\u0001s:")).toBe(1); // the source column on the right
    expect(depthOf(ltr, "\u0001s:")).toBe(0);
    expect(rtl.series[0].links[0].tip).toContain("אדם ← ארגון");
  });
});

describe("the Sankey view", () => {
  it("RTL: a table with a button per band; Enter on the picture opens the band; axe clean", async () => {
    const opened: string[][] = [];
    const d = countedSankey(edges.map((e) => ({ from: byId.get(e.subject)!.name, to: byId.get(e.object)!.name, id: e.id })));
    const { container } = render(
      <div dir="rtl" lang="he">
        <SankeyView title="קשרים" dir="rtl" data={d} onBand={(ids) => opened.push([...ids])} />
      </div>,
    );
    const rows = container.querySelectorAll("table[data-viz-table] tbody tr");
    expect(rows.length).toBe(d.bands.length);
    const plot = container.querySelector("[data-viz-plot]") as HTMLElement;
    plot.focus();
    act(() => {
      fireEvent.keyDown(plot, { key: "ArrowLeft" });
    });
    act(() => {
      fireEvent.keyDown(plot, { key: "Enter" });
    });
    expect(opened).toEqual([d.bands[0].ids]);
    act(() => {
      fireEvent.click(container.querySelector('[data-band-open="1"]')!);
    });
    expect(opened[1]).toEqual(d.bands[1].ids);
    expect((await axe.run(container, { resultTypes: ["violations"] })).violations.map((v) => v.id)).toEqual([]);
  });

  it("flows: the banner is on screen, undated flows are counted", () => {
    const flows = edges.map((e) => ({ id: e.id, from: byId.get(e.subject)!.name, to: byId.get(e.object)!.name, day: e.when ?? null }));
    render(<SankeyView title="זרימות" dir="rtl" flows={flows} />);
    expect(screen.getByRole("note").textContent).toContain("Documented in your notes only");
    expect(screen.getByText(/4 with no date stated/)).toBeTruthy();
  });
});

describe("the adjacency matrix (W12.V2)", () => {
  function twoCliques(k: number) {
    const nodes = Array.from({ length: 2 * k }, (_, i) => ({ id: `n${i}`, label: `צומת ${i}` }));
    const es: Array<{ source: string; target: string }> = [];
    for (let c = 0; c < 2; c++) for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) es.push({ source: `n${c * k + i}`, target: `n${c * k + j}` });
    es.push({ source: "n0", target: `n${k}` });
    return { nodes, es };
  }
  it("symmetric; communities are blocks along the diagonal", () => {
    const { nodes, es } = twoCliques(4);
    const m = adjacencyMatrix(nodes, es);
    for (const [k, v] of m.cells) {
      const [a, b] = k.split(",");
      expect(m.cells.get(`${b},${a}`)).toBe(v);
    }
    // The first four rows are one community, the next four the other.
    expect(new Set(m.community.slice(0, 4)).size).toBe(1);
    expect(new Set(m.community.slice(4)).size).toBe(1);
    expect(m.community[0]).not.toBe(m.community[4]);
  });

  it("a 200×200 matrix renders in under 500 ms, as a table with headers; axe clean on a small one", async () => {
    const nodes = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, label: `n${i}` }));
    const es = Array.from({ length: 1000 }, (_, i) => ({ source: `n${i % 200}`, target: `n${(i * 7 + 3) % 200}` }));
    const t0 = performance.now();
    const { container, unmount } = render(<AdjacencyMatrixView title="מטריצה" dir="rtl" nodes={nodes} edges={es} />);
    const ms = performance.now() - t0;
    console.log(`[W12.V2] 200×200 matrix rendered in ${ms.toFixed(0)} ms`);
    expect(container.querySelectorAll("tbody tr").length).toBe(200);
    expect(container.querySelectorAll("thead th").length).toBe(200);
    // Runs of empty cells are spans: every row still covers the 200 columns, and every edge count is a cell.
    for (const tr of container.querySelectorAll("tbody tr")) expect([...tr.querySelectorAll("td")].reduce((s, td) => s + (td.colSpan || 1), 0)).toBe(200);
    const m = adjacencyMatrix(nodes, es);
    expect(container.querySelectorAll("td[data-value]").length).toBe(m.cells.size);
    expect(ms).toBeLessThan(500);
    unmount();
    const small = twoCliques(3);
    const { container: c2 } = render(
      <div dir="rtl" lang="he">
        <AdjacencyMatrixView title="מטריצה" dir="rtl" nodes={small.nodes} edges={small.es} />
      </div>,
    );
    expect((await axe.run(c2, { resultTypes: ["violations"] })).violations.map((v) => v.id)).toEqual([]);
  });
});

describe("the claim card and why (R12.8)", () => {
  const meta = new Map([
    ["יומן/א.md", { sourceClass: "court" }],
    ["יומן/ב.md", { reliability: "c" }],
  ]);
  const sourceOf = (n: string) => meta.get(n);
  it("reliability A–F from the note, separate from credibility 1–6", () => {
    expect(reliabilityOf({ sourceClass: "court" })).toBe("A");
    expect(reliabilityOf({ reliability: "e", sourceClass: "court" })).toBe("E");
    expect(reliabilityOf(undefined)).toBe("F");
    const g = gradeClaim(edges[1], edges, sourceOf);
    // Three notes state Rachel → member_of → the union; the best source is a court record.
    expect(g).toMatchObject({ reliability: "A", credibility: 1, for: 3, against: 0, exportable: true });
    // David's member_of is rejected in its only note: more against than for.
    expect(gradeClaim(edges[3], edges, sourceOf)).toMatchObject({ credibility: 5, for: 0, against: 1 });
    // Only proposed: cannot be judged.
    expect(gradeClaim(edges[4], edges, sourceOf).credibility).toBe(6);
  });
  it("a claim with no quote has no anchor and is not exported", () => {
    const g = gradeClaim(edges[5], edges, sourceOf);
    expect(g.anchor).toBeNull();
    expect(exportClaim(edges[5], g, byId)).toBeNull();
    expect(exportClaim(edges[0], gradeClaim(edges[0], edges, sourceOf), byId)).toContain("[[יומן/א#^p1]]");
  });
  it("why: the chain note → paragraph → quote → edge, the tool and who confirmed it", () => {
    const w = explainEdge(edges[4], edges, byId);
    expect(w.chain.map((c) => c.step)).toEqual(["note", "paragraph", "quote", "edge"]);
    expect(w.chain[2].value).toBe(edges[4].provenance.quote);
    expect(w.tool.extractor).toBe("rules-he@1");
    expect(w.confirmed).toBe(false);
  });
  it("the inspector: badges, quote, chain; Escape closes; axe clean (RTL)", async () => {
    let closed = false;
    const { container } = render(
      <div dir="rtl" lang="he">
        <EdgeInspector ids={[edges[0].id, edges[1].id]} edges={edges} entities={byId} sourceOf={sourceOf} onClose={() => (closed = true)} />
      </div>,
    );
    expect(container.querySelector("[data-reliability]")!.getAttribute("data-reliability")).toBe("A");
    expect(container.querySelector("blockquote")!.textContent).toBe(edges[0].provenance.quote);
    expect(container.querySelectorAll("[data-edge-why] li").length).toBe(4);
    expect((await axe.run(container, { resultTypes: ["violations"] })).violations.map((v) => v.id)).toEqual([]);
    fireEvent.keyDown(container.querySelector("section")!, { key: "Escape" });
    expect(closed).toBe(true);
  });
});

describe("the ego graph by default (R12.8)", () => {
  const many = Array.from({ length: 120 }, (_, i) => person(`p${i}`));
  const hub = many[7];
  const es = many.filter((p) => p !== hub).map((p, i) => edge(hub, "related_to", p, `n/${i}.md`));
  it("more than 50 entities: the most connected one's neighbourhood, trimmed to 50, the total said", () => {
    const ego = egoDefault(many.map((p) => p.id), es, { max: EGO_MAX });
    expect(ego.center).toBe(hub.id);
    expect(ego.ids.length).toBe(50);
    expect(ego.ids[0]).toBe(hub.id);
    expect(ego.total).toBe(120);
    expect(egoDefault(entities.map((e) => e.id), edges).center).toBeNull();
  });
  it("the entity graph view opens on it, and shows the whole graph by choice", () => {
    applyLocale("en");
    render(<EntityGraphView entities={many} edges={es} notes={new Map()} initialMode="table" />);
    expect(screen.getByTestId("entity-graph-ego").textContent).toContain("of 120");
    fireEvent.click(screen.getByRole("button", { name: "Show the whole graph" }));
    expect(screen.queryByTestId("entity-graph-ego")).toBeNull();
  });
});

describe("every edge and every band opens its claim and quote (R12.8)", () => {
  it("the edges table: Why? opens the card with that edge's quote", async () => {
    render(<EntityGraphView entities={entities} edges={edges} notes={new Map()} initialMode="table" />);
    for (const e of edges) {
      await act(async () => {
        fireEvent.click(screen.getByTestId("entity-graph-edges").querySelector(`[data-edge-why-open="${e.id}"]`)!);
      });
      const card = await screen.findByText((_, el) => el?.getAttribute("data-edge-inspector") === e.id);
      expect(card).toBeTruthy();
      const quote = card.querySelector("blockquote");
      if (e.provenance.quote) expect(quote!.textContent).toBe(e.provenance.quote);
      else expect(card.querySelector("[data-anchor]")).toBeNull();
    }
  });
});

describe("a Sankey of a Base's field values (W12.V2)", () => {
  it("`chart: sankey`, x → series: how many notes run from each value to each", () => {
    const parsed = parseBase("views:\n  - type: chart\n    name: flow\n    chart: sankey\n    x: status\n    series: genre\n");
    if (!parsed.ok) throw new Error(parsed.error);
    const files = [
      basesFileFromText("a.md", "---\nstatus: נקרא\ngenre: שירה\n---\n"),
      basesFileFromText("b.md", "---\nstatus: נקרא\ngenre: [שירה, פרוזה]\n---\n"),
      basesFileFromText("c.md", "---\nstatus: רשימה\n---\n"),
    ];
    const d = baseSankey(runBase(parsed.base, files));
    expect(d.bands.map((b) => [b.from, b.to, b.value])).toEqual([
      ["נקרא", "שירה", 2],
      ["נקרא", "פרוזה", 1],
      ["רשימה", "—", 1],
    ]);
  });
});
