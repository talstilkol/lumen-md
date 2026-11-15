/**
 * W12.R1 — the canvas side of highlight cards: a highlight dropped from the
 * highlights panel becomes a card where it was dropped; clicking a card's
 * link opens the PDF at the highlight (the reader re-anchors it); and when
 * the canvas opens, cards whose highlight was deleted are marked so.
 */
import { useCallback, useEffect, type DragEvent, type RefObject } from "react";
import { t } from "../i18n";
import { HIGHLIGHT_MIME, highlightCard, markSourceDeleted, parseCardLink, type HighlightDrag } from "./highlightCards";

interface Api {
  getSceneElements(): readonly unknown[];
  getAppState(): { scrollX: number; scrollY: number; zoom: { value: number }; offsetLeft?: number; offsetTop?: number };
  updateScene(scene: { elements: readonly unknown[] }): void;
}

/** The highlights of each PDF a card points at (null: its note could not be read, so nothing is marked). */
async function liveHighlights(pdfs: string[]): Promise<Map<string, Set<string>>> {
  const [{ readWorkspaceFile }, { companionNotePath, readAnnotationsNote }] = await Promise.all([import("../storage/workspace"), import("../pdf/annotations")]);
  const out = new Map<string, Set<string>>();
  for (const pdf of pdfs) {
    const md = await readWorkspaceFile(companionNotePath(pdf)).catch(() => null);
    const list = readAnnotationsNote(typeof md === "string" ? md : null);
    if (list) out.set(pdf, new Set(list.map((a) => a.id)));
  }
  return out;
}

export function useHighlightCards(apiRef: RefObject<Api | null>, ready: unknown) {
  const onDrop = useCallback(
    (e: DragEvent) => {
      const raw = e.dataTransfer?.getData(HIGHLIGHT_MIME);
      const api = apiRef.current;
      if (!raw || !api) return;
      let h: HighlightDrag;
      try {
        h = JSON.parse(raw) as HighlightDrag;
      } catch {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const st = api.getAppState();
      const z = st.zoom.value || 1;
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const at = { x: (e.clientX - box.left) / z - st.scrollX, y: (e.clientY - box.top) / z - st.scrollY };
      api.updateScene({ elements: [...api.getSceneElements(), ...highlightCard(h, at, (n) => t("canvas.hl.page", { n }))] });
    },
    [apiRef],
  );

  const onLinkOpen = useCallback((el: { link?: string | null }, ev: { preventDefault(): void }) => {
    const c = parseCardLink(el.link);
    if (!c) return;
    ev.preventDefault();
    window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path: c.path, fragment: c.fragment } }));
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const els = api.getSceneElements() as Parameters<typeof markSourceDeleted>[0];
    const pdfs = [...new Set(els.map((el) => parseCardLink(el.link)?.path).filter((p): p is string => !!p))];
    if (!pdfs.length) return;
    let live = true;
    void liveHighlights(pdfs).then((ids) => {
      if (!live || !apiRef.current) return;
      const r = markSourceDeleted(apiRef.current.getSceneElements() as typeof els, ids, t("canvas.hl.deleted"));
      if (r.changed) apiRef.current.updateScene({ elements: r.elements });
    });
    return () => {
      live = false;
    };
  }, [apiRef, ready]);

  return { onDrop, onLinkOpen };
}
