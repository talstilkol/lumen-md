/**
 * `requestIdleCallback` with a `setTimeout` fallback (Safari, jsdom).
 * Returns a cancel function. `timeout` caps how long the browser may
 * postpone the callback, so deferred work still lands on a busy page.
 */
export function scheduleIdle(cb: () => void, timeout = 2000): () => void {
  const w = typeof window !== "undefined" ? window : undefined;
  if (w && typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(() => cb(), { timeout });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = setTimeout(cb, 1);
  return () => clearTimeout(id);
}
