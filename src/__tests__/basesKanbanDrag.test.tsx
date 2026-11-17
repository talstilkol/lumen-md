/**
 * Plan W12.T5 (e2e in RTL, offline part): dragging a kanban card between
 * columns with the mouse (HTML drag and drop) and with the keyboard
 * (Alt+arrows, as the text runs), and a read-only grouping that offers no
 * drag. The drop runs the real plan and text edit (planKanbanMove +
 * applyKanbanSet) over an in-memory copy of the notes; the storage write
 * (editNote / safeMove) is the app's existing path and is not replaced by
 * anything that asserts itself. The notes are SYNTHETIC.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { KanbanView } from "../views/bases/BasesBlock";
import { basesFileFromText, parseBase, runBase, type BaseRow } from "../views/bases/base";
import { applyKanbanSet, planKanbanMove, type KanbanColumn } from "../views/bases/kanban";

const BASE = "views:\n  - type: kanban\n    name: לוח\n    groupBy: { property: note.status, direction: ASC }\n    groupOrder: [null, todo, doing, done]\n    order: [file.name]\n";
const FORMULA = "formulas:\n  s: 'if(status, status, \"x\")'\nviews:\n  - type: kanban\n    name: K\n    groupBy: { property: formula.s, direction: ASC }\n    order: [file.name]\n";

function setup(baseText: string, dir: "rtl" | "ltr" = "rtl") {
  document.documentElement.dir = dir;
  const disk = new Map([
    ["a.md", "---\nstatus: todo\n---\n# a\n"],
    ["b.md", "---\nstatus: doing\n---\n# b\n"],
    ["c.md", "# c\n"],
  ]);
  const files = [...disk].map(([p, t]) => basesFileFromText(p, t));
  const p = parseBase(baseText);
  if (!p.ok) throw new Error(p.error);
  const result = runBase(p.base, files);
  const onDrop = (row: BaseRow, property: string, column: KanbanColumn) => {
    const m = planKanbanMove(row, property, column);
    if (m.kind === "set") disk.set(m.path, applyKanbanSet(disk.get(m.path)!, m));
  };
  const view = render(
    <div dir={dir}>
      <KanbanView result={result} files={files} onDrop={onDrop} />
    </div>,
  );
  const card = (path: string) => view.container.querySelector(`[data-path="${path}"]`) as HTMLElement;
  const column = (key: string) => view.container.querySelector(`[data-column="${key}"]`) as HTMLElement;
  return { view, disk, card, column };
}

const dataTransfer = () => {
  const data = new Map<string, string>();
  return { setData: (k: string, v: string) => void data.set(k, v), getData: (k: string) => data.get(k) ?? "", effectAllowed: "", dropEffect: "" };
};

describe("kanban drag in RTL (W12.T5)", () => {
  it("shows the None column first and an empty 'done' column, as groupOrder lists them", () => {
    const { view } = setup(BASE);
    expect([...view.container.querySelectorAll("section")].map((s) => s.getAttribute("data-column"))).toEqual(["", "todo", "doing", "done"]);
    expect(view.container.querySelector('[data-column=""] [data-path="c.md"]')).not.toBeNull();
  });
  it("mouse: dragging a card onto another column writes the status of that note", () => {
    const { disk, card, column } = setup(BASE);
    const dt = dataTransfer();
    fireEvent.dragStart(card("a.md"), { dataTransfer: dt });
    fireEvent.dragOver(column("done"), { dataTransfer: dt });
    fireEvent.drop(column("done"), { dataTransfer: dt });
    expect(disk.get("a.md")).toBe("---\nstatus: done\n---\n# a\n");
    expect(disk.get("b.md")).toBe("---\nstatus: doing\n---\n# b\n");
  });
  it("mouse: dropping on None empties the property", () => {
    const { disk, card, column } = setup(BASE);
    const dt = dataTransfer();
    fireEvent.dragStart(card("b.md"), { dataTransfer: dt });
    fireEvent.drop(column(""), { dataTransfer: dt });
    expect(disk.get("b.md")).toMatch(/^---\nstatus:\s*\n---\n# b\n$/);
  });
  it("keyboard in RTL: Alt+ArrowLeft moves the card to the next column (todo → doing)", () => {
    const { disk, card } = setup(BASE, "rtl");
    fireEvent.keyDown(card("a.md"), { key: "ArrowLeft", altKey: true });
    expect(disk.get("a.md")).toBe("---\nstatus: doing\n---\n# a\n");
  });
  it("keyboard in LTR: Alt+ArrowRight moves it to the next column", () => {
    const { disk, card } = setup(BASE, "ltr");
    fireEvent.keyDown(card("a.md"), { key: "ArrowRight", altKey: true });
    expect(disk.get("a.md")).toBe("---\nstatus: doing\n---\n# a\n");
  });
  it("grouped by a formula: no card is draggable, and a note says why", () => {
    const { view, disk, card } = setup(FORMULA);
    expect(card("a.md").getAttribute("draggable")).toBe("false");
    expect(view.container.querySelector('[role="note"]')).not.toBeNull();
    fireEvent.keyDown(card("a.md"), { key: "ArrowLeft", altKey: true });
    expect(disk.get("a.md")).toBe("---\nstatus: todo\n---\n# a\n");
  });
});

import { FiltersPanel } from "../views/bases/BasesBlock";
import { moveFilter, type FilterScope } from "../views/bases/base";
import { filterRows } from "../views/bases/filterRows";

describe("filter rows: drag and Alt+arrows reorder, and the .base keeps the new order (W12.T5, Obsidian 1.15)", () => {
  const TEXT = 'filters:\n  and:\n    - file.ext == "md"\n    - file.hasTag("book")\n    - \'status != "done"\'\nviews:\n  - type: table\n    name: T\n    filters:\n      and:\n        - rating > 3\n';
  function setup() {
    let text = TEXT;
    const parse = () => {
      const p = parseBase(text);
      if (!p.ok) throw new Error(p.error);
      return p.base;
    };
    const onMove = (from: FilterScope & { index: number }, to: FilterScope & { index: number }) => {
      const w = moveFilter(text, from, to);
      if (w.ok) text = w.text;
    };
    const view = render(<FiltersPanel base={parse()} view={0} onMove={onMove} />);
    const rows = () => [...view.container.querySelectorAll("[data-scope] li")] as HTMLElement[];
    return { view, rows, now: () => filterRows(parse(), 0) };
  }
  it("Alt+ArrowDown on the first All-views filter moves it one down in the file", () => {
    const { rows, now } = setup();
    fireEvent.keyDown(rows()[0], { key: "ArrowDown", altKey: true });
    expect(now().all.map((r) => r.text)).toEqual(['file.hasTag("book")', 'file.ext == "md"', 'status != "done"']);
  });
  it("mouse: dropping the third filter on the first puts it first", () => {
    const { rows, now } = setup();
    const dt = dataTransfer();
    fireEvent.dragStart(rows()[2], { dataTransfer: dt });
    fireEvent.drop(rows()[0], { dataTransfer: dt });
    expect(now().all.map((r) => r.text)).toEqual(['status != "done"', 'file.ext == "md"', 'file.hasTag("book")']);
  });
  it("the row button moves a filter from All views to This view", () => {
    const { rows, now } = setup();
    fireEvent.click(rows()[0].querySelector("button")!);
    expect(now().view.map((r) => r.text)).toEqual(["rating > 3", 'file.ext == "md"']);
    expect(now().all).toHaveLength(2);
  });
});
