/**
 * W13.G11 — the graph without the picture: the summary sentence (counts,
 * Leiden clusters, hubs, kinds) that a live region speaks and that follows
 * the filters; the list mode (current node, neighbours grouped by relation,
 * Enter moves there, Backspace back); and the check that the table, the
 * list and the graph show the same nodes. In Hebrew, RTL; axe on the list.
 * Synthetic vault.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement as h } from "react";
import axe from "axe-core";
import { applyLocale, loadLocale } from "../i18n";
import { EntityGraphView } from "../ui/EntityGraphView";
import { GraphListView } from "../ui/graph/GraphListView";
import { SETTLE_MS, summaryText } from "../ui/graph/GraphSummary";
import { entityAltGraph, relationHeading } from "../ui/graph/entityAlt";
import { neighbourGroups, nodeIds, summarize, LEIDEN_MAX, type AltGraph } from "../graph/textAlt";
import { visibleGraph, type NoteInfo } from "../entities/view";
import { entityId, type Edge, type Entity, type EntityType } from "../entities/model";

const ent = (type: EntityType, name: string): Entity => ({ id: entityId(type, name), type, name, aliases: [] });
const prov = (q: string) => ({ note: "יומן/א.md", anchor: "a1", quote: q, paragraphHash: `sha256:${"0".repeat(64)}`, extractor: "user", model: null, date: "2026-11-01T00:00:00Z" });
const edge = (s: Entity, p: string, o: Entity): Edge => ({ id: `${s.id}|${p}|${o.id}`, subject: s.id, predicate: p, object: o.id, provenance: prov(`${s.name} ${o.name}`), confidence: 1, status: "approved" });

// Three families of people (three clusters), one bridge, one place, one lone concept.
const abraham = ent("person", "אברהם");
const sarah = ent("person", "שרה");
const isaac = ent("person", "יצחק");
const rivka = ent("person", "רבקה");
const jacob = ent("person", "יעקב");
const david = ent("person", "דוד");
const solomon = ent("person", "שלמה");
const bathsheba = ent("person", "בת שבע");
const hebron = ent("place", "חברון");
const lone = ent("concept", "מושג בודד");
const ENTITIES = [abraham, sarah, isaac, rivka, jacob, david, solomon, bathsheba, hebron, lone];
const EDGES = [
  edge(abraham, "spouse", sarah),
  edge(abraham, "child", isaac),
  edge(sarah, "child", isaac),
  edge(isaac, "spouse", rivka),
  edge(isaac, "child", jacob),
  edge(rivka, "child", jacob),
  edge(david, "spouse", bathsheba),
  edge(david, "child", solomon),
  edge(bathsheba, "child", solomon),
  edge(abraham, "died_in", hebron),
  edge(sarah, "died_in", hebron),
  edge(isaac, "born_in", hebron),
];
const NOTES = new Map<string, NoteInfo>([["יומן/א.md", { tags: [] }]]);

async function axeClean(el: Element) {
  const r = await axe.run(el, { rules: { "color-contrast": { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

beforeEach(async () => {
  document.documentElement.dir = "rtl";
  document.documentElement.lang = "he";
  await loadLocale("he");
  applyLocale("he");
});
afterEach(() => {
  applyLocale("en");
  document.documentElement.dir = "";
});

describe("W13.G11 summary", () => {
  it("counts nodes, links, Leiden clusters, the unconnected, hubs and kinds", () => {
    const alt = entityAltGraph(visibleGraph(ENTITIES, EDGES, NOTES, {}));
    const s = summarize(alt);
    expect(s).toMatchObject({ nodes: 10, edges: 12, unconnected: 1, clusterMethod: "leiden" });
    // Two families of people: Abraham's line with Hebron, and David's; Leiden may split the first in two, never merge with David.
    expect(s.clusters).toBeGreaterThanOrEqual(2);
    expect(s.hubs[0]).toMatchObject({ label: "יצחק", degree: 5 });
    expect(s.kinds).toEqual([
      { kind: "person", count: 8 },
      { kind: "concept", count: 1 },
      { kind: "place", count: 1 },
    ]);
    const text = summaryText(s, (k, n) => (k === "person" ? `${n} אנשים` : `${n} ${k}`));
    expect(text).toContain("10 צמתים");
    expect(text).toContain("12 קשרים");
    expect(text).toContain(`${s.clusters} אשכולות`);
    expect(text).toContain("אחד בלי קשרים");
    // A hub's Hebrew name is isolated (FSI…PDI) from its count.
    expect(text).toContain("⁨יצחק⁩ (5)");
  });

  it("an empty view says so; a huge one counts connected groups and says it", () => {
    expect(summaryText(summarize({ nodes: [], edges: [] }))).toBe("אין מה להציג עם המסננים האלה.");
    const n = LEIDEN_MAX + 2;
    const big: AltGraph = { nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `n${i}` })), edges: Array.from({ length: n / 2 }, (_, i) => ({ source: `n${2 * i}`, target: `n${2 * i + 1}` })) };
    const t0 = performance.now();
    const s = summarize(big);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(s).toMatchObject({ clusterMethod: "components", clusters: n / 2, unconnected: 0 });
    expect(summaryText(s)).toContain(`${n / 2} קבוצות מחוברות`);
  });

  it("the live region follows the filters (after they settle)", async () => {
    render(h(EntityGraphView, { entities: ENTITIES, edges: EDGES, notes: NOTES, initialMode: "table" }));
    const live = screen.getByTestId("entity-graph-summary");
    expect(live.getAttribute("aria-live")).toBe("polite");
    await act(() => new Promise((r) => setTimeout(r, SETTLE_MS + 50)));
    expect(live.textContent).toContain("10 צמתים");
    expect(live.textContent).toContain("8 אנשים");
    // Hide places: Hebron and its three links leave the sentence.
    fireEvent.click(screen.getByRole("checkbox", { name: /מקום/ }));
    expect(live.textContent).toContain("10 צמתים"); // not yet: it waits for the filters to settle
    await act(() => new Promise((r) => setTimeout(r, SETTLE_MS + 50)));
    expect(live.textContent).toContain("9 צמתים");
    expect(live.textContent).toContain("9 קשרים");
  });
});

describe("W13.G11 neighbours by relation", () => {
  it("groups outgoing then incoming, by relation, once per neighbour", () => {
    const alt = entityAltGraph(visibleGraph(ENTITIES, [...EDGES, edge(abraham, "child", isaac)], NOTES, {}));
    const g = neighbourGroups(alt, isaac.id);
    expect(g.map((x) => `${x.direction}:${x.relation}:${x.nodes.map((n) => n.label).join(",")}`)).toEqual(["out:born_in:חברון", "out:child:יעקב", "out:spouse:רבקה", "in:child:אברהם,שרה"]);
    expect(relationHeading("child", "in")).toBe("הורים");
    expect(relationHeading("spouse", "in")).toBe("בן/בת זוג של");
    expect(relationHeading("position_held", "in")).toBe("נכנס: מכהן כ");
  });
});

describe("W13.G11 list mode", () => {
  it("Enter on a neighbour moves there and focuses its heading; Backspace goes back; axe clean", async () => {
    const alt = entityAltGraph(visibleGraph(ENTITIES, EDGES, NOTES, {}));
    const { container } = render(h(GraphListView, { graph: alt, relationLabel: relationHeading, kindLabel: (k: string) => k }));
    const heading = () => screen.getByTestId("graph-list-current");
    // Starts from the most connected node.
    expect(heading().textContent).toBe("יצחק");
    expect(screen.getByTestId("graph-list-desc").textContent).toContain("שכנים: 5");
    const list = screen.getByTestId("graph-list");
    // ↓ reaches the first neighbour (the outgoing "born in" group).
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect((document.activeElement as HTMLElement).textContent).toBe("חברון");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect((document.activeElement as HTMLElement).textContent).toBe("יעקב");
    fireEvent.keyDown(list, { key: "End" });
    expect((document.activeElement as HTMLElement).textContent).toBe("שרה");
    await act(async () => void fireEvent.click(document.activeElement as HTMLElement));
    expect(heading().textContent).toBe("שרה");
    expect(document.activeElement).toBe(heading());
    const groups = [...container.querySelectorAll("[data-group]")].map((x) => x.getAttribute("data-group"));
    expect(groups).toEqual(["out:child", "out:died_in", "in:spouse"]);
    await act(async () => void fireEvent.keyDown(list, { key: "Backspace" }));
    expect(heading().textContent).toBe("יצחק");
    expect(document.activeElement).toBe(heading());
    expect((screen.getByTestId("graph-list-back") as HTMLButtonElement).disabled).toBe(true);
    await axeClean(container);
  });

  it("a node with no neighbour says so; an empty graph says so", () => {
    const alt = entityAltGraph(visibleGraph(ENTITIES, EDGES, NOTES, {}));
    const { unmount } = render(h(GraphListView, { graph: alt, start: lone.id, relationLabel: relationHeading }));
    expect(screen.getByText("אין שכנים.")).toBeTruthy();
    unmount();
    render(h(GraphListView, { graph: { nodes: [], edges: [] }, relationLabel: relationHeading }));
    expect(screen.getByTestId("graph-list-empty")).toBeTruthy();
  });
});

describe("W13.G11 the table, the list and the graph show the same nodes", () => {
  it("unfiltered and filtered", async () => {
    const { container } = render(h(EntityGraphView, { entities: ENTITIES, edges: EDGES, notes: NOTES, initialMode: "table" }));
    const mode = screen.getByTestId("entity-graph-mode") as HTMLSelectElement;
    const check = async (filter: Parameters<typeof visibleGraph>[3]) => {
      // The graph: what the canvas is given is `visibleGraph` (EntityGraphView passes its nodes to GraphCanvas).
      const graph = nodeIds(entityAltGraph(visibleGraph(ENTITIES, EDGES, NOTES, filter)));
      // The canvas: its accessible name counts the nodes it was given.
      await act(async () => void fireEvent.change(mode, { target: { value: "graph" } }));
      const canvas = container.querySelector("[role=application]");
      expect(canvas?.getAttribute("aria-label")).toContain(String(graph.length));
      await act(async () => void fireEvent.change(mode, { target: { value: "table" } }));
      const table = [...within(screen.getByTestId("entity-graph-nodes")).getAllByRole("row")].map((r) => r.getAttribute("data-node")).filter(Boolean).sort();
      await act(async () => void fireEvent.change(mode, { target: { value: "list" } }));
      const goto = (await screen.findByTestId("graph-list-goto")) as HTMLSelectElement;
      const list = [...goto.options].map((o) => o.value).sort();
      expect(table).toEqual(graph);
      expect(list).toEqual(graph);
      return graph.length;
    };
    expect(await check({})).toBe(10);
    fireEvent.click(screen.getByRole("checkbox", { name: /מושג/ }));
    expect(await check({ types: new Set<EntityType>(["person", "place", "organization", "event", "law", "source"]) })).toBe(9);
    expect(container.querySelector("[data-testid=graph-list]")).toBeTruthy();
  });
});
