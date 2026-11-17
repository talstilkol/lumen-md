/**
 * An interval that sleeps while the app is not on screen (plan W13.V4).
 *
 * A phone keeps a backgrounded web app alive for a while, and a 1-second
 * poll there is a battery drain that store reviews notice. A poll made with
 * this helper skips its ticks while `document.hidden` and runs once as soon
 * as the app is visible again, so nothing is missed — it is only late by the
 * time the user was away. Where there is no document (a worker, Node), it is
 * a plain interval.
 *
 * Every `setInterval` in src/ is either this or listed with its reason in
 * src/lib/backgroundTimers.json (src/__tests__/backgroundTimers.test.ts).
 */
export function setVisibleInterval(fn: () => void, ms: number, doc: Document | undefined = typeof document !== "undefined" ? document : undefined): () => void {
  let missed = false;
  const id = setInterval(() => {
    if (doc?.hidden) {
      missed = true;
      return;
    }
    fn();
  }, ms);
  const onVisible = () => {
    if (doc && !doc.hidden && missed) {
      missed = false;
      fn();
    }
  };
  doc?.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(id);
    doc?.removeEventListener("visibilitychange", onVisible);
  };
}
