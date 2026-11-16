/**
 * Plan 7.6 / W10.E36 — the library index's real store: IndexedDB through
 * idb-keyval, in the clear in a plain vault (an encrypted vault seals it with
 * forStore, as the smart-search index is). Runs where IndexedDB exists
 * (Chromium); skipped elsewhere.
 */
import { describe, expect, it } from "vitest";
import { appDeps, LIBRARY_INDEX_KEY, type LibraryIndex } from "../research/library/clipIndex";

// skip-reason: the store is IndexedDB; Node has none, the browser runner (and fake-indexeddb where installed) does | task: W10.E36 | until: 2027-05-16
describe.runIf(typeof indexedDB !== "undefined")("the library index in IndexedDB", () => {
  it("saved and read back as it was, under its own key", async () => {
    const deps = appDeps();
    const index: LibraryIndex = { embedding: "test:x", builtAt: 1, clips: { "Library/a.md": { path: "Library/a.md", title: "א", source: "https://example.org/a", hash: "h", chunks: [{ start: 0, end: 3, preview: "abc", vector: "AACAPw==" }] } } };
    await deps.save(index);
    expect(await deps.load()).toEqual(index);
    const { get } = await import("idb-keyval");
    expect(await get(LIBRARY_INDEX_KEY)).toEqual(index);
    expect(await get("lumen-semantic-index")).toBeUndefined();
  });
});
