import { describe, it, expect } from "vitest";
import { deleteStaleRuntimeCaches } from "../lib/runtimeCaches";

describe("deleteStaleRuntimeCaches", () => {
  it("deletes superseded lumen-runtime-* caches only", async () => {
    const names = new Set([
      "lumen-runtime-webr-0.5.9",
      "lumen-runtime-webr-0.6.0",
      "lumen-runtime-ruby-2.10.1",
      "workbox-precache-v2-x",
      "lumen-fonts",
    ]);
    const storage = {
      keys: async () => [...names],
      delete: async (k: string) => names.delete(k),
    };
    const removed = await deleteStaleRuntimeCaches(["lumen-runtime-webr-0.6.0", "lumen-runtime-ruby-2.10.1"], storage);
    expect(removed).toEqual(["lumen-runtime-webr-0.5.9"]);
    expect([...names]).toEqual(["lumen-runtime-webr-0.6.0", "lumen-runtime-ruby-2.10.1", "workbox-precache-v2-x", "lumen-fonts"]);
  });

  it("does nothing without the current list or Cache Storage", async () => {
    expect(await deleteStaleRuntimeCaches([], { keys: async () => ["lumen-runtime-x"], delete: async () => true })).toEqual([]);
    expect(await deleteStaleRuntimeCaches(["a"], undefined)).toEqual([]);
  });
});
