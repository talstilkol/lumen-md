/**
 * Plan W12.T3: keyboard navigation in a type's table, in RTL, as in
 * Obsidian 1.14's Bases table — the focused cell moves with the arrows as
 * the text runs (ArrowLeft goes to the next column in Hebrew).
 * The vault is SYNTHETIC (three notes made here).
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { TableView } from "../views/bases/BasesBlock";
import { basesFileFromText, runBase } from "../views/bases/base";
import { loadTypeRegistry } from "../types/typeRegistry";
import { typeBaseModel } from "../types/typeBase";

const reg = loadTypeRegistry([{ path: ".lumen/types/book.yaml", text: "label: { he: ספר }\nfields:\n  author: { type: text, pinned: true }\n  pages: { type: number, pinned: true }\n" }]);
const files = ["א", "ב", "ג"].map((n, i) => basesFileFromText(`${n}.md`, `---\ntype: book\nauthor: מחבר ${i}\npages: ${i + 1}\n---\n`));

function setup(dir: "rtl" | "ltr") {
  document.documentElement.dir = dir;
  const result = runBase(typeBaseModel(reg, "book"), files);
  const view = render(
    <div dir={dir}>
      <TableView result={result} files={files} sort={[]} onSort={() => undefined} />
    </div>,
  );
  const cell = (r: number, c: number) => view.container.querySelector(`[data-cell="${r}:${c}"]`) as HTMLElement;
  return { view, cell };
}

describe("type table keyboard navigation (W12.T3)", () => {
  it("one cell is in the tab order: the first", () => {
    const { view } = setup("rtl");
    expect([...view.container.querySelectorAll("td[tabindex='0']")].map((x) => x.getAttribute("data-cell"))).toEqual(["0:0"]);
    expect(view.container.querySelector("table")!.getAttribute("role")).toBe("grid");
  });
  it("in RTL, ArrowLeft moves to the next column and ArrowDown to the next row", async () => {
    const { cell } = setup("rtl");
    cell(0, 0).focus();
    fireEvent.keyDown(cell(0, 0), { key: "ArrowLeft" });
    await waitFor(() => expect(document.activeElement).toBe(cell(0, 1)));
    fireEvent.keyDown(cell(0, 1), { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(cell(1, 1)));
    fireEvent.keyDown(cell(1, 1), { key: "End", ctrlKey: true });
    await waitFor(() => expect(document.activeElement).toBe(cell(2, 2)));
  });
  it("in LTR, ArrowRight moves to the next column", async () => {
    const { cell } = setup("ltr");
    cell(0, 0).focus();
    fireEvent.keyDown(cell(0, 0), { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(cell(0, 1)));
  });
});
