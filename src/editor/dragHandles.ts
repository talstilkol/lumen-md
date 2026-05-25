/**
 * ProseMirror plugin — drag-handles on every top-level block.
 *
 * Renders a small ⠿ widget to the left of the block under the pointer.
 * Pressing and dragging the widget reorders the block: when the user
 * drops on a different sibling, the source slice is moved to the drop
 * position via a single transaction.
 *
 * Why a custom plugin instead of `prosemirror-handle` (which doesn't
 * ship with Milkdown): we need a tiny no-deps implementation that
 * cooperates with the existing Milkdown listener / clipboard plugins
 * without ownership conflicts. The plugin is ~120 lines and binds only
 * to the ProseMirror primitives Milkdown already exposes.
 *
 * Wire-up (see `WysiwygEditor.tsx`):
 *   import { dragHandlePlugin } from "./dragHandles";
 *   editor.use(dragHandlePlugin);
 */

import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import type { EditorState } from "prosemirror-state";

const HANDLE_KEY = new PluginKey("lumen-drag-handle");

interface DragState {
  /** ProseMirror position of the source block (start of the node). */
  fromPos: number | null;
  /** Hover indicator — the position we'd insert the source at on drop. */
  hoverPos: number | null;
}

const initial: DragState = { fromPos: null, hoverPos: null };

/**
 * Build the handle DOM. Lives entirely on the editor host so we can
 * mount it via `Decoration.widget(side: -1)`. The handle responds to
 * `dragstart` / `dragend`; the editor's container listens for
 * `dragover` / `drop` to update hover + commit the move.
 */
function makeHandle(view: EditorView, blockPos: number): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "lumen-drag-handle";
  el.setAttribute("contenteditable", "false");
  el.draggable = true;
  el.title = "Drag to reorder block";
  el.setAttribute("aria-label", "Drag block handle");
  el.textContent = "⠿";
  el.style.cssText = [
    "position: absolute",
    "left: -22px",
    "top: 4px",
    "width: 18px",
    "height: 18px",
    "border: none",
    "background: transparent",
    "color: hsl(var(--fg-muted))",
    "cursor: grab",
    "font-size: 14px",
    "line-height: 1",
    "padding: 0",
    "opacity: 0",
    "transition: opacity 120ms",
    "user-select: none",
  ].join(";");

  el.addEventListener("dragstart", (e) => {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = "move";
    // Firefox needs setData to start the drag.
    e.dataTransfer.setData("application/x-lumen-block", String(blockPos));
    view.dispatch(
      view.state.tr.setMeta(HANDLE_KEY, { fromPos: blockPos, hoverPos: null }),
    );
    el.style.cursor = "grabbing";
  });

  el.addEventListener("dragend", () => {
    el.style.cursor = "grab";
    view.dispatch(view.state.tr.setMeta(HANDLE_KEY, initial));
  });

  // Keyboard a11y — focus the handle then ↑/↓ moves the block one step
  // in either direction; Enter / Space behaves the same as a click on
  // the block (focus the editor at the block start). Without this,
  // drag-handles are mouse-only and screen-reader / keyboard users
  // can't reorder blocks at all.
  el.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      moveBlockByOne(view, blockPos, e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      view.focus();
      const tr = view.state.tr.setSelection(
        TextSelection.near(view.state.doc.resolve(blockPos + 1)),
      );
      view.dispatch(tr);
    }
  });

  return el;
}

/**
 * Move the block at `fromPos` up (`dir = -1`) or down (`dir = +1`) by
 * one sibling within the document. No-op when already at the boundary.
 */
function moveBlockByOne(view: EditorView, fromPos: number, dir: -1 | 1): void {
  const node = view.state.doc.nodeAt(fromPos);
  if (!node) return;
  const sourceTo = fromPos + node.nodeSize;
  // Find the sibling we'd swap with by walking direct children.
  let prev = -1;
  let next = -1;
  let pos = 0;
  view.state.doc.forEach((child, off) => {
    if (off === fromPos) {
      // already-set
    } else if (off < fromPos) {
      prev = off;
    } else if (off > fromPos && next === -1) {
      next = off;
    }
    pos = off + child.nodeSize;
  });
  void pos;

  let target: number;
  if (dir === -1) {
    if (prev < 0) return; // already at top
    target = prev;
  } else {
    if (next < 0) return; // already at bottom
    const nextNode = view.state.doc.nodeAt(next);
    if (!nextNode) return;
    target = next + nextNode.nodeSize;
  }

  const slice = view.state.doc.slice(fromPos, sourceTo);
  const tr = view.state.tr.delete(fromPos, sourceTo);
  // Adjust target by the deletion's length when the target was after
  // the source.
  const adjusted = target > sourceTo ? target - node.nodeSize : target;
  tr.insert(adjusted, slice.content);
  view.dispatch(tr);
}

/**
 * Compute one widget decoration per top-level block. We only decorate
 * direct children of the doc root — nested lists / quotes get a single
 * handle for the outer block, which is the convention every Notion-like
 * editor follows.
 */
function buildDecorations(state: EditorState): DecorationSet {
  const decos: Decoration[] = [];
  state.doc.forEach((node, offset) => {
    if (node.isBlock) {
      decos.push(
        Decoration.widget(offset + 1, (view) => makeHandle(view, offset), {
          side: -1,
          ignoreSelection: true,
          key: `lumen-drag-${offset}`,
        }),
      );
    }
  });
  return DecorationSet.create(state.doc, decos);
}

/**
 * The plugin. Decorations recompute on every doc change; the drag-state
 * meta key is used purely for the hover indicator (not yet rendered —
 * the visible affordance is the source-row's reduced opacity, applied
 * via CSS via the hover decoration).
 */
export const dragHandlePlugin = new Plugin<DragState>({
  key: HANDLE_KEY,
  state: {
    init: () => initial,
    apply(tr, value) {
      const meta = tr.getMeta(HANDLE_KEY);
      if (meta) return meta as DragState;
      return value;
    },
  },
  props: {
    decorations(this: Plugin<DragState>, state) {
      return buildDecorations(state);
    },
    handleDOMEvents: {
      // Show / hide the handle on row hover. We rely on the visible CSS
      // pseudo-class :hover on the parent block by mutating the handle's
      // opacity from a delegated mousemove listener — much cheaper than
      // a per-block React state + ResizeObserver.
      mousemove(view, e) {
        const root = view.dom;
        const handles = root.querySelectorAll<HTMLElement>(".lumen-drag-handle");
        const target = e.target as HTMLElement;
        for (const h of handles) {
          // The handle's absolute positioning means its DOMRect lives
          // outside the block; check the parent block instead.
          const parent = h.parentElement;
          if (!parent) continue;
          if (parent.contains(target) || parent === target) {
            h.style.opacity = "0.6";
          } else {
            h.style.opacity = "0";
          }
        }
        return false;
      },
      mouseleave(view) {
        for (const h of view.dom.querySelectorAll<HTMLElement>(".lumen-drag-handle")) {
          h.style.opacity = "0";
        }
        return false;
      },
      dragover(view, e) {
        // Compute the position the source would land at on drop, store
        // it as hover meta so we can render a visual indicator.
        if (!e.dataTransfer?.types?.includes("application/x-lumen-block")) {
          return false;
        }
        e.preventDefault();
        const coords = view.posAtCoords({ left: e.clientX, top: e.clientY });
        if (!coords) return true;
        view.dispatch(
          view.state.tr.setMeta(HANDLE_KEY, {
            ...view.state.tr.getMeta(HANDLE_KEY),
            hoverPos: coords.pos,
          }),
        );
        return true;
      },
      drop(view, e) {
        const data = e.dataTransfer?.getData("application/x-lumen-block");
        if (!data) return false;
        const fromPos = Number(data);
        if (!Number.isFinite(fromPos)) return false;
        e.preventDefault();
        const coords = view.posAtCoords({ left: e.clientX, top: e.clientY });
        if (!coords) return true;
        const sourceNode = view.state.doc.nodeAt(fromPos);
        if (!sourceNode) return true;
        const sourceTo = fromPos + sourceNode.nodeSize;
        let target = coords.pos;
        // If we'd insert into the source's own range, snap to its end.
        if (target >= fromPos && target <= sourceTo) target = sourceTo;
        const slice = view.state.doc.slice(fromPos, sourceTo);
        const tr = view.state.tr;
        // Delete first, then insert at the (shifted) target.
        tr.delete(fromPos, sourceTo);
        const adjusted = target > sourceTo ? target - sourceNode.nodeSize : target;
        tr.insert(adjusted, slice.content);
        tr.setMeta(HANDLE_KEY, initial);
        view.dispatch(tr);
        return true;
      },
    },
  },
});
