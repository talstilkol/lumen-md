/**
 * A note as a book (plan W13.R6): the preview paged into two-page
 * spreads, with the PDF reader's controls (one page / two pages / two
 * pages with the first alone; the book's direction) and keys (← / → in the
 * book's direction, PageUp / PageDown, Space, Home / End).
 *
 * Switching between the spread and the scrolling preview keeps the
 * reading place: the first block on the page is the first block in view
 * after the switch, and back. The place and the choice are kept per note.
 */
import "./readingViewsStrings";
import "../pdf/spreadStrings";
import "./bookSpread.css";
import { t } from "../i18n";
import { announce } from "../a11y/announce";
import { bookDirOf } from "../pdf/spread";
import { loadPlace, savePlace, spreadForKey, type BookDir, type SpreadMode } from "./bookSpread";
import { blocksOf, createSpreadFlow, type SpreadFlow } from "./spreadFlow";

/** The first block in view of a scrolling preview. */
export function firstVisibleBlock(root: HTMLElement, flow: HTMLElement): number {
  const top = root.getBoundingClientRect().top;
  const blocks = blocksOf(flow);
  const i = blocks.findIndex((b) => b.getBoundingClientRect().bottom > top + 1);
  return Math.max(0, i);
}

export interface NoteSpread {
  readonly flow: SpreadFlow;
  /** Back to scrolling. `keepOn`: the note is being left or re-rendered — it opens in spreads next time. */
  dispose(keepOn?: boolean): void;
}

export function attachNoteSpread(root: HTMLElement, id: string, opts: { mode?: SpreadMode; dir?: BookDir } = {}): NoteSpread | null {
  const flowEl = root.querySelector<HTMLElement>(".prose-lumen");
  if (!flowEl) return null;
  const doc = root.ownerDocument;
  const saved = loadPlace(id);
  const scrolledTo = firstVisibleBlock(root, flowEl);
  let mode: SpreadMode = opts.mode ?? saved.mode;
  let dir: BookDir = opts.dir ?? saved.dir ?? bookDirOf(flowEl.textContent ?? "");
  root.dataset.bookSpread = mode;
  const oldScroll = root.scrollTop;
  root.scrollTop = 0;

  const bar = doc.createElement("div");
  bar.className = "bk-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", t("readingViews.spread.toolbar"));
  bar.setAttribute("data-sn-own", "");
  const mk = (cls: string, label: string) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    return b;
  };
  const prev = mk("bk-prev", t("readingViews.spread.prev"));
  const next = mk("bk-next", t("readingViews.spread.next"));
  const status = doc.createElement("span");
  status.className = "bk-status";
  status.setAttribute("aria-live", "polite");
  status.dataset.testid = "book-spread-status";
  const select = doc.createElement("select");
  select.setAttribute("aria-label", t("pdf.spread.label"));
  select.dataset.testid = "book-spread-mode";
  for (const [v, k] of [["none", "pdf.spread.none"], ["odd", "pdf.spread.odd"], ["even", "pdf.spread.even"]] as const) {
    const o = doc.createElement("option");
    o.value = v;
    o.textContent = t(k);
    select.append(o);
  }
  select.value = mode;
  const dirBtn = mk("bk-dir", "");
  dirBtn.dataset.testid = "book-spread-dir";
  const close = mk("bk-close", t("readingViews.spread.close"));
  bar.append(prev, status, next, select, dirBtn, close);
  // The bar sits under the pages, in the book's direction: "previous" on the side the earlier pages are.
  root.after(bar);

  const showDir = () => {
    dirBtn.textContent = t(dir === "rtl" ? "pdf.spread.rtl" : "pdf.spread.ltr");
    dirBtn.setAttribute("aria-pressed", String(dir === "rtl"));
    bar.dir = dir;
  };
  showDir();

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => savePlace(id, { on: true, mode, dir, block: flow.firstBlock() }), 150);
  };

  const flow = createSpreadFlow(root, flowEl, {
    mode,
    dir,
    onChange: (f) => {
      const pages = f.pages;
      status.textContent =
        pages.length > 1
          ? t("readingViews.spread.pages", { a: String(pages[0]), b: String(pages[1]), n: String(f.pageTotal) })
          : t("readingViews.spread.page", { a: String(pages[0] ?? 1), n: String(f.pageTotal) });
      root.dataset.spreadIndex = String(f.spread);
      root.dataset.spreadCount = String(f.count);
      prev.disabled = f.spread <= 0;
      next.disabled = f.spread >= f.count - 1;
      save();
    },
  });
  // Where the reader was: the saved place, else what was on screen when the spread opened.
  // Where the reader was: the saved place when the note was left in spreads, or when the scrolling
  // view has not moved since the spread closed; else what was on screen.
  const unmoved = saved.scrollTop !== undefined && Math.abs(saved.scrollTop - oldScroll) <= 2;
  flow.reveal(saved.block !== undefined && (saved.on || unmoved) ? saved.block : scrolledTo);

  const turn = (d: number) => flow.goTo(flow.spread + d);
  prev.addEventListener("click", () => turn(-1));
  next.addEventListener("click", () => turn(1));
  select.addEventListener("change", () => {
    mode = select.value as SpreadMode;
    root.dataset.bookSpread = mode;
    flow.setMode(mode, dir);
  });
  dirBtn.addEventListener("click", () => {
    dir = dir === "rtl" ? "ltr" : "rtl";
    showDir();
    flow.setMode(mode, dir);
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if ((e.target as Element | null)?.closest?.("select, input, textarea")) return;
    const s = spreadForKey(e.key, e.shiftKey, dir, flow.spread, flow.count);
    if (s === null) return;
    e.preventDefault();
    if (s !== flow.spread) flow.goTo(s);
    else announce(t(s === 0 ? "readingViews.spread.first" : "readingViews.spread.last"));
  };
  root.addEventListener("keydown", onKey);
  bar.addEventListener("keydown", onKey);
  let raf = 0;
  const relayout = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      flow.layout();
    });
  };
  const mo = new MutationObserver(relayout);
  mo.observe(flowEl, { childList: true, subtree: true, characterData: true });
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(relayout) : null;
  ro?.observe(root);
  if (!root.hasAttribute("tabindex")) root.tabIndex = -1;
  root.focus({ preventScroll: true });

  let disposed = false;
  const dispose = (keepOn = false) => {
    if (disposed) return;
    disposed = true;
    const keep = flow.firstBlock();
    savePlace(id, { on: keepOn, mode, dir, block: keep });
    clearTimeout(saveTimer);
    if (raf) cancelAnimationFrame(raf);
    mo.disconnect();
    ro?.disconnect();
    root.removeEventListener("keydown", onKey);
    flow.dispose();
    bar.remove();
    delete root.dataset.bookSpread;
    delete root.dataset.spreadIndex;
    delete root.dataset.spreadCount;
    // Back to scrolling at the same block.
    const el = blocksOf(flowEl)[keep];
    if (el) root.scrollTop += el.getBoundingClientRect().top - root.getBoundingClientRect().top;
    else root.scrollTop = oldScroll;
    savePlace(id, { on: keepOn, mode, dir, block: keep, scrollTop: root.scrollTop });
  };
  close.addEventListener("click", () => {
    dispose();
    root.dispatchEvent(new CustomEvent("lumen-book-spread-closed", { bubbles: true }));
  });
  return { flow, dispose };
}
