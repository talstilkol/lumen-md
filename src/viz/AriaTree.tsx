/**
 * An ARIA tree (WAI-ARIA APG treeview pattern) — the accessible alternative
 * of the tree and sunburst views (plan W12.V3), and a usable outline on
 * its own.
 *
 * One tab stop (roving tabindex). ↓ / ↑ move through the visible items;
 * the "open" arrow (→ in LTR, ← in RTL, as the APG asks for right-to-left
 * trees) opens a closed item or moves to its first child, the other arrow
 * closes an open item or moves to its parent; Home / End go to the first and
 * last visible item; Enter activates.
 *
 * No strings of its own: the host passes the label and a value formatter.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Dir } from "./bidi";
import type { VizTreeNode } from "./treeModel";

interface Props {
  root: VizTreeNode;
  label: string;
  dir: Dir;
  /** "(12)" after the name; default the plain number. */
  valueText?: (n: VizTreeNode) => string;
  onActivate?: (n: VizTreeNode) => void;
  /** Open to this depth at first (the root is 0). */
  openDepth?: number;
  id?: string;
  hidden?: boolean;
}

interface Item {
  node: VizTreeNode;
  depth: number;
  parent: string | null;
}

/** The items a reader can reach now: the children of open items only. */
export function visibleItems(root: VizTreeNode, open: ReadonlySet<string>): Item[] {
  const out: Item[] = [];
  const walk = (n: VizTreeNode, depth: number, parent: string | null) => {
    out.push({ node: n, depth, parent });
    if (n.children.length && open.has(n.id)) for (const c of n.children) walk(c, depth + 1, n.id);
  };
  walk(root, 1, null);
  return out;
}

export type TreeKeyAction = "next" | "prev" | "open" | "close" | "first" | "last" | "activate" | null;

export function treeKey(key: string, dir: Dir): TreeKeyAction {
  const openKey = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
  const closeKey = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
  switch (key) {
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "prev";
    case openKey:
      return "open";
    case closeKey:
      return "close";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "Enter":
      return "activate";
    default:
      return null;
  }
}

function initialOpen(root: VizTreeNode, depth: number): Set<string> {
  const s = new Set<string>();
  const walk = (n: VizTreeNode, d: number) => {
    if (d < depth && n.children.length) {
      s.add(n.id);
      n.children.forEach((c) => walk(c, d + 1));
    }
  };
  walk(root, 0);
  return s;
}

export function AriaTree({ root, label, dir, valueText = (n) => String(n.value), onActivate, openDepth = 1, id, hidden }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => initialOpen(root, openDepth));
  const [focus, setFocus] = useState<string>(root.id);
  const [moved, setMoved] = useState(false);
  const refs = useRef(new Map<string, HTMLLIElement>());
  const items = useMemo(() => visibleItems(root, open), [root, open]);

  useEffect(() => {
    if (moved) refs.current.get(focus)?.focus();
  }, [focus, moved]);

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const action = treeKey(e.key, dir);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    const i = Math.max(0, items.findIndex((it) => it.node.id === focus));
    const cur = items[i];
    const go = (to: string) => {
      setMoved(true);
      setFocus(to);
    };
    switch (action) {
      case "next":
        if (i < items.length - 1) go(items[i + 1].node.id);
        break;
      case "prev":
        if (i > 0) go(items[i - 1].node.id);
        break;
      case "first":
        go(items[0].node.id);
        break;
      case "last":
        go(items[items.length - 1].node.id);
        break;
      case "open":
        if (!cur.node.children.length) break;
        if (!open.has(cur.node.id)) setOpen(new Set(open).add(cur.node.id));
        else go(cur.node.children[0].id);
        break;
      case "close":
        if (cur.node.children.length && open.has(cur.node.id)) {
          const next = new Set(open);
          next.delete(cur.node.id);
          setOpen(next);
        } else if (cur.parent !== null) go(cur.parent);
        break;
      case "activate":
        onActivate?.(cur.node);
        break;
    }
  };

  const render = (n: VizTreeNode, depth: number, pos: number, size: number) => {
    const isOpen = open.has(n.id);
    return (
      <li
        key={n.id}
        role="treeitem"
        aria-level={depth}
        aria-setsize={size}
        aria-posinset={pos}
        aria-expanded={n.children.length ? isOpen : undefined}
        aria-selected={n.id === focus}
        tabIndex={n.id === focus ? 0 : -1}
        ref={(el) => {
          if (el) refs.current.set(n.id, el);
          else refs.current.delete(n.id);
        }}
        onClick={(e) => {
          e.stopPropagation();
          setFocus(n.id);
          if (n.children.length) {
            const next = new Set(open);
            if (isOpen) next.delete(n.id);
            else next.add(n.id);
            setOpen(next);
          } else onActivate?.(n);
        }}
        data-tree-id={n.id}
        className="lumen-viz-treeitem"
      >
        <span className="lumen-viz-treelabel">
          <span dir="auto">{n.name}</span> <bdi className="lumen-viz-treevalue">{valueText(n)}</bdi>
        </span>
        {n.children.length > 0 && isOpen && (
          <ul role="group">{n.children.map((c, k) => render(c, depth + 1, k + 1, n.children.length))}</ul>
        )}
      </li>
    );
  };

  return (
    <div className="lumen-viz-tree-wrap" id={id} hidden={hidden}>
      <ul role="tree" aria-label={label} className="lumen-viz-tree" dir={dir} onKeyDown={onKeyDown}>
        {render(root, 1, 1, 1)}
      </ul>
    </div>
  );
}
