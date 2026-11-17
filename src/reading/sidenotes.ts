/**
 * The "margins" reading mode (plan W13.R9): footnotes, comments and
 * suggestions as side notes next to the line they belong to, Tufte style.
 *
 * - Footnotes (`[^1]`), CriticMarkup comments (`{>>…<<}`) and suggestions
 *   (`{++…++}`, `{--…--}`, `{~~a~>b~~}`) of the rendered preview, and the
 *   collab comments of a shared note (anchored by source line through the
 *   blocks' `data-sl`, plan W13.R7), each become a note in the margin.
 * - The margin is the inline end: on the right of English text, on the
 *   left of Hebrew. Notes that would overlap are pushed down
 *   (./sidenotesLayout.ts); pointing at or focusing a note or its anchor
 *   marks both and draws a line between them.
 * - Under 700px the notes go under the paragraph that holds their anchor.
 * - Keyboard: a footnote mark (a link) goes to its note; in a note, ↑/↓ go
 *   to the previous / next note and Enter or Escape back to the anchor in
 *   the text. Each note is a `role="note"` with a label ("Footnote 2",
 *   "Comment by Dana", "Suggested insertion").
 *
 * DOM only, no React: the notes live in a layer the preview does not own,
 * rebuilt when the preview re-renders.
 */
import "./readingViewsStrings";
import "./sidenotes.css";
import { t } from "../i18n";
import { layoutSidenotes, NARROW_PX, type SidenoteKind } from "./sidenotesLayout";
import { setSidenotes, sidenotesOn } from "./sidenotesSetting";
import { announce } from "../a11y/announce";

/** The palette's switch: margins on or off for every preview, said aloud. */
export function toggleSidenotes(): void {
  const on = !sidenotesOn();
  setSidenotes(on);
  announce(t(on ? "readingViews.sidenotes.on" : "readingViews.sidenotes.off"));
}

export interface LineNote {
  /** Source line (1-based) the note is anchored to. */
  line: number;
  text: string;
  author?: string;
}

export interface SidenotesOptions {
  /** Line-anchored notes (collab comments), resolved through the blocks' data-sl. */
  lineNotes?: () => LineNote[];
  /** Force a layout (tests); default: by the root's width. */
  narrow?: boolean;
}

export interface Sidenote {
  kind: SidenoteKind;
  anchor: HTMLElement;
  /** The number shown on the note and next to its anchor. */
  label: string;
  /** The note's content: a copy of the footnote, or text. */
  content: Node[] | string;
  author?: string;
}

const OWN = "data-sn-own";

/** Take a mark off an element of the preview, leaving no empty class attribute behind. */
function unmark(el: Element): void {
  el.classList.remove("sn-active");
  if (el.getAttribute("class") === "") el.removeAttribute("class");
}
const clip = (s: string) => {
  const x = s.replace(/\s+/g, " ").trim();
  return x.length > 140 ? x.slice(0, 137) + "…" : x;
};

/** The notes of a rendered preview, in document order. */
export function collectSidenotes(root: HTMLElement, lineNotes: LineNote[] = []): Sidenote[] {
  const out: Sidenote[] = [];
  const seen = new Set<Element>();
  const all = root.querySelectorAll<HTMLElement>("a[data-footnote-ref], mark.critic-comment, ins.critic-ins, del.critic-del");
  for (const el of all) {
    if (el.closest(`[${OWN}]`) || seen.has(el)) continue;
    if (el.matches("a[data-footnote-ref]")) {
      const id = decodeURIComponent((el.getAttribute("href") ?? "").replace(/^#/, ""));
      const def = id ? Array.from(root.querySelectorAll("[id]")).find((n) => n.id === id) : null;
      if (!def) continue;
      const copy = def.cloneNode(true) as HTMLElement;
      copy.querySelectorAll("[data-footnote-backref]").forEach((n) => n.remove());
      copy.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      out.push({ kind: "footnote", anchor: el, label: el.textContent ?? "", content: Array.from(copy.childNodes) });
    } else if (el.matches("mark.critic-comment")) {
      // The comment is about the highlight just before it ({==words==}{>>note<<}), else the words before it.
      const prev = el.previousElementSibling;
      const anchor = prev && prev.matches("mark.critic-highlight") ? (prev as HTMLElement) : el;
      out.push({ kind: "comment", anchor, label: "", content: clip(el.textContent ?? "") });
    } else if (el.matches("del.critic-del") && el.nextElementSibling?.matches("ins.critic-ins") && el.nextSibling === el.nextElementSibling) {
      const ins = el.nextElementSibling as HTMLElement;
      seen.add(ins);
      out.push({ kind: "replace", anchor: el, label: "", content: t("readingViews.sidenotes.replace", { old: clip(el.textContent ?? ""), new: clip(ins.textContent ?? "") }) });
    } else if (el.matches("del.critic-del")) {
      out.push({ kind: "delete", anchor: el, label: "", content: t("readingViews.sidenotes.delete", { text: clip(el.textContent ?? "") }) });
    } else {
      out.push({ kind: "insert", anchor: el, label: "", content: t("readingViews.sidenotes.insert", { text: clip(el.textContent ?? "") }) });
    }
  }
  // Collab comments: the innermost block whose lines hold the comment's line.
  if (lineNotes.length) {
    const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-sl]:not([data-sb])"));
    for (const n of lineNotes) {
      let best: HTMLElement | null = null;
      let span = Infinity;
      for (const b of blocks) {
        const s = Number(b.dataset.sl);
        const e = Number(b.dataset.sle ?? s);
        if (s <= n.line && n.line <= e && e - s < span) {
          best = b;
          span = e - s;
        }
      }
      if (best) out.push({ kind: "comment", anchor: best, label: "", content: clip(n.text), author: n.author });
    }
  }
  // Document order (collab comments were appended), then numbers for the notes that have none.
  out.sort((a, b) => (a.anchor === b.anchor ? 0 : a.anchor.compareDocumentPosition(b.anchor) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  let k = 0;
  for (const n of out) if (!n.label) n.label = String.fromCharCode(0x61 + (k++ % 26)) + (k > 26 ? String(Math.floor((k - 1) / 26)) : "");
  return out;
}

function noteLabel(n: Sidenote): string {
  switch (n.kind) {
    case "footnote":
      return t("readingViews.sidenotes.footnote", { n: n.label });
    case "comment":
      return n.author ? t("readingViews.sidenotes.commentBy", { name: n.author }) : t("readingViews.sidenotes.comment");
    case "insert":
      return t("readingViews.sidenotes.suggestInsert");
    case "delete":
      return t("readingViews.sidenotes.suggestDelete");
    default:
      return t("readingViews.sidenotes.suggestReplace");
  }
}

/** Turn the margins mode on for a preview root. Returns the function that turns it off. */
export function attachSidenotes(root: HTMLElement, opts: SidenotesOptions = {}): () => void {
  const doc = root.ownerDocument;
  const layer = doc.createElement("div");
  layer.className = "sn-layer";
  layer.setAttribute(OWN, "");
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "sn-wire");
  svg.setAttribute("aria-hidden", "true");
  layer.append(svg);
  const list = doc.createElement("div");
  list.className = "sn-list";
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", t("readingViews.sidenotes.title"));
  layer.append(list);
  let notes: Sidenote[] = [];
  let elements: HTMLElement[] = [];
  let inline: HTMLElement[] = [];
  let active = -1;
  let raf = 0;
  let disposed = false;

  const content = () => root.querySelector<HTMLElement>(".prose-lumen") ?? root;
  const isNarrow = () => opts.narrow ?? root.clientWidth < NARROW_PX;

  const clearInline = () => {
    for (const el of inline) el.remove();
    inline = [];
  };

  const makeNote = (n: Sidenote, i: number, tag: "aside" | "div"): HTMLElement => {
    const el = doc.createElement(tag);
    el.className = `sn-note sn-${n.kind}`;
    el.setAttribute(OWN, "");
    el.setAttribute("role", "note");
    el.setAttribute("aria-label", noteLabel(n));
    el.tabIndex = 0;
    el.dataset.sn = String(i);
    el.dir = "auto";
    const head = doc.createElement("span");
    head.className = "sn-num";
    head.textContent = n.label;
    head.setAttribute("aria-hidden", "true");
    el.append(head);
    if (n.author) {
      const by = doc.createElement("span");
      by.className = "sn-by";
      by.textContent = n.author;
      el.append(by, doc.createTextNode(" "));
    }
    const body = doc.createElement("span");
    body.className = "sn-body";
    if (typeof n.content === "string") body.textContent = n.content;
    else for (const c of n.content) body.append(c.cloneNode(true));
    el.append(body);
    return el;
  };

  const anchorTop = (a: HTMLElement) => {
    const r = a.getBoundingClientRect();
    return r.top - root.getBoundingClientRect().top + root.scrollTop;
  };

  const build = () => {
    raf = 0;
    if (disposed) return;
    const narrow = isNarrow();
    root.dataset.sidenotes = narrow ? "inline" : "margin";
    clearInline();
    list.replaceChildren();
    for (const old of root.querySelectorAll("[data-sn-anchor]")) {
      old.removeAttribute("data-sn-anchor");
      old.removeAttribute("data-sn-mark");
      unmark(old);
    }
    notes = collectSidenotes(root, opts.lineNotes?.() ?? []);
    root.dataset.sidenoteCount = String(notes.length);
    elements = notes.map((n, i) => {
      n.anchor.setAttribute("data-sn-anchor", String(i));
      if (n.kind !== "footnote") n.anchor.dataset.snMark = n.label;
      return makeNote(n, i, narrow ? "aside" : "div");
    });
    if (narrow) {
      layer.remove();
      // Under the block that holds each anchor, in order.
      const lastAfter = new Map<Element, HTMLElement>();
      elements.forEach((el, i) => {
        const block = notes[i].anchor.closest("p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, figure") ?? notes[i].anchor;
        const after = lastAfter.get(block) ?? block;
        el.classList.add("sn-inline");
        after.after(el);
        lastAfter.set(block, el);
        inline.push(el);
      });
      return;
    }
    if (!layer.isConnected) root.append(layer);
    for (const el of elements) {
      const item = doc.createElement("div");
      item.setAttribute("role", "listitem");
      item.className = "sn-item";
      item.append(el);
      list.append(item);
    }
    // Measure, then place.
    const boxes = elements.map((el, i) => ({ anchor: anchorTop(notes[i].anchor), height: el.offsetHeight }));
    const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].anchor - boxes[b].anchor);
    const tops = layoutSidenotes(order.map((i) => boxes[i]), 10, 0, Math.max(root.scrollHeight, content().scrollHeight));
    order.forEach((i, k) => {
      (elements[i].parentElement as HTMLElement).style.top = `${Math.round(tops[k])}px`;
      elements[i].dataset.top = String(Math.round(tops[k]));
    });
    layer.style.height = `${Math.max(...tops.map((tp, k) => tp + boxes[order[k]].height), 0)}px`;
    if (active >= 0) highlight(active);
  };

  const schedule = () => {
    if (raf || disposed) return;
    raf = requestAnimationFrame(build);
  };

  const wire = (i: number) => {
    svg.replaceChildren();
    if (i < 0 || isNarrow()) return;
    const a = notes[i]?.anchor;
    const el = elements[i];
    if (!a || !el) return;
    const lr = layer.getBoundingClientRect();
    const ar = a.getBoundingClientRect();
    const nr = el.getBoundingClientRect();
    const rtl = getComputedStyle(root).direction === "rtl";
    // From the anchor's end (the side towards the margin) to the note's start edge.
    const x1 = (rtl ? ar.left : ar.right) - lr.left;
    // Along the bottom of the anchor's line, so the wire runs under the text rather than through it.
    const y1 = ar.bottom - lr.top;
    const x2 = (rtl ? nr.right : nr.left) - lr.left;
    const y2 = nr.top + Math.min(12, nr.height / 2) - lr.top;
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    const mx = (x1 + x2) / 2;
    path.setAttribute("d", `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
    svg.append(path);
  };

  const highlight = (i: number) => {
    for (const el of root.querySelectorAll(".sn-active")) unmark(el);
    active = i;
    if (i < 0) {
      wire(-1);
      return;
    }
    notes[i]?.anchor.classList.add("sn-active");
    elements[i]?.classList.add("sn-active");
    wire(i);
  };

  const indexOf = (target: EventTarget | null): { note: number; anchor: number } => {
    const el = target as Element | null;
    const n = el?.closest?.("[data-sn]");
    const a = el?.closest?.("[data-sn-anchor]");
    return { note: n ? Number((n as HTMLElement).dataset.sn) : -1, anchor: a ? Number(a.getAttribute("data-sn-anchor")) : -1 };
  };

  const focusAnchor = (i: number) => {
    const a = notes[i]?.anchor;
    if (!a) return;
    if (a.tabIndex < 0 && !a.hasAttribute("tabindex")) {
      a.tabIndex = -1;
      a.setAttribute("data-sn-tab", "");
    }
    a.focus({ preventScroll: false });
    highlight(i);
  };

  const onOver = (e: Event) => {
    const { note, anchor } = indexOf(e.target);
    const i = note >= 0 ? note : anchor;
    if (i >= 0 && i !== active) highlight(i);
  };
  const onOut = (e: Event) => {
    const to = (e as MouseEvent).relatedTarget as Element | null;
    const { note, anchor } = indexOf(to);
    if (note < 0 && anchor < 0 && !(doc.activeElement && indexOf(doc.activeElement).note >= 0)) highlight(-1);
  };
  const onKey = (e: KeyboardEvent) => {
    const { note } = indexOf(e.target);
    if (note < 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(elements.length - 1, Math.max(0, note + (e.key === "ArrowDown" ? 1 : -1)));
      elements[next]?.focus();
      highlight(next);
    } else if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      focusAnchor(note);
    }
  };
  // A footnote mark goes to its note (not to the bottom of the page).
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.("a[data-footnote-ref]");
    if (!a || !root.contains(a)) return;
    const i = Number(a.getAttribute("data-sn-anchor"));
    if (!(i >= 0) || !elements[i]) return;
    e.preventDefault();
    elements[i].focus();
    highlight(i);
  };

  root.addEventListener("mouseover", onOver);
  root.addEventListener("focusin", onOver);
  root.addEventListener("mouseout", onOut);
  root.addEventListener("keydown", onKey);
  root.addEventListener("click", onClick);
  const mo = new MutationObserver((records) => {
    // Our own notes and marks change the tree too: only the preview's re-renders count.
    if (records.every((r) => (r.target as Element).closest?.(`[${OWN}]`) || [...r.addedNodes, ...r.removedNodes].every((n) => n instanceof Element && n.hasAttribute(OWN)))) return;
    schedule();
  });
  mo.observe(root, { childList: true, subtree: true });
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
  ro?.observe(root);
  doc.documentElement.dataset.sidenotesOn = "";
  build();

  return () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    mo.disconnect();
    ro?.disconnect();
    root.removeEventListener("mouseover", onOver);
    root.removeEventListener("focusin", onOver);
    root.removeEventListener("mouseout", onOut);
    root.removeEventListener("keydown", onKey);
    root.removeEventListener("click", onClick);
    clearInline();
    layer.remove();
    for (const el of root.querySelectorAll("[data-sn-anchor]")) {
      el.removeAttribute("data-sn-anchor");
      el.removeAttribute("data-sn-mark");
      unmark(el);
    }
    for (const el of root.querySelectorAll("[data-sn-tab]")) {
      el.removeAttribute("tabindex");
      el.removeAttribute("data-sn-tab");
    }
    delete root.dataset.sidenotes;
    delete root.dataset.sidenoteCount;
    delete doc.documentElement.dataset.sidenotesOn;
  };
}
