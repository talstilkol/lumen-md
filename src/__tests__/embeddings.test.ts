import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external deps
vi.mock("idb-keyval", () => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../storage/workspaceIndex", () => ({
  ensureIndex: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../storage/workspace", () => ({
  isOPFSAvailable: vi.fn().mockReturnValue(false), // disabled by default
  listWorkspace: vi.fn().mockResolvedValue([]),
  readWorkspaceFile: vi.fn().mockResolvedValue(""),
  isAssetName: vi.fn().mockReturnValue(false),
}));

describe("getRagStats", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns null when index has never been built", async () => {
    const { getRagStats } = await import("../ai/embeddings");
    const stats = getRagStats();
    expect(stats).toBeNull();
  });
});

describe("buildRagIndex", () => {
  it("returns early when OPFS is not available", async () => {
    const { buildRagIndex } = await import("../ai/embeddings");
    // Should not throw — just returns early
    await expect(buildRagIndex()).resolves.toBeUndefined();
  });
});

describe("semanticSearch", () => {
  it("returns empty array when no docs indexed and OPFS unavailable", async () => {
    const { semanticSearch } = await import("../ai/embeddings");
    const results = await semanticSearch("test query");
    expect(Array.isArray(results)).toBe(true);
    // With 0 docCount, returns []
    expect(results.length).toBe(0);
  });

  it("accepts topK option", async () => {
    const { semanticSearch } = await import("../ai/embeddings");
    const results = await semanticSearch("query", { topK: 3 });
    expect(Array.isArray(results)).toBe(true);
  });

  it("accepts maxContentChars option", async () => {
    const { semanticSearch } = await import("../ai/embeddings");
    const results = await semanticSearch("query", { maxContentChars: 500 });
    expect(Array.isArray(results)).toBe(true);
  });
});

describe("RagResult interface", () => {
  it("module exports the expected public API", async () => {
    const mod = await import("../ai/embeddings");
    expect(typeof mod.buildRagIndex).toBe("function");
    expect(typeof mod.semanticSearch).toBe("function");
    expect(typeof mod.getRagStats).toBe("function");
  });
});
