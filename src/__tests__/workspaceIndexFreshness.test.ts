/**
 * C3 review fixes: the incremental index does not lose a change announced
 * while a full build runs, and writes nobody announced (agent tools, the
 * page-hide flush, sync) still reach it through a periodic mtime check.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import * as ws from "../storage/workspace";
import { notifyWorkspaceChanged } from "../storage/workspaceEvents";
import { __resetWorkspaceIndex, ensureIndex, indexedFiles, REVALIDATE_MS } from "../storage/workspaceIndex";

const text = (path: string) => indexedFiles().find((f) => f.path === path)?.content;

beforeEach(() => {
  installFakeOpfs();
  __resetWorkspaceIndex();
});
afterEach(() => vi.restoreAllMocks());

describe("workspace index freshness", () => {
  it("keeps a change announced while the full build is reading", async () => {
    await ws.writeWorkspaceFile("a.md", "old");
    const real = ws.readWorkspaceFile;
    let once = true;
    vi.spyOn(ws, "readWorkspaceFile").mockImplementation(async (p) => {
      const got = await real(p);
      if (once && p === "a.md") {
        once = false;
        // The build has read "old"; now the note is saved and announced.
        await ws.writeWorkspaceFile("a.md", "new");
        notifyWorkspaceChanged({ kind: "content", paths: ["a.md"] });
      }
      return got;
    });
    await ensureIndex();
    expect(text("a.md")).toBe("old");
    await ensureIndex();
    expect(text("a.md")).toBe("new");
  });

  it("picks up unannounced writes after REVALIDATE_MS, re-reading only changed files", async () => {
    await ws.writeWorkspaceFile("a.md", "A1");
    await ws.writeWorkspaceFile("b.md", "B");
    await ensureIndex();
    const t0 = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(t0 + 1000);
    await ws.writeWorkspaceFile("a.md", "A2"); // e.g. an agent tool: no event
    await ws.writeWorkspaceFile("c.md", "C");
    await ensureIndex();
    expect(text("a.md")).toBe("A1");
    clock.mockReturnValue(t0 + REVALIDATE_MS + 1000);
    const read = vi.spyOn(ws, "readWorkspaceFile");
    await ensureIndex();
    expect(text("a.md")).toBe("A2");
    expect(text("c.md")).toBe("C");
    expect(read.mock.calls.map((c) => c[0]).sort()).toEqual(["a.md", "c.md"]);
  });
});
