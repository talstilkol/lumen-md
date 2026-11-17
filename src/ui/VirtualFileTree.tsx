/**
 * The file tree of a large vault, virtualised (W10.E16, plan W2.22): only
 * the rows in view (plus OVERSCAN each side) are in the DOM, every row has
 * the same height, and two spacers stand in for the rest, so a vault of
 * 100,000 notes keeps a few dozen rows rendered. The keyboard follows the
 * WAI-ARIA tree pattern (↑ ↓ Home End, the arrow into the text opens a
 * folder: → in a left-to-right tree, ← in a right-to-left one, Enter
 * opens), and the active note is scrolled into view when it changes.
 * The focused row is kept in the DOM when the wheel scrolls it away (focus
 * never drops to <body>), and a click or Tab into a row makes it the row
 * the arrow keys move from. No aria-rowcount (not allowed on a tree): each
 * row carries aria-level, aria-setsize and aria-posinset.
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
  /** Whether focus is in the tree: only then is the focused row kept when it scrolls away. */
  const [inside, setInside] = useState(false);
  const insideRef = useRef(false);
  insideRef.current = inside;

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
    // Focus in the tree stays on its row (a note opened elsewhere must not pull it to <body>).
    if (!insideRef.current) setFocus(activeIndex);
    const top = activeIndex * ROW_HEIGHT;
    if (top >= el.scrollTop && top + ROW_HEIGHT <= el.scrollTop + (el.clientHeight || viewport)) return;
    const next = scrollTopFor(activeIndex, el.clientHeight || viewport, rows.length);
    el.scrollTop = next;
    setScrollTop(next);
    // Only a change of the active note moves the view, not a new listing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.activePath, activeIndex >= 0]);

  const { start, end } = windowOf(scrollTop, viewport, rows.length);
  // Where each path is in the list: a click or a Tab into a row makes it the keyboard's row.
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.node.path, i])), [rows]);

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

  // The focused row stays in the DOM when the wheel takes it out of view, so focus never drops to <body>
  // and the arrow keys go on from it (pinnedSegments: the spacers either side of it keep the height exact).
  const segments = pinnedSegments(start, end, inside ? focus : -1, rows.length);
  const spacer = (key: string, n: number) => <li key={key} role="none" aria-hidden="true" style={{ height: n * ROW_HEIGHT }} />;

  return (
    <ul
      ref={listRef}
      className="file-tree-list file-tree-virtual"
      role="tree"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setInside(false);
      }}
      onFocus={(e) => {
        setInside(true);
        const path = (e.target as HTMLElement).closest<HTMLElement>("[data-path]")?.dataset.path;
        const i = path === undefined ? undefined : indexOf.get(path);
        if (i !== undefined && i !== focus) setFocus(i);
      }}
    >
      {/* One flat, keyed list: the focused row keeps its DOM node (and focus) when it changes segment. */}
      {segments.flatMap((seg, k) =>
        seg.kind === "space"
          ? [spacer(k === 0 ? "sp-top" : k === segments.length - 1 ? "sp-bottom" : `sp-${k}`, seg.rows)]
          : seg.kind === "row"
            ? [renderFlatRow(rows[seg.index], ctx, seg.index === focus)]
            : rows.slice(seg.from, seg.to).map((r, i) => renderFlatRow(r, ctx, seg.from + i === focus)),
      )}
    </ul>
  );
}

export type Segment = { kind: "space"; rows: number } | { kind: "row"; index: number } | { kind: "rows"; from: number; to: number };

/**
 * The list as rendered: a spacer, the rows in the window, a spacer — and, when
 * the focused row is outside the window, that one row in its place between
 * two spacers. The heights always add up to `total` rows.
 */
export function pinnedSegments(start: number, end: number, focus: number, total: number): Segment[] {
  const inWindow = focus >= start && focus < end;
  if (inWindow || focus < 0 || focus >= total) return [{ kind: "space", rows: start }, { kind: "rows", from: start, to: end }, { kind: "space", rows: total - end }];
  if (focus < start) return [{ kind: "space", rows: focus }, { kind: "row", index: focus }, { kind: "space", rows: start - focus - 1 }, { kind: "rows", from: start, to: end }, { kind: "space", rows: total - end }];
  return [{ kind: "space", rows: start }, { kind: "rows", from: start, to: end }, { kind: "space", rows: focus - end }, { kind: "row", index: focus }, { kind: "space", rows: total - focus - 1 }];
}
