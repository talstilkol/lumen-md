/**
 * Linked panes (plan W13.R7): the DOM side of ./scrollSync.ts.
 *
 * A `LinkedPane` is a scroll container that knows which source line is at
 * its top. `linkPanes(a, b)` keeps them together: the pane the reader is
 * using (pointer over it, focus in it, wheel, keys, touch) is the leader,
 * the other follows its top line; the follower's own scroll events are
 * ignored for a moment so the two never bounce. Any two panes link: the
 * source editor and its preview, a note and another note's preview, the
 * two columns of the compare view.
 *
 * Adapters here: `editorPane` (CodeMirror's exact line geometry) and
 * `previewPane` (the blocks' `data-sl` lines, with the heading ids as a
 * fallback, and proportional scrolling when there is neither).
 */
import { anchorMap, boxAtLine, headingLines, lineToY, yToLine, type LineBox, type LinePoint } from "./scrollSync";
import { lineBasesOf } from "../renderer/sourceLineRegistry";
import { headingSlugger } from "../lib/slug";

export interface LinkedPane {
  /** The scroll container. */
  el: HTMLElement;
  /** The (fractional) source line at the top of the view; null: no line map (scroll proportionally). */
  topLine(): number | null;
  /** Scroll so (fractional) `line` is at the top. False: no line map. */
  scrollToLine(line: number): boolean;
  /** Mark the block that holds `line` (selection follow); null clears. */
  markLine?(line: number | null): void;
  /** The caret's line, for a pane that has one (the source editor). */
  caretLine?(): number | null;
  dispose?(): void;
}

/** The CodeMirror surface `editorPane` needs (a subset of EditorView). */
export interface EditorLike {
  state: { doc: { lines: number; line(n: number): { from: number }; lineAt?(pos: number): { number: number } }; selection?: { main: { head: number } } };
  lineBlockAt(pos: number): { top: number; height?: number; from?: number };
  lineBlockAtHeight?(h: number): { top: number; height: number; from: number };
  documentTop?: number;
  hasFocus?: boolean;
}

/** Top of the document inside the scroller (CodeMirror's padding above line 1). */
function docOffset(view: EditorLike, scroller: HTMLElement): number {
  if (typeof view.documentTop !== "number") return 0;
  return view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

const clampLine = (n: number, lines: number) => Math.min(Math.max(1, Math.floor(n)), Math.max(1, lines));

export function editorPane(scroller: HTMLElement, getView: () => EditorLike | null): LinkedPane {
  const blockOf = (view: EditorLike, n: number) => {
    const b = view.lineBlockAt(view.state.doc.line(n).from);
    const next = n < view.state.doc.lines ? view.lineBlockAt(view.state.doc.line(n + 1).from).top : null;
    return { top: b.top, height: b.height ?? (next !== null ? next - b.top : 0) };
  };
  return {
    el: scroller,
    topLine() {
      const view = getView();
      if (!view) return null;
      const h = scroller.scrollTop - docOffset(view, scroller);
      const lines = view.state.doc.lines;
      if (view.lineBlockAtHeight && view.state.doc.lineAt) {
        const b = view.lineBlockAtHeight(Math.max(0, h));
        const n = view.state.doc.lineAt(b.from).number;
        return n + (b.height > 0 ? Math.min(1, Math.max(0, (h - b.top) / b.height)) : 0);
      }
      // A view without height lookup: binary search the line tops.
      let lo = 1;
      let hi = lines;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (blockOf(view, mid).top <= h) lo = mid;
        else hi = mid - 1;
      }
      const b = blockOf(view, lo);
      return lo + (b.height > 0 ? Math.min(1, Math.max(0, (h - b.top) / b.height)) : 0);
    },
    scrollToLine(line) {
      const view = getView();
      if (!view) return false;
      const lines = view.state.doc.lines;
      if (line >= lines + 1) {
        scroller.scrollTop = scroller.scrollHeight;
        return true;
      }
      const n = clampLine(line, lines);
      const b = blockOf(view, n);
      scroller.scrollTop = Math.max(0, b.top + (line - n) * b.height + docOffset(view, scroller));
      return true;
    },
    caretLine() {
      const view = getView();
      const sel = view?.state.selection;
      if (!view || !sel || !view.state.doc.lineAt) return null;
      return view.state.doc.lineAt(sel.main.head).number;
    },
  };
}

interface Box extends LineBox {
  el: HTMLElement;
}

/**
 * A rendered preview as a linked pane. `getText` gives the note's source,
 * used only for the heading fallback (a preview rendered without lines).
 */
export function previewPane(root: HTMLElement, getText: () => string): LinkedPane {
  let cache: { points: LinePoint[]; boxes: Box[] } | null = null;
  const invalidate = () => {
    cache = null;
  };
  const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(invalidate) : null;
  mo?.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-sl", "data-sb", "style", "class"] });
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(invalidate) : null;
  ro?.observe(root);
  let marked: HTMLElement | null = null;

  const build = () => {
    if (cache) return cache;
    const rootTop = root.getBoundingClientRect().top - root.scrollTop;
    const bases = lineBasesOf(root);
    const boxes: Box[] = [];
    for (const el of root.querySelectorAll<HTMLElement>("[data-sl]")) {
      let start = Number(el.dataset.sl);
      let end = Number(el.dataset.sle ?? start);
      const key = el.dataset.sb;
      if (key) {
        const base = bases?.get(key);
        if (base === undefined) continue;
        start += base - 1;
        end += base - 1;
      }
      const r = el.getBoundingClientRect();
      if (!r.height && !r.width) continue; // hidden (a folded callout's body, display: none)
      boxes.push({ el, start, end, top: r.top - rootTop, bottom: r.bottom - rootTop });
    }
    let points: LinePoint[];
    if (boxes.length) {
      points = anchorMap(boxes);
    } else {
      // No line stamps (an older render, a stand-in): headings by id, as before W13.R7.
      const slugger = headingSlugger();
      points = [{ line: 1, y: 0 }];
      for (const h of headingLines(getText())) {
        const id = slugger.slug(h.title);
        const el = root.querySelector<HTMLElement>(`[id="${id.replace(/"/g, '\\"')}"]`);
        if (el) points.push({ line: h.line, y: el.offsetTop });
      }
      if (points.length === 1) points = [];
      else {
        const lines = getText().split("\n").length;
        points.push({ line: lines + 1, y: root.scrollHeight });
        points = points.filter((p, i, all) => i === 0 || (p.line > all[i - 1].line && p.y >= all[i - 1].y));
      }
    }
    cache = { points, boxes };
    return cache;
  };

  return {
    el: root,
    topLine() {
      const { points } = build();
      if (points.length < 2) return null;
      return yToLine(points, root.scrollTop);
    },
    scrollToLine(line) {
      const { points } = build();
      if (points.length < 2) return false;
      root.scrollTop = Math.max(0, lineToY(points, line));
      return true;
    },
    markLine(line) {
      if (marked) marked.removeAttribute("data-sync-caret");
      marked = null;
      if (line === null) return;
      const box = boxAtLine(build().boxes, line);
      if (box) {
        marked = box.el;
        marked.setAttribute("data-sync-caret", "");
      }
    },
    dispose() {
      mo?.disconnect();
      ro?.disconnect();
      if (marked) marked.removeAttribute("data-sync-caret");
    },
  };
}

/** Proportional position: the fallback when a pane has no line map. */
function ratioOf(el: HTMLElement): number {
  const denom = el.scrollHeight - el.clientHeight;
  return denom > 0 ? el.scrollTop / denom : 0;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Keep `a` and `b` scrolled to the same source line. Returns the unlink
 * function. `followCaret`: the preview marks (and brings into view) the
 * block that holds the editor's caret.
 */
export function linkPanes(a: LinkedPane, b: LinkedPane, opts: { followCaret?: boolean } = {}): () => void {
  let active: LinkedPane | null = null;
  const quietUntil = new WeakMap<LinkedPane, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const other = (p: LinkedPane) => (p === a ? b : a);

  const sync = (from: LinkedPane) => {
    const to = other(from);
    quietUntil.set(to, now() + 150);
    const atEnd = from.el.scrollHeight - from.el.clientHeight - from.el.scrollTop <= 1 && from.el.scrollTop > 0;
    if (atEnd) {
      to.el.scrollTop = to.el.scrollHeight;
      return;
    }
    const line = from.topLine();
    if (line !== null && to.scrollToLine(line)) return;
    to.el.scrollTop = ratioOf(from.el) * Math.max(0, to.el.scrollHeight - to.el.clientHeight);
  };

  const listeners: Array<() => void> = [];
  const on = (el: EventTarget, type: string, fn: EventListener, o?: AddEventListenerOptions) => {
    el.addEventListener(type, fn, o);
    listeners.push(() => el.removeEventListener(type, fn, o));
  };
  for (const pane of [a, b]) {
    const lead = () => {
      active = pane;
      // The reader took this pane: its scrolls lead from now on, even right after it followed.
      quietUntil.delete(pane);
    };
    for (const type of ["mouseenter", "focusin", "wheel", "touchstart", "keydown", "pointerdown"]) on(pane.el, type, lead, { passive: true });
    on(
      pane.el,
      "scroll",
      () => {
        if (active !== pane) return;
        if (now() < (quietUntil.get(pane) ?? 0)) return;
        clearTimeout(timer);
        timer = setTimeout(() => sync(pane), 16);
      },
      { passive: true },
    );
  }

  if (opts.followCaret) {
    const caretOwner = a.caretLine ? a : b.caretLine ? b : null;
    const marker = caretOwner ? other(caretOwner) : null;
    if (caretOwner && marker?.markLine) {
      let last: number | null = null;
      const follow = () => {
        const line = caretOwner.caretLine!();
        if (line === last) return;
        last = line;
        marker.markLine!(line);
      };
      on(document, "selectionchange", follow);
      on(caretOwner.el, "keyup", follow);
      on(caretOwner.el, "mouseup", follow);
      listeners.push(() => marker.markLine!(null));
    }
  }

  return () => {
    clearTimeout(timer);
    for (const off of listeners) off();
  };
}
