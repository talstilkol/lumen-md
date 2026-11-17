/**
 * The margins reading mode's switch (plan W13.R9), kept per device, and
 * the hook that turns it on for a preview. Tiny on purpose: the preview is
 * in the startup bundle, the mode (./sidenotes.ts) loads on first use.
 *
 * When W13.R1's ReadingProfile lands, `sidenotes` is one of its fields and
 * this module reads it from there (the per-note profile wins).
 */
import { useEffect, type RefObject } from "react";
import type { LineNote } from "./sidenotes";

const KEY = "lumen.reading.sidenotes";
const EVENT = "lumen-sidenotes-change";

export function sidenotesOn(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setSidenotes(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* why: blocked storage — the switch still applies until reload */
  }
  memo = on;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

let memo: boolean | null = null;
const current = () => (memo ??= sidenotesOn());

/** Collab comments as line-anchored notes, set by whoever has the session (the editor layout). */
let lineNotes: (() => LineNote[]) | null = null;
export function setSidenoteLineNotes(fn: (() => LineNote[]) | null): void {
  lineNotes = fn;
}

/** Turn the margins mode on and off for the preview whose root is `rootRef`. */
export function useSidenotes(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    let detach: (() => void) | null = null;
    let live = true;
    const apply = (on: boolean) => {
      const root = rootRef.current;
      if (!on || !root) {
        detach?.();
        detach = null;
        return;
      }
      if (detach) return;
      void import("./sidenotes").then((m) => {
        if (!live || detach || !current()) return;
        detach = m.attachSidenotes(root, { lineNotes: () => lineNotes?.() ?? [] });
      });
    };
    apply(current());
    const on = (e: Event) => apply((e as CustomEvent<boolean>).detail);
    window.addEventListener(EVENT, on);
    return () => {
      live = false;
      window.removeEventListener(EVENT, on);
      detach?.();
    };
  }, [rootRef]);
}
