/**
 * Android's back gesture in the app (plan W13.M1). Android 16 animates a
 * predictive back ("peek" at the home screen) only when the app has no back
 * callback enabled, so the app tells the system, ahead of the gesture,
 * whether back is its own:
 *
 *   - an open dialog, sheet or panel → back closes it (as Escape does: every
 *     overlay in the app closes on Escape), and stays in the app;
 *   - otherwise, a page to go back to in the WebView → back goes there;
 *   - otherwise → the callback is off and the system leaves the app, with
 *     the predictive animation.
 *
 * The native side (MainActivity's OnBackPressedCallback) asks the WebView
 * for its history itself; this module reports only whether an overlay is
 * open (LumenNative.setBackState), and handles the "lumenBack" event the
 * activity sends when back is for an overlay.
 */

/** What counts as an open overlay: the app's dialogs, sheets and side panels on a phone. */
export const OVERLAY_SELECTOR = "dialog[open], [aria-modal='true'], [data-back-closes]:not([hidden])";

export interface BackPlugin {
  setBackState(o: { overlay: boolean }): Promise<void>;
}

/** The overlay back should close: the last one in the document (the top-most open). */
export function topOverlay(doc: Document = document): HTMLElement | null {
  const all = [...doc.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)].filter((el) => el.isConnected && !el.closest("[inert]"));
  return all.at(-1) ?? null;
}

/** Close the top overlay as Escape would; true when there was one. */
export function closeTopOverlay(doc: Document = document): boolean {
  const top = topOverlay(doc);
  if (!top) return false;
  const target = top.contains(doc.activeElement) ? (doc.activeElement as HTMLElement) : top;
  const esc = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
  target.dispatchEvent(esc);
  // A native <dialog> that ignored the key (no handler) still closes, as the platform's back would close it.
  if (top instanceof HTMLDialogElement && top.open && !esc.defaultPrevented) top.close();
  return true;
}

/**
 * Report the overlay state whenever it changes, and close the top overlay on
 * "lumenBack". Returns a stop function.
 */
export function installBackNavigation(plugin: BackPlugin, win: Window = window): () => void {
  const doc = win.document;
  let last: boolean | null = null;
  let queued = false;
  const report = () => {
    queued = false;
    const overlay = topOverlay(doc) !== null;
    if (overlay === last) return;
    last = overlay;
    void plugin.setBackState({ overlay }).catch(() => {
      // why: an older app build without setBackState: back keeps Capacitor's default (the WebView's history)
      last = null;
    });
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    win.requestAnimationFrame?.(report) ?? win.setTimeout(report, 16);
  };
  const mo = new (win as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver(schedule);
  mo.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "aria-modal", "hidden", "data-back-closes", "inert"] });
  const onBack = () => {
    closeTopOverlay(doc);
    schedule();
  };
  win.addEventListener("lumenBack", onBack);
  report();
  return () => {
    mo.disconnect();
    win.removeEventListener("lumenBack", onBack);
  };
}
