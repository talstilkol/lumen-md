/**
 * The file tree of a large vault, virtualised (W10.E16, plan W2.22): only
 * the rows in view (plus OVERSCAN each side) are in the DOM, every row has
 * the same height, and two spacers stand in for the rest, so a vault of
 * 100,000 notes keeps a few dozen rows rendered. The keyboard follows the
 * WAI-ARIA tree pattern (↑ ↓ Home End, the arrow into the text opens a
 * folder: → in a left-to-right tree, ← in a right-to-left one, Enter
 * opens), and the active note is scrolled into view when it changes.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceNode } from "../storage/workspace";
import type { RenderCtx } from "./fileTreeRows";
import { ROW_HEIGHT, flattenTree, renderFlatRow, scrollTopFor, treeMove, windowOf } from "./virtualTreeRows";

export function VirtualFileTree({ nodes, ctx }: { nodes: WorkspaceNode[]; ctx: RenderCtx }) {
  const rows = useMemo(() => flattenTree(nodes, ctx.collapsed), [nodes, ctx.collapsed]);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const [focus, setFocus] = useState(0);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight);
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The active note, in view whenever it changes (opened from search, a link, a tab).
  const activeIndex = useMemo(() => rows.findIndex((r) => r.node.path === ctx.activePath), [rows, ctx.activePath]);
  useEffect(() => {
    const el = listRef.current;
    if (!el || activeIndex < 0) return;
    setFocus(activeIndex);
    const top = activeIndex * ROW_HEIGHT;
    if (top >= el.scrollTop && top + ROW_HEIGHT <= el.scrollTop + (el.clientHeight || viewport)) return;
    const next = scrollTopFor(activeIndex, el.clientHeight || viewport, rows.length);
    el.scrollTop = next;
    setScrollTop(next);
    // Only a change of the active note moves the view, not a new listing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.activePath, activeIndex >= 0]);

  const { start, end } = windowOf(scrollTop, viewport, rows.length);

  function move(to: number) {
    const i = Math.max(0, Math.min(rows.length - 1, to));
    setFocus(i);
    const el = listRef.current;
    if (!el) return;
    const v = el.clientHeight || viewport;
    if (i * ROW_HEIGHT < el.scrollTop) el.scrollTop = i * ROW_HEIGHT;
    else if ((i + 1) * ROW_HEIGHT > el.scrollTop + v) el.scrollTop = (i + 1) * ROW_HEIGHT - v;
    setScrollTop(el.scrollTop);
    // The row is in the DOM now or after this render: focus its name button.
    queueMicrotask(() => el.querySelector<HTMLElement>(`[data-path="${CSS.escape(rows[i].node.path)}"] .file-tree-name`)?.focus());
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    if ((e.target as HTMLElement).tagName === "INPUT") return; // renaming
    const dir = getComputedStyle(e.currentTarget).direction === "rtl" ? "rtl" : "ltr";
    const m = treeMove(e.key, dir);
    const row = rows[focus];
    if (!m || !row) return;
    e.preventDefault();
    const isFolder = row.node.kind === "directory";
    const open = isFolder && !ctx.collapsed.has(row.node.path);
    if (m === "next") move(focus + 1);
    else if (m === "prev") move(focus - 1);
    else if (m === "first") move(0);
    else if (m === "last") move(rows.length - 1);
    else if (m === "open") isFolder ? ctx.toggle(row.node.path) : ctx.open(row.node);
    else if (m === "expand") {
      if (isFolder && !open) ctx.toggle(row.node.path);
      else if (open) move(focus + 1);
    } else if (m === "collapse") {
      if (open) ctx.toggle(row.node.path);
      else {
        // To the parent folder.
        for (let i = focus - 1; i >= 0; i--) if (rows[i].depth < row.depth) return move(i);
      }
    }
  }

  return (
    <ul
      ref={listRef}
      className="file-tree-list file-tree-virtual"
      role="tree"
      aria-rowcount={rows.length}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
    >
      <li role="none" aria-hidden="true" style={{ height: start * ROW_HEIGHT }} />
      {rows.slice(start, end).map((r, i) => renderFlatRow(r, ctx, start + i === focus))}
      <li role="none" aria-hidden="true" style={{ height: (rows.length - end) * ROW_HEIGHT }} />
    </ul>
  );
}
