/**
 * Plan W12.V3: tree and sunburst of folders, nested tags and a note's
 * headings — the tree grows right to left in RTL, and the alternative is an
 * ARIA tree with arrow-key navigation (APG treeview, mirrored in RTL).
 * The vault and note are SYNTHETIC, written here.
 */
import { describe, expect, it } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import axe from "axe-core";
import { depthOf, flatten, folderTree, headingTree, optionTreeValues, tagTree, treeOption } from "../viz/treeModel";
import { AriaTree, treeKey, visibleItems } from "../viz/AriaTree";
import TreeFigure from "../viz/TreeFigure";
import { parseStructure, subtree } from "../viz/StructureBlock";
import { isolate } from "../viz/bidi";

const paths = ["בית.md", "פרויקטים/לומן/ui.md", "פרויקטים/לומן/rtl.md", "פרויקטים/אחר.md", "ארכיון/2025/a.md", "images/x.png"];

describe("trees (W12.V3)", () => {
  it("folders: counts notes under each folder, attachments left out", () => {
    const t = folderTree(paths, "כספת");
    expect(t.value).toBe(5);
    expect(t.children.map((c) => [c.name, c.value])).toEqual([
      ["ארכיון", 1],
      ["פרויקטים", 3],
    ]);
    expect(t.children[1].children.map((c) => [c.id, c.value])).toEqual([["פרויקטים/לומן", 2]]);
    const withNotes = folderTree(paths, "כספת", { withNotes: true });
    expect(withNotes.children.find((c) => c.name === "בית")?.path).toBe("בית.md");
  });

  it("nested tags: a note counts once per level, case-insensitively", () => {
    const t = tagTree(
      [
        { path: "a.md", tags: ["proj/lumen/ui", "proj/lumen"] },
        { path: "b.md", tags: ["Proj/lumen/rtl"] },
        { path: "c.md", tags: ["עברית"] },
        { path: "d.md", tags: [] },
      ],
      "תגיות",
    );
    expect(t.value).toBe(3);
    const proj = t.children.find((c) => c.name === "proj")!;
    expect(proj.value).toBe(2);
    expect(proj.children[0].value).toBe(2);
    expect(proj.children[0].children.map((c) => [c.name, c.value])).toEqual([
      ["rtl", 1],
      ["ui", 1],
    ]);
  });

  it("headings: nested by level, fenced code and frontmatter ignored, skipped levels nest under the nearest", () => {
    const text = ["---", "title: x", "# not a heading", "---", "# מבוא", "## רקע", "```", "# code", "```", "#### עמוק", "## שיטה", "# סיכום"].join("\n");
    const t = headingTree(text, "הפתק");
    expect(t.children.map((c) => c.name)).toEqual(["מבוא", "סיכום"]);
    expect(t.children[0].children.map((c) => c.name)).toEqual(["רקע", "שיטה"]);
    expect(t.children[0].children[0].children.map((c) => [c.name, c.line])).toEqual([["עמוק", 9]]);
    expect(t.value).toBe(5);
    expect(depthOf(t)).toBe(3);
  });

  it("RTL: the tree grows from the right; the sunburst runs counter-clockwise; labels isolated", () => {
    const t = folderTree(paths, "כספת");
    const rtl = treeOption(t, "tree", "rtl", "d") as any;
    const ltr = treeOption(t, "tree", "ltr", "d") as any;
    expect(rtl.series[0].orient).toBe("RL");
    expect(ltr.series[0].orient).toBe("LR");
    expect((treeOption(t, "sunburst", "rtl", "d") as any).series[0].clockwise).toBe(false);
    expect((treeOption(t, "sunburst", "ltr", "d") as any).series[0].clockwise).toBe(true);
    // The picture holds the same nodes and values as the ARIA tree, depth first.
    expect(optionTreeValues(rtl)).toEqual(flatten(t).map((f) => [isolate(f.node.name), f.node.value]));
  });

  it("the open / close arrows are mirrored in RTL", () => {
    expect(treeKey("ArrowLeft", "rtl")).toBe("open");
    expect(treeKey("ArrowRight", "rtl")).toBe("close");
    expect(treeKey("ArrowRight", "ltr")).toBe("open");
    expect(treeKey("ArrowDown", "rtl")).toBe("next");
  });

  it("the ```structure block options", () => {
    expect(parseStructure("source: tags\nview: sunburst\nroot: #proj")).toEqual({ source: "tags", view: "sunburst", root: "proj", problems: [] });
    expect(parseStructure("source: nope").problems).toEqual(["source: nope"]);
    const t = folderTree(paths, "כספת");
    expect(subtree(t, "פרויקטים/לומן").value).toBe(2);
  });
});

describe("the ARIA tree", () => {
  const root = folderTree(paths, "כספת", { withNotes: true });
  for (const dir of ["rtl", "ltr"] as const)
    it(`${dir}: arrows walk, open and close; Enter activates; axe clean`, async () => {
      const opened: string[] = [];
      const { container } = render(
        <div dir={dir} lang={dir === "rtl" ? "he" : "en"}>
          <AriaTree root={root} dir={dir} label="תיקיות" onActivate={(n) => opened.push(n.id)} />
        </div>,
      );
      const tree = container.querySelector('[role="tree"]')!;
      const focused = () => document.activeElement?.getAttribute("data-tree-id");
      const items = () => [...container.querySelectorAll('[role="treeitem"]')];
      // One tab stop.
      expect(items().filter((el) => (el as HTMLElement).tabIndex === 0).length).toBe(1);
      expect(items().length).toBe(visibleItems(root, new Set([root.id])).length);
      const openKey = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
      const closeKey = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
      const press = (key: string) =>
        act(() => {
          fireEvent.keyDown(document.activeElement ?? tree, { key });
        });
      (items()[0] as HTMLElement).focus();
      press("ArrowDown");
      expect(focused()).toBe("ארכיון");
      press(openKey); // opens ארכיון
      expect(items().find((el) => el.getAttribute("data-tree-id") === "ארכיון")!.getAttribute("aria-expanded")).toBe("true");
      press(openKey); // to its first child
      expect(focused()).toBe("ארכיון/2025");
      press(closeKey); // closed child → parent
      expect(focused()).toBe("ארכיון");
      press("End");
      const last = focused();
      press("Enter");
      expect(opened).toEqual([last]);
      expect((await axe.run(container, { resultTypes: ["violations"] })).violations.map((v) => v.id)).toEqual([]);
    });
});

describe("the tree figure", () => {
  for (const kind of ["tree", "sunburst"] as const)
    for (const dir of ["rtl", "ltr"] as const)
      it(`${kind} ${dir}: an ARIA tree alternative, keyboard on the picture, axe clean`, async () => {
        const root = headingTree("# א\n## ב\n## ג\n# ד", "הפתק");
        const { container, getByRole } = render(
          <div dir={dir} lang="he">
            <TreeFigure root={root} kind={kind} title="כותרות" dir={dir} />
          </div>,
        );
        const plot = container.querySelector("[data-viz-plot]") as HTMLElement;
        plot.focus();
        const status = container.querySelector("[data-viz-status]")!;
        act(() => {
          fireEvent.keyDown(plot, { key: "End" });
        });
        expect(status.textContent).toContain("ד");
        expect(container.querySelector('[role="tree"]')).not.toBeNull();
        expect((await axe.run(container, { resultTypes: ["violations"] })).violations.map((v) => v.id)).toEqual([]);
        act(() => {
          fireEvent.click(getByRole("button", { expanded: false }));
        });
        expect((await axe.run(container, { resultTypes: ["violations"] })).violations.map((v) => v.id)).toEqual([]);
      });
});
