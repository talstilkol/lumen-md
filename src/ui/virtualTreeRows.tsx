/**
 * The virtual tree's rows (W10.E16, plan W2.22): flattening, the scroll
 * window, keyboard moves and one flat treeitem. Only VirtualFileTree (a
 * large vault, loaded on use) needs these, so they live off the startup path.
 */
import type { WorkspaceNode } from "../storage/workspace";
import { rowOf, type RenderCtx } from "./fileTreeRows";

/** Every row has this height in the virtual tree (CSS: .file-tree-virtual .file-tree-item). */
export const ROW_HEIGHT = 26;
/** Rows rendered above and below the visible ones, so a fast scroll does not show a gap. */
export const OVERSCAN = 12;
/** The viewport assumed before the list has been measured (and where nothing is laid out). */
export const DEFAULT_VIEWPORT = 640;

export interface FlatRow {
  node: WorkspaceNode;
  depth: number;
  /** For aria-setsize / aria-posinset: the row's place among its siblings. */
  pos: number;
  size: number;
}

/** The rows a reader can scroll to: the tree in order, without the children of collapsed folders. */
export function flattenTree(nodes: readonly WorkspaceNode[], collapsed: ReadonlySet<string>): FlatRow[] {
  const out: FlatRow[] = [];
  const stack: Array<{ list: readonly WorkspaceNode[]; i: number; depth: number }> = [{ list: nodes, i: 0, depth: 0 }];
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top.i >= top.list.length) {
      stack.pop();
      continue;
    }
    const node = top.list[top.i++];
    out.push({ node, depth: top.depth, pos: top.i, size: top.list.length });
    if (node.kind === "directory" && node.children?.length && !collapsed.has(node.path)) stack.push({ list: node.children, i: 0, depth: top.depth + 1 });
  }
  return out;
}

/** The rows to render for a scroll position: [start, end) of `total`, with OVERSCAN on each side. */
export function windowOf(scrollTop: number, viewport: number, total: number, rowHeight = ROW_HEIGHT, overscan = OVERSCAN): { start: number; end: number } {
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const count = Math.ceil((viewport > 0 ? viewport : DEFAULT_VIEWPORT) / rowHeight);
  const start = Math.max(0, Math.min(first, total) - overscan);
  return { start, end: Math.min(total, first + count + overscan) };
}

/** The scrollTop that puts row `index` in the middle of the viewport. */
export function scrollTopFor(index: number, viewport: number, total: number, rowHeight = ROW_HEIGHT): number {
  const v = viewport > 0 ? viewport : DEFAULT_VIEWPORT;
  return Math.max(0, Math.min(index * rowHeight - (v - rowHeight) / 2, total * rowHeight - v));
}

export type TreeMove = "next" | "prev" | "first" | "last" | "expand" | "collapse" | "open";

/**
 * A key in the tree → a move (the WAI-ARIA tree pattern). The arrow that
 * points into the text opens a folder: Right in a left-to-right tree, Left
 * in a right-to-left one.
 */
export function treeMove(key: string, dir: "ltr" | "rtl"): TreeMove | null {
  if (key === "ArrowDown") return "next";
  if (key === "ArrowUp") return "prev";
  if (key === "Home") return "first";
  if (key === "End") return "last";
  if (key === "Enter") return "open";
  if (key === "ArrowRight") return dir === "rtl" ? "collapse" : "expand";
  if (key === "ArrowLeft") return dir === "rtl" ? "expand" : "collapse";
  return null;
}

/** One row of the virtual tree, a flat treeitem with its level (the tree's structure is in aria-level). */
export function renderFlatRow(row: FlatRow, ctx: RenderCtx, focused: boolean): React.ReactNode {
  const { node, depth } = row;
  const isFolder = node.kind === "directory";
  return (
    <li
      key={node.path}
      role="treeitem"
      aria-level={depth + 1}
      aria-setsize={row.size}
      aria-posinset={row.pos}
      aria-expanded={isFolder ? !ctx.collapsed.has(node.path) : undefined}
      aria-selected={node.path === ctx.activePath}
      data-focused={focused ? "" : undefined}
    >
      {rowOf(node, depth, ctx)}
    </li>
  );
}

