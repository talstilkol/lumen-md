/**
 * Tests for the provider-agnostic sync engine. We swap in a fake provider so
 * we can exercise the diff/conflict logic without hitting Dropbox.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CloudFile, CloudProvider } from "../sync/cloud/types";
import { syncWithCloud } from "../sync/cloud/sync";

// Stub the workspace adapter — the engine only needs list / read / write.
vi.mock("../storage/workspace", () => {
  const files = new Map<string, { content: string; modified: number }>();
  return {
    listWorkspace: async () => {
      return [...files.entries()].map(([path, v]) => ({
        path,
        name: path.split("/").pop() ?? path,
        size: v.content.length,
        modified: v.modified,
      }));
    },
    readWorkspaceFile: async (p: string) => {
      const f = files.get(p);
      if (!f) throw new Error(`missing ${p}`);
      return f.content;
    },
    writeWorkspaceFile: async (p: string, c: string) => {
      files.set(p, { content: c, modified: Date.now() });
    },
    __setLocalFiles(initial: Record<string, { content: string; modified: number }>) {
      files.clear();
      for (const [k, v] of Object.entries(initial)) files.set(k, v);
    },
    __getLocalFiles() {
      return Object.fromEntries(files.entries());
    },
  };
});

import * as workspaceMock from "../storage/workspace";

function fakeProvider(initial: Record<string, { content: string; modified: number }>): CloudProvider {
  const files = new Map(Object.entries(initial));
  return {
    name: "fake",
    isConnected: () => true,
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    async listFiles(): Promise<CloudFile[]> {
      return [...files.entries()].map(([path, v]) => ({
        path,
        size: v.content.length,
        modified: v.modified,
      }));
    },
    async readFile(p: string) {
      return files.get(p)?.content ?? "";
    },
    async writeFile(p: string, c: string) {
      files.set(p, { content: c, modified: Date.now() });
    },
    async deleteFile(p: string) {
      files.delete(p);
    },
  };
}

describe("syncWithCloud", () => {
  beforeEach(() => {
    (workspaceMock as unknown as {
      __setLocalFiles(initial: Record<string, { content: string; modified: number }>): void;
    }).__setLocalFiles({});
  });

  it("uploads local-only files", async () => {
    (workspaceMock as unknown as {
      __setLocalFiles(initial: Record<string, { content: string; modified: number }>): void;
    }).__setLocalFiles({
      "notes.md": { content: "# hi", modified: Date.now() },
    });
    const provider = fakeProvider({});
    const report = await syncWithCloud(provider);
    expect(report.uploaded).toBe(1);
    expect(report.downloaded).toBe(0);
  });

  it("downloads remote-only files", async () => {
    const provider = fakeProvider({
      "remote.md": { content: "remote-body", modified: Date.now() },
    });
    const report = await syncWithCloud(provider);
    expect(report.downloaded).toBe(1);
    expect(report.uploaded).toBe(0);
  });

  it("picks the newer side on conflict (newer policy)", async () => {
    const old = Date.now() - 60_000;
    const fresh = Date.now();
    (workspaceMock as unknown as {
      __setLocalFiles(initial: Record<string, { content: string; modified: number }>): void;
    }).__setLocalFiles({
      "doc.md": { content: "local-old", modified: old },
    });
    const provider = fakeProvider({
      "doc.md": { content: "remote-new", modified: fresh },
    });
    const report = await syncWithCloud(provider, { conflict: "newer" });
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].resolution).toBe("remote");
    expect(report.downloaded).toBe(1);
  });

  it("respects an ask-resolver that picks duplicate", async () => {
    const ts = Date.now();
    (workspaceMock as unknown as {
      __setLocalFiles(initial: Record<string, { content: string; modified: number }>): void;
    }).__setLocalFiles({
      "doc.md": { content: "local", modified: ts },
    });
    const provider = fakeProvider({
      "doc.md": { content: "remote", modified: ts + 100 },
    });
    const report = await syncWithCloud(provider, {
      conflict: "ask",
      resolve: async () => "duplicate",
    });
    expect(report.conflicts[0].resolution).toBe("duplicate");
    // Both the original (overwrite NOT performed) and a *.conflict-*.md exist.
    const local = (workspaceMock as unknown as { __getLocalFiles(): Record<string, unknown> }).__getLocalFiles();
    const dupFiles = Object.keys(local).filter((p) => p.includes(".conflict-"));
    expect(dupFiles).toHaveLength(1);
  });

  it("reports zero work when sides are identical", async () => {
    const ts = Date.now();
    (workspaceMock as unknown as {
      __setLocalFiles(initial: Record<string, { content: string; modified: number }>): void;
    }).__setLocalFiles({
      "doc.md": { content: "x", modified: ts },
    });
    const provider = fakeProvider({
      "doc.md": { content: "x", modified: ts },
    });
    const report = await syncWithCloud(provider);
    expect(report.uploaded).toBe(0);
    expect(report.downloaded).toBe(0);
    expect(report.conflicts).toHaveLength(0);
  });

  it("reports error when the provider is disconnected", async () => {
    const provider: CloudProvider = {
      ...fakeProvider({}),
      isConnected: () => false,
    };
    const report = await syncWithCloud(provider);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0].error).toMatch(/not connected/i);
  });

  it("picks local on conflict when local is newer (newer policy)", async () => {
    const stale = Date.now() - 60_000;
    const fresh = Date.now();
    (workspaceMock as unknown as {
      __setLocalFiles(i: Record<string, { content: string; modified: number }>): void;
    }).__setLocalFiles({
      "doc.md": { content: "local-newer", modified: fresh },
    });
    const provider = fakeProvider({
      "doc.md": { content: "remote-stale", modified: stale },
    });
    const report = await syncWithCloud(provider, { conflict: "newer" });
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].resolution).toBe("local");
    expect(report.uploaded).toBe(1);
    expect(report.downloaded).toBe(0);
  });

  it("records per-file errors instead of throwing the run", async () => {
    (workspaceMock as unknown as {
      __setLocalFiles(i: Record<string, { content: string; modified: number }>): void;
    }).__setLocalFiles({
      "broken.md": { content: "ok", modified: Date.now() },
      "fine.md": { content: "ok", modified: Date.now() },
    });
    const provider = fakeProvider({});
    // Make `broken.md` writes fail.
    const original = provider.writeFile;
    provider.writeFile = async (p, c) => {
      if (p === "broken.md") throw new Error("boom");
      return original(p, c);
    };
    const report = await syncWithCloud(provider);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].path).toBe("broken.md");
    expect(report.errors[0].error).toMatch(/boom/);
    // Other file still uploaded.
    expect(report.uploaded).toBe(1);
  });

  it("fires onProgress at start, mid, and end", async () => {
    (workspaceMock as unknown as {
      __setLocalFiles(i: Record<string, { content: string; modified: number }>): void;
    }).__setLocalFiles({
      "a.md": { content: "1", modified: Date.now() },
      "b.md": { content: "2", modified: Date.now() },
    });
    const provider = fakeProvider({
      "c.md": { content: "3", modified: Date.now() },
    });
    const ticks: number[] = [];
    await syncWithCloud(provider, {
      onProgress: (frac) => ticks.push(frac),
    });
    expect(ticks[0]).toBe(0); // listing local
    expect(ticks[ticks.length - 1]).toBe(1); // done
    // monotonic non-decreasing
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]).toBeGreaterThanOrEqual(ticks[i - 1]);
    }
  });

  it("returns an empty report when both sides are empty", async () => {
    const provider = fakeProvider({});
    const report = await syncWithCloud(provider);
    expect(report.uploaded).toBe(0);
    expect(report.downloaded).toBe(0);
    expect(report.deleted).toBe(0);
    expect(report.conflicts).toEqual([]);
    expect(report.errors).toEqual([]);
  });
});
