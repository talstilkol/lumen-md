/**
 * Where each block of a long note starts (plan W13.R7). A block of an
 * incrementally rendered preview (./incrementalPreview.ts) carries lines
 * relative to itself and its key (`data-sb`); the preview registers here,
 * on its root element, how to turn a key into the block's first line, so
 * scroll sync (src/reading/scrollSync.ts) gets document lines without
 * re-rendering a kept block when the text above it grows or shrinks.
 */
const bases = new WeakMap<Element, () => ReadonlyMap<string, number>>();

export function registerLineBases(root: Element, lookup: () => ReadonlyMap<string, number>): void {
  bases.set(root, lookup);
}

export function unregisterLineBases(root: Element): void {
  bases.delete(root);
}

/** Block key → first line (1-based) of the block, for the preview whose root is `root`. */
export function lineBasesOf(root: Element): ReadonlyMap<string, number> | null {
  return bases.get(root)?.() ?? null;
}
