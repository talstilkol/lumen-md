/**
 * The note view's book pages (plan W13.R6), switched from the palette
 * ("Reading: book pages") and kept per note: a note left in spreads opens
 * in spreads. Tiny on purpose (the preview is in the startup bundle); the
 * spread itself (./noteSpread.ts) loads on first use.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { loadNotePlace } from "./notePlace";

export const BOOK_SPREAD_TOGGLE = "lumen-book-spread-toggle";

/** Was this note left in spreads? Its reading profile says (W13.R1; read without loading the spread code). */
function wasOn(id: string): boolean {
  return loadNotePlace(id).on;
}

/** `ready`: the preview shows this note's rendered text (it changes when a new render lands). */
export function useNoteSpread(rootRef: RefObject<HTMLElement | null>, id: string | null, ready: unknown): void {
  const spread = useRef<{ dispose(keepOn?: boolean): void } | null>(null);
  const opening = useRef(false);
  const open = useCallback(() => {
    const root = rootRef.current;
    if (!root || !id || spread.current || opening.current || !root.querySelector(".prose-lumen")) return;
    opening.current = true;
    void import("./noteSpread")
      .then((m) => {
        if (rootRef.current === root && !spread.current) spread.current = m.attachNoteSpread(root, id);
      })
      .finally(() => {
        opening.current = false;
      });
  }, [rootRef, id]);

  // The palette's switch, and the bar's "back to scrolling".
  useEffect(() => {
    const root = rootRef.current;
    const onToggle = () => {
      if (spread.current) {
        spread.current.dispose();
        spread.current = null;
      } else open();
    };
    const onClosed = () => {
      spread.current = null;
    };
    window.addEventListener(BOOK_SPREAD_TOGGLE, onToggle);
    root?.addEventListener("lumen-book-spread-closed", onClosed);
    return () => {
      window.removeEventListener(BOOK_SPREAD_TOGGLE, onToggle);
      root?.removeEventListener("lumen-book-spread-closed", onClosed);
      // Leaving the note: the spread goes; its place and "on" stay saved for next time.
      spread.current?.dispose(true);
      spread.current = null;
    };
  }, [rootRef, id, open]);

  // A note left in spreads opens in spreads, once its text is rendered.
  useEffect(() => {
    if (id && wasOn(id)) open();
  }, [id, ready, open]);
}
