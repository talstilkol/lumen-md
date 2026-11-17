/**
 * The margins reading mode's switch (plan W13.R9) and the hook that turns
 * it on for a preview. The switch is the reading profile's `sidenotes`
 * field (W13.R1: the global profile); a switch saved before that
 * (`lumen.reading.sidenotes`) is moved in on first read. Tiny on purpose:
 * the preview is in the startup bundle, so the field is read and written
 * through ./profileCore.ts, not ./settings.ts (review 13 H2), and the mode
 * (./sidenotes.ts) loads on first use.
 */
import { useEffect, type RefObject } from "react";
import type { LineNote } from "./sidenotes";
import { patchGlobal, readStored } from "./profileCore";

const LEGACY = "lumen.reading.sidenotes";
const EVENT = "lumen-sidenotes-change";

function legacyOn(): boolean {
  try {
    if (localStorage.getItem(LEGACY) === null) return false;
    const on = localStorage.getItem(LEGACY) === "1";
    localStorage.removeItem(LEGACY);
    if (on) patchGlobal({ sidenotes: true });
    return on;
  } catch {
    return false;
  }
}

export function sidenotesOn(): boolean {
  return legacyOn() || readStored().global?.sidenotes === true;
}

export function setSidenotes(on: boolean): void {
  // The profile's write is guarded (blocked storage: the switch still applies until reload).
  patchGlobal({ sidenotes: on });
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
