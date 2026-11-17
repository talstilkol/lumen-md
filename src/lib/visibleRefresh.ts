/**
 * Live blocks on a budget (plan W12.V6): a ```query block, an embedded
 * `.base` or a chart re-runs when the vault changes — but a dashboard note
 * can hold many of them, and one that is scrolled away (or in a hidden tab)
 * need not work for nobody. `useVisibleRefresh` hands a block a `schedule`
 * function: while the block is on screen a refresh runs at once; while it is
 * off screen the refresh is kept (only the last one), and it runs when the
 * block comes back into view.
 *
 * Without IntersectionObserver (an old WebView, a test DOM) every refresh
 * runs at once, as before.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface VisibleGate {
  /** Run now if visible, else when it next becomes visible. */
  schedule(fn: () => void): void;
  visible(): boolean;
  dispose(): void;
}

/** The gate itself, for one element (the hook below wraps it). */
export function visibleGate(el: Element | null, opts: { rootMargin?: string } = {}): VisibleGate {
  let pending: (() => void) | null = null;
  let isVisible = true;
  let io: IntersectionObserver | null = null;
  if (el && typeof IntersectionObserver !== "undefined") {
    // Until the first callback, assume visible: a block that mounts on screen must not wait.
    io = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        isVisible = e.isIntersecting;
        if (isVisible && pending) {
          const fn = pending;
          pending = null;
          fn();
        }
      },
      { rootMargin: opts.rootMargin ?? "200px 0px" },
    );
    io.observe(el);
  }
  return {
    schedule(fn) {
      if (isVisible) {
        pending = null;
        fn();
      } else pending = fn;
    },
    visible: () => isVisible,
    dispose() {
      io?.disconnect();
      pending = null;
    },
  };
}

/** `[ref, schedule]`: put `ref` on the block's root element and route its refreshes through `schedule`. */
export function useVisibleRefresh(rootMargin?: string): [(el: Element | null) => void, (fn: () => void) => void] {
  const [el, setEl] = useState<Element | null>(null);
  const gate = useRef<VisibleGate | null>(null);
  useEffect(() => {
    const g = visibleGate(el, { rootMargin });
    gate.current = g;
    return () => {
      g.dispose();
      if (gate.current === g) gate.current = null;
    };
  }, [el, rootMargin]);
  const schedule = useCallback((fn: () => void) => {
    if (gate.current) gate.current.schedule(fn);
    else fn();
  }, []);
  return [setEl, schedule];
}
