/**
 * W10.E16 (plan W2.22): the file tree of a 100,000-note vault is virtual.
 * Only the rows in view are in the DOM (fewer than 200), the keyboard moves
 * through all of them (right-to-left aware), and the active note is
 * scrolled to.
 */
import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import type { WorkspaceNode } from "../storage/workspace";
import type { RenderCtx } from "../ui/fileTreeRows";
import { DEFAULT_VIEWPORT, OVERSCAN, ROW_HEIGHT, flattenTree, scrollTopFor, treeMove, windowOf } from "../ui/virtualTreeRows";
import { VirtualFileTree, pinnedSegments } from "../ui/VirtualFileTree";

const file = (path: string): WorkspaceNode => ({ name: path.split("/").pop()!, path, kind: "file" }) as WorkspaceNode;
const folder = (path: string, children: WorkspaceNode[]): WorkspaceNode => ({ name: path.split("/").pop()!, path, kind: "directory", children }) as WorkspaceNode;

/** A synthetic vault: `folders` folders of `per` notes each. */
function vault(folders: number, per: number): WorkspaceNode[] {
  return Array.from({ length: folders }, (_, f) => folder(`d${f}`, Array.from({ length: per }, (_, n) => file(`d${f}/n${n}.md`))));
}

function ctxFor(over: Partial<RenderCtx> = {}): RenderCtx {
  return {
    activePath: null,
    collapsed: new Set(),
    editingPath: null,
    editValue: "",
    setEditValue: vi.fn(),
    setEditingPath: vi.fn(),
    inputRef: createRef<HTMLInputElement>(),
    toggle: vi.fn(),
    open: vi.fn(),
    commitRename: vi.fn(),
    remove: vi.fn(),
    newFile: vi.fn(),
    newFolder: vi.fn(),
    selectedPaths: new Set(),
    toggleSelect: vi.fn(),
    openContextMenu: vi.fn(),
    fileLimit: 200,
    shownAll: new Set(),
    showAll: vi.fn(),
    ...over,
  };
}

describe("flattening and the window", () => {
  it("lists the tree in order, without the children of collapsed folders", () => {
    const tree = [folder("a", [file("a/1.md"), folder("a/b", [file("a/b/2.md")])]), file("3.md")];
    expect(flattenTree(tree, new Set()).map((r) => `${r.depth}:${r.node.path}:${r.pos}/${r.size}`)).toEqual(["0:a:1/2", "1:a/1.md:1/2", "1:a/b:2/2", "2:a/b/2.md:1/1", "0:3.md:2/2"]);
    expect(flattenTree(tree, new Set(["a/b"])).map((r) => r.node.path)).toEqual(["a", "a/1.md", "a/b", "3.md"]);
    expect(flattenTree(tree, new Set(["a"])).map((r) => r.node.path)).toEqual(["a", "3.md"]);
  });

  it("renders the rows in view plus the overscan, never more", () => {
    const rows = Math.ceil(DEFAULT_VIEWPORT / ROW_HEIGHT);
    expect(windowOf(0, 0, 100_000)).toEqual({ start: 0, end: rows + OVERSCAN });
    expect(windowOf(50_000 * ROW_HEIGHT, 520, 100_000)).toEqual({ start: 50_000 - OVERSCAN, end: 50_000 + 20 + OVERSCAN });
    expect(windowOf(10 ** 9, 520, 30)).toEqual({ start: 30 - OVERSCAN, end: 30 });
    expect(scrollTopFor(0, 520, 100_000)).toBe(0);
    expect(scrollTopFor(5000, 520, 100_000)).toBe(5000 * ROW_HEIGHT - (520 - ROW_HEIGHT) / 2);
    expect(scrollTopFor(99_999, 520, 100_000)).toBe(100_000 * ROW_HEIGHT - 520);
  });

  it("the arrow into the text opens a folder: → left to right, ← right to left", () => {
    expect(treeMove("ArrowRight", "ltr")).toBe("expand");
    expect(treeMove("ArrowLeft", "ltr")).toBe("collapse");
    expect(treeMove("ArrowLeft", "rtl")).toBe("expand");
    expect(treeMove("ArrowRight", "rtl")).toBe("collapse");
    expect([treeMove("ArrowDown", "rtl"), treeMove("Home", "ltr"), treeMove("Enter", "ltr"), treeMove("a", "ltr")]).toEqual(["next", "first", "open", null]);
  });
});

describe("VirtualFileTree with 100,000 notes", () => {
  const nodes = vault(100, 1000);

  it("keeps fewer than 200 rows in the DOM; each row says where it is (no aria-rowcount: not allowed on a tree)", () => {
    const { container } = render(<VirtualFileTree nodes={nodes} ctx={ctxFor()} />);
    const items = container.querySelectorAll('[role="treeitem"]');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(200);
    expect(container.querySelector('[role="tree"]')!.hasAttribute("aria-rowcount")).toBe(false);
    const first = container.querySelector('[role="treeitem"]')!;
    expect(first.getAttribute("aria-level")).toBe("1");
    expect(first.getAttribute("aria-setsize")).toBe("100");
    expect(first.getAttribute("aria-posinset")).toBe("1");
    // The spacer below stands in for the rest, at the same row height.
    const spacers = container.querySelectorAll('li[role="none"]');
    expect((spacers[1] as HTMLElement).style.height).toBe(`${(100_100 - items.length) * ROW_HEIGHT}px`);
  });

  it("scrolls to the active note deep in the vault and renders it", () => {
    const { container } = render(<VirtualFileTree nodes={nodes} ctx={ctxFor({ activePath: "d77/n500.md" })} />);
    const active = container.querySelector('[data-path="d77/n500.md"]');
    expect(active).not.toBeNull();
    expect(active!.closest("li")!.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelectorAll('[role="treeitem"]').length).toBeLessThan(200);
  });

  it("moves with the keyboard and opens a folder with ← in a right-to-left tree", () => {
    const ctx = ctxFor({ collapsed: new Set(["d0"]) });
    const { container } = render(
      <div dir="rtl" style={{ direction: "rtl" }}>
        <VirtualFileTree nodes={nodes} ctx={ctx} />
      </div>,
    );
    const tree = container.querySelector('[role="tree"]') as HTMLElement;
    tree.style.direction = "rtl";
    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(ctx.toggle).toHaveBeenCalledWith("d0");
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(container.querySelector('li[data-focused] [data-path]')!.getAttribute("data-path")).toBe("d1");
    fireEvent.keyDown(tree, { key: "End" });
    expect(container.querySelector('li[data-focused] [data-path]')!.getAttribute("data-path")).toBe("d99/n999.md");
    expect(container.querySelectorAll('[role="treeitem"]').length).toBeLessThan(200);
  });
});

describe("focus in a 100,000-note tree (wave g5)", () => {
  const nodes = vault(100, 1000);
  const total = 100 * 1001;
  const heightOf = (segs: ReturnType<typeof pinnedSegments>) => segs.reduce((n, s) => n + (s.kind === "space" ? s.rows : s.kind === "row" ? 1 : s.to - s.from), 0);

  it("the focused row outside the window is kept in its place between two spacers; the height is exact", () => {
    expect(pinnedSegments(500, 560, 520, total)).toEqual([{ kind: "space", rows: 500 }, { kind: "rows", from: 500, to: 560 }, { kind: "space", rows: total - 560 }]);
    expect(pinnedSegments(500, 560, 3, total)).toEqual([{ kind: "space", rows: 3 }, { kind: "row", index: 3 }, { kind: "space", rows: 496 }, { kind: "rows", from: 500, to: 560 }, { kind: "space", rows: total - 560 }]);
    expect(pinnedSegments(500, 560, 90_000, total)).toEqual([{ kind: "space", rows: 500 }, { kind: "rows", from: 500, to: 560 }, { kind: "space", rows: 90_000 - 560 }, { kind: "row", index: 90_000 }, { kind: "space", rows: total - 90_001 }]);
    for (const f of [-1, 0, 499, 500, 559, 560, total - 1]) expect(heightOf(pinnedSegments(500, 560, f, total)), String(f)).toBe(total);
  });

  it("scrolling the focused row away keeps it, and focus, in the DOM (never <body>)", () => {
    const { container } = render(<VirtualFileTree nodes={nodes} ctx={ctxFor()} />);
    const tree = container.querySelector('[role="tree"]') as HTMLElement;
    const name = container.querySelector('[data-path="d0/n3.md"] .file-tree-name') as HTMLElement;
    act(() => name.focus());
    expect(document.activeElement).toBe(name);
    act(() => {
      tree.scrollTop = 50_000 * ROW_HEIGHT;
      fireEvent.scroll(tree);
    });
    expect(container.querySelector('[data-path="d49/n950.md"]')).not.toBeNull(); // the window moved
    expect(container.querySelector('[data-path="d0/n3.md"]')).not.toBeNull(); // the focused row stayed
    expect(document.activeElement).toBe(name);
    expect(container.querySelectorAll('[role="treeitem"]').length).toBeLessThan(200);
  });

  it("a row focused by click or Tab is the one the arrow keys move from", () => {
    const { container } = render(<VirtualFileTree nodes={nodes} ctx={ctxFor()} />);
    const tree = container.querySelector('[role="tree"]') as HTMLElement;
    act(() => (container.querySelector('[data-path="d0/n7.md"] .file-tree-name') as HTMLElement).focus());
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(container.querySelector("li[data-focused] [data-path]")!.getAttribute("data-path")).toBe("d0/n8.md");
  });

  it("a note opened elsewhere does not pull focus out of the tree", () => {
    const { container, rerender } = render(<VirtualFileTree nodes={nodes} ctx={ctxFor()} />);
    const name = container.querySelector('[data-path="d0/n2.md"] .file-tree-name') as HTMLElement;
    act(() => name.focus());
    rerender(<VirtualFileTree nodes={nodes} ctx={ctxFor({ activePath: "d80/n10.md" })} />);
    expect(container.querySelector('[data-path="d80/n10.md"]')).not.toBeNull(); // scrolled to
    expect(document.activeElement).toBe(name);
  });
});
