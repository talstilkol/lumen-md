import { describe, it, expect } from "vitest";

/**
 * Tests the REAL marketplace backend logic (marketplace-server/registry.mjs),
 * which replaces the old static-registry + localStorage-counter facade.
 * Loaded dynamically so tsc doesn't need a declaration for the cross-package
 * plain-JS module (vite still resolves the literal path at runtime).
 */
async function load(): Promise<Record<string, (...a: unknown[]) => unknown>> {
  return (await import("../../marketplace-server/registry.mjs" as string)) as Record<
    string,
    (...a: unknown[]) => unknown
  >;
}

describe("marketplace registry (real backend logic)", () => {
  it("publishes, lists, and ranks by real download counts", async () => {
    const R = await load();
    const store = R.createStore();
    R.publishItem(store, { id: "a", type: "plugin", name: "Alpha", tags: ["x"] });
    R.publishItem(store, { id: "b", type: "plugin", name: "Beta" });
    R.recordInstall(store, "b");
    R.recordInstall(store, "b");
    const list = R.listItems(store) as Array<{ id: string; downloads: number }>;
    expect(list.map((i) => i.id)).toEqual(["b", "a"]); // b first: 2 downloads
    expect(list[0].downloads).toBe(2);
  });

  it("validates publish input (id, name, type)", async () => {
    const R = await load();
    const store = R.createStore();
    expect(() => R.publishItem(store, { type: "plugin", name: "x" })).toThrow(/id/);
    expect(() => R.publishItem(store, { id: "x", type: "plugin" })).toThrow(/name/);
    expect(() => R.publishItem(store, { id: "x", name: "x", type: "nope" })).toThrow(/type/);
  });

  it("records installs and rejects unknown ids", async () => {
    const R = await load();
    const store = R.createStore();
    R.publishItem(store, { id: "p", type: "theme", name: "P" });
    expect(R.recordInstall(store, "p")).toBe(1);
    expect(() => R.recordInstall(store, "ghost")).toThrow(/unknown/);
  });

  it("averages 1-5 ratings and rejects out-of-range", async () => {
    const R = await load();
    const store = R.createStore();
    R.publishItem(store, { id: "p", type: "plugin", name: "P" });
    R.rateItem(store, "p", 5);
    R.rateItem(store, "p", 3);
    const top = (R.listItems(store) as Array<{ rating: number }>)[0];
    expect(top.rating).toBe(4);
    expect(() => R.rateItem(store, "p", 9)).toThrow(/integer/);
  });

  it("filters by type and free-text query", async () => {
    const R = await load();
    const store = R.createStore();
    R.publishItem(store, { id: "t1", type: "template", name: "Resume", tags: ["cv"] });
    R.publishItem(store, { id: "pl", type: "plugin", name: "Mapper" });
    expect((R.listItems(store, { type: "template" }) as unknown[]).length).toBe(1);
    const found = R.listItems(store, { query: "cv" }) as Array<{ id: string }>;
    expect(found.map((i) => i.id)).toEqual(["t1"]);
  });

  it("persists + restores via dumpStore (file-backing round-trip)", async () => {
    const R = await load();
    const store = R.createStore([{ id: "s", type: "plugin", name: "Seed", downloads: 5 }]);
    const dumped = R.dumpStore(store) as Array<{ id: string }>;
    expect(dumped[0].id).toBe("s");
    const restored = R.createStore(dumped);
    expect((R.listItems(restored) as Array<{ downloads: number }>)[0].downloads).toBe(5);
  });
});
