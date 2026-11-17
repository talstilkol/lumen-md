/**
 * W12.E5–E7 (UI) — in RTL: the review panel (20 proposals, keyboard
 * select and approve, merge, split, undo back to the same bytes), the
 * entity page (each edge links to an existing paragraph), and the graph
 * view's table (a relation filter and the time slider narrow exactly the
 * relations the graph is given; ←/→ step to neighbours). axe on each.
 * Synthetic vault.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { useState } from "react";
import { EntityReviewPanel } from "../ui/EntityReviewPanel";
import { EntityGraphView } from "../ui/EntityGraphView";
import { EntityPage } from "../ui/EntityPage";
import { edgeId, entityId, type Edge, type EntityType } from "../entities/model";
import { makeProvenance } from "../entities/provenance";
import { PROPOSALS_PATH, toJsonl, type Proposal } from "../entities/store";
import { approve, edgesOf, entitiesOf, proposalsOf, type Files, type OpResult } from "../entities/review";
import { visibleGraph } from "../entities/view";

const NOTE = "יומן/א.md";
const TEXT = "דוד כהן נולד בחיפה. ^a1\n\nרחל לוי חברה בוועד השכונה. ^b2";
const ent = (type: EntityType, name: string): Proposal => ({ kind: "entity", id: `p:${entityId(type, name)}`, type, name, aliases: [], mentions: [{ note: NOTE, anchor: null, paragraphHash: "sha256:" + "0".repeat(64), start: 0, end: 2, text: name }], extractor: "lumen-rules@1", model: null, confidence: 1 });
const edge = (s: string, p: string, o: string, para: string, quote: string, anchor: string): Proposal => {
  const e: Edge = { id: edgeId(s, p, o, NOTE, anchor), subject: s, predicate: p, object: o, provenance: makeProvenance({ note: NOTE, anchor, paragraph: para, quote, extractor: "lumen-relations@1", model: "ollama:t", date: new Date("2026-11-15T00:00:00Z") }), confidence: 0.8, status: "proposed" };
  return { kind: "edge", id: e.id, edge: e };
};
const david = entityId("person", "דוד כהן");
const rachel = entityId("person", "רחל לוי");
const haifa = entityId("place", "חיפה");
const committee = entityId("organization", "ועד השכונה");

function vault(): Map<string, string> {
  const props: Proposal[] = [ent("person", "דוד כהן"), ent("person", "רחל לוי"), ent("place", "חיפה"), ent("organization", "ועד השכונה"), ...Array.from({ length: 14 }, (_, i) => ent("concept", `מושג ${i + 1}`)), edge(david, "born_in", haifa, "דוד כהן נולד בחיפה.", "דוד כהן נולד בחיפה", "a1"), edge(rachel, "member_of", committee, "רחל לוי חברה בוועד השכונה.", "רחל לוי חברה בוועד השכונה", "b2")];
  return new Map([[NOTE, TEXT], [PROPOSALS_PATH, toJsonl(props)]]);
}
const bytes = (f: Files) => JSON.stringify([...f].sort(([a], [b]) => a.localeCompare(b)));

async function axeClean(el: Element) {
  const r = await axe.run(el, { rules: { "color-contrast": { enabled: false } } });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

beforeEach(() => {
  document.documentElement.dir = "rtl";
  document.documentElement.lang = "he";
});
afterEach(() => {
  document.documentElement.dir = "";
});

function Harness({ start }: { start: Map<string, string> }) {
  const [files, setFiles] = useState<Files>(start);
  (globalThis as { __files?: Files }).__files = files;
  return <EntityReviewPanel files={files} onApply={(r: OpResult) => setFiles(r.files)} notices={["rules-only"]} />;
}

describe("W12.E5 review panel in RTL", () => {
  it("20 proposals; keyboard select + approve, merge, split, undo restore the bytes", async () => {
    const v0 = vault();
    render(<Harness start={v0} />);
    const files = () => (globalThis as { __files?: Files }).__files!;
    const list = screen.getByRole("listbox");
    expect(within(list).getAllByRole("option")).toHaveLength(20);
    expect(screen.getByRole("note").textContent).toMatch(/./);
    // Keyboard: select the first four entities (people, place, org) and approve.
    list.focus();
    for (let i = 0; i < 4; i++) {
      fireEvent.keyDown(list, { key: " " });
      fireEvent.keyDown(list, { key: "ArrowDown" });
    }
    await act(async () => void fireEvent.keyDown(list, { key: "a" }));
    expect(entitiesOf(files())).toHaveLength(4);
    const v1 = files();
    // Approve the remaining edges and concepts with the button.
    for (let i = 0; i < 16; i++) fireEvent.keyDown(screen.getByRole("listbox"), { key: " " }), fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /^Approve 16/ })));
    expect(proposalsOf(files())).toHaveLength(0);
    expect(edgesOf(files())).toHaveLength(2);
    const v2 = files();
    // Merge מושג 2 into מושג 1.
    const [keepSel, goneSel] = screen.getAllByRole("combobox").slice(0, 2);
    fireEvent.change(keepSel, { target: { value: entityId("concept", "מושג 1") } });
    fireEvent.change(goneSel, { target: { value: entityId("concept", "מושג 2") } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Merge" })));
    expect(files().has("ישויות/מושגים/מושג 2.md")).toBe(false);
    const v3 = files();
    // Split רחל's membership into a new person.
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: rachel } });
    fireEvent.click(screen.getByRole("checkbox", { name: /רחל לוי חברה/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "רחל לוי (ועד)" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Split" })));
    expect(files().has("ישויות/אנשים/רחל לוי (ועד).md")).toBe(true);
    await axeClean(screen.getByTestId("entity-review"));
    // Undo four times, each one step: back to the exact bytes of every stage.
    for (const before of [v3, v2, v1, v0]) {
      await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Undo" })));
      expect(bytes(files())).toBe(bytes(before));
    }
  });
});

describe("W12.E6/E7 page and graph view in RTL", () => {
  const files = approve(vault(), proposalsOf(vault()).map((p) => p.id)).files;
  const entities = entitiesOf(files);
  const edges = edgesOf(files).map((e) => (e.predicate === "born_in" ? { ...e, when: "1950-01-01" } : e));
  const notes = new Map([[NOTE, { tags: ["יומן"], date: "2026-11-15" }]]);

  it("entity page: relations with links to existing paragraphs", async () => {
    const opened: string[] = [];
    render(<EntityPage entity={entities.find((e) => e.id === david)!} edges={edges} notes={files} names={new Map(entities.map((e) => [e.id, e.name]))} onOpenBlock={(n, a) => opened.push(`${n}#^${a}`)} />);
    fireEvent.click(screen.getByRole("button", { name: /a1/ }));
    expect(opened).toEqual([`${NOTE}#^a1`]);
    await axeClean(screen.getByTestId("entity-page"));
  });

  it("table: a relation filter and the time slider narrow the same relations the graph gets", async () => {
    render(<EntityGraphView entities={entities} edges={edges} notes={notes} initialMode="table" />);
    const rows = () => screen.getByTestId("entity-graph-edges").querySelectorAll("tbody tr").length;
    expect(rows()).toBe(2);
    // One relation only: uncheck every relation but member_of.
    fireEvent.click(screen.getByText("Relations", { selector: "summary" }));
    for (const box of within(screen.getByRole("group", { name: "Relations" })).getAllByRole("checkbox")) if (!box.parentElement!.textContent!.includes("member of")) fireEvent.click(box);
    expect(rows()).toBe(1);
    expect(screen.getByTestId("entity-graph-stats").textContent).toContain("1 relations");
    const expected = visibleGraph(entities, edges, notes, { predicates: new Set(["member_of"]) });
    expect(rows()).toBe(expected.edges.length);
    // The time slider back to the first day leaves nothing of member_of (2026).
    fireEvent.change(screen.getByTestId("entity-graph-time"), { target: { value: "0" } });
    expect(rows()).toBe(0);
    expect(screen.getByTestId("entity-graph-stats").textContent).toContain("0 relations");
    await axeClean(screen.getByTestId("entity-graph"));
  });

  it("keyboard: ←/→ step to neighbours in RTL, Enter centres the neighbourhood", () => {
    render(<EntityGraphView entities={entities} edges={edges} notes={notes} initialMode="table" />);
    const body = screen.getByTestId("entity-graph-nodes").querySelector("tbody")!;
    const rowsOf = () => [...body.querySelectorAll<HTMLTableRowElement>("tr[data-node]")];
    const start = rowsOf().findIndex((r) => r.dataset.node === david);
    rowsOf()[start].focus();
    fireEvent.focus(rowsOf()[start]);
    fireEvent.keyDown(body, { key: "ArrowLeft" });
    expect((document.activeElement as HTMLElement).dataset.node).toBe(haifa);
    fireEvent.keyDown(body, { key: "Enter" });
    expect(rowsOf().map((r) => r.dataset.node).sort()).toEqual([david, haifa].sort());
  });
});
