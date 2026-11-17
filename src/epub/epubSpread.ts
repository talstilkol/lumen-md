/**
 * Two-page spreads in the EPUB reader (plan W13.R6): the chapter flows
 * through CSS columns, a spread at a time (../reading/spreadFlow.ts). The
 * book's direction decides the page order (page 1 on the right in a Hebrew
 * book) and which arrow is "next"; past the last spread of a chapter the
 * next chapter opens at its first spread, and back from the first spread
 * the previous chapter opens at its last.
 *
 * The place in the chapter (its first block on the page) is kept per book
 * with the layout, so reopening the book or switching between scrolling and
 * spreads lands on the same paragraph.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import "../reading/bookSpread.css";
import { loadPlace, savePlace, spreadForKey, type BookDir, type SpreadMode } from "../reading/bookSpread";
import { blocksOf, createSpreadFlow, type SpreadFlow } from "../reading/spreadFlow";

export type EpubLayout = "scroll" | SpreadMode;

export interface EpubSpread {
  layout: EpubLayout;
  setLayout(l: EpubLayout): void;
  /** Pages (1-based) in view and the chapter's page count; null while scrolling. */
  pages: { shown: number[]; total: number } | null;
  /** The spread in view (0-based); null while scrolling. */
  index: number | null;
  /** A key in the reader: true when the spread used it. */
  onKey(key: string, shift: boolean): boolean;
}

const placeId = (path: string) => `epub:${path}`;

/** The first block in view of a scrolling chapter. */
function firstInView(scroller: HTMLElement, content: HTMLElement): number {
  const top = scroller.getBoundingClientRect().top;
  const i = blocksOf(content).findIndex((b) => b.getBoundingClientRect().bottom > top + 1);
  return Math.max(0, i);
}

export function useEpubSpread(opts: {
  path: string;
  dir: BookDir;
  /** The chapter shown, its index, and a key that changes when its HTML was put in (marks included). */
  chapter: number | null;
  renderKey: unknown;
  viewport: RefObject<HTMLElement | null>;
  content: RefObject<HTMLElement | null>;
  /** The scroller of the scrolling view (to keep the place on a switch). */
  scroller: RefObject<HTMLElement | null>;
  goChapter: (step: 1 | -1) => void;
}): EpubSpread {
  const saved = useRef(loadPlace(placeId(opts.path)));
  const [layout, setLayoutState] = useState<EpubLayout>(() => (saved.current.on ? saved.current.mode : "scroll"));
  const flow = useRef<SpreadFlow | null>(null);
  const [pages, setPages] = useState<{ shown: number[]; total: number } | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  /** Where the next chapter opens: its start, or (going back) its end. */
  const edge = useRef<"start" | "end">("start");
  /** The block to show once the chapter is in (a switch of layout, a reopened book). */
  const want = useRef<number | null>(null);
  /** The saved place is used once: for the chapter it was saved in, when that chapter first shows. */
  const restored = useRef(false);

  const persist = useCallback(
    (l: EpubLayout, block: number | undefined) => {
      const mode = l === "scroll" ? loadPlace(placeId(opts.path)).mode : l;
      savePlace(placeId(opts.path), { on: l !== "scroll", mode, dir: opts.dir, block, chapter: opts.chapter ?? undefined });
    },
    [opts.path, opts.dir, opts.chapter],
  );

  // (Re)build the flow when the chapter's HTML is in, the layout or the direction changes.
  useEffect(() => {
    const viewport = opts.viewport.current;
    const content = opts.content.current;
    flow.current?.dispose();
    flow.current = null;
    if (!restored.current && opts.chapter !== null && content?.childNodes.length) {
      restored.current = true;
      if (saved.current.chapter === opts.chapter && saved.current.block !== undefined) want.current = saved.current.block;
    }
    if (layout === "scroll" || !viewport || !content || opts.chapter === null || !content.childNodes.length) {
      setPages(null);
      setIndex(null);
      if (layout === "scroll" && want.current !== null && content) {
        blocksOf(content)[want.current]?.scrollIntoView({ block: "start" });
        want.current = null;
      }
      return;
    }
    const f = createSpreadFlow(viewport, content, {
      mode: layout,
      dir: opts.dir,
      onChange: (x) => {
        setPages({ shown: [...x.pages], total: x.pageTotal });
        setIndex(x.spread);
        persist(layout, x.firstBlock());
      },
    });
    flow.current = f;
    if (want.current !== null) {
      f.reveal(want.current);
      want.current = null;
    } else if (edge.current === "end") f.goTo(f.count - 1);
    edge.current = "start";
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => f.layout()) : null;
    ro?.observe(viewport);
    return () => {
      ro?.disconnect();
    };
  }, [layout, opts.dir, opts.renderKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => flow.current?.dispose(), []);

  const setLayout = useCallback(
    (l: EpubLayout) => {
      // Keep the place: the first block on the page (or in view) is the first after the switch.
      const content = opts.content.current;
      const scroller = opts.scroller.current;
      want.current = flow.current ? flow.current.firstBlock() : content && scroller ? firstInView(scroller, content) : null;
      persist(l, want.current ?? undefined);
      setLayoutState(l);
    },
    [persist, opts.content, opts.scroller],
  );

  const onKey = useCallback(
    (key: string, shift: boolean): boolean => {
      const f = flow.current;
      if (!f) return false;
      const next = spreadForKey(key, shift, opts.dir, f.spread, f.count);
      if (next === null) return false;
      if (next !== f.spread) {
        f.goTo(next);
        return true;
      }
      // At the edge of the chapter: on to the next chapter, or back to the end of the previous one.
      const forward = key === " " ? !shift : key === "PageDown" || key === "End" || key === (opts.dir === "rtl" ? "ArrowLeft" : "ArrowRight");
      if (key === "Home" || key === "End") return true;
      edge.current = forward ? "start" : "end";
      opts.goChapter(forward ? 1 : -1);
      return true;
    },
    [opts],
  );

  return { layout, setLayout, pages, index, onKey };
}
