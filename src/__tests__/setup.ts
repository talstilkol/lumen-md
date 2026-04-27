/**
 * Vitest global test setup.
 * Polyfills browser APIs that jsdom doesn't provide.
 */
import "fake-indexeddb/auto";

// jsdom doesn't implement scrollIntoView; CommandPalette uses it for keyboard nav.
if (typeof window !== "undefined" && typeof Element !== "undefined") {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {
      /* test stub */
    };
  }
}

// jsdom's window.localStorage exists but Zustand's persist middleware may
// look up `storage.setItem` as a free function. Wrap it in a minimal in-memory
// shim if it's missing to keep persisted-store tests stable across versions.
if (typeof window !== "undefined") {
  const ls = window.localStorage;
  if (!ls || typeof ls.setItem !== "function") {
    const mem = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, String(v)),
        removeItem: (k: string) => void mem.delete(k),
        clear: () => mem.clear(),
        key: (i: number) => Array.from(mem.keys())[i] ?? null,
        get length() {
          return mem.size;
        },
      },
    });
  }
}
