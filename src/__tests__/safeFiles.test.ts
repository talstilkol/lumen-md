/**
 * T46 — safe file operations: moves never overwrite silently, keep links
 * working (wiki and Markdown, files and folders), deletes go to the trash
 * and come back.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { installFakeOpfs } from "./helpers/fakeOpfs";
import { listWorkspace, readWorkspaceFile, renameWorkspaceFile, WorkspaceConflictError, workspaceHasEntry, writeWorkspaceFile } from "../storage/workspace";
import { rewriteLinks } from "../storage/linkRewrite";
import { safeMove, trashPaths, undoTrash } from "../storage/fileOps";
import { emptyTrash, listTrash, purgeExpiredTrash, restoreFromTrash, TRASH_KEEP_MS } from "../storage/trash";

beforeEach(() => {
  installFakeOpfs();
});

describe("rename / move", () => {
  it("refuses to replace an existing note", async () => {
    await writeWorkspaceFile("a.md", "A");
    await writeWorkspaceFile("b.md", "B");
    await expect(renameWorkspaceFile("a.md", "b.md")).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(await readWorkspaceFile("b.md")).toBe("B");
    expect(await readWorkspaceFile("a.md")).toBe("A");
  });

  it("moves folders with everything inside", async () => {
    await writeWorkspaceFile("proj/a.md", "A");
    await writeWorkspaceFile("proj/sub/b.md", "B");
    await renameWorkspaceFile("proj", "archive/proj");
    expect(await workspaceHasEntry("proj")).toBe(false);
    expect(await readWorkspaceFile("archive/proj/sub/b.md")).toBe("B");
  });

  it("refuses to move a folder into itself", async () => {
    await writeWorkspaceFile("p/a.md", "A");
    await expect(renameWorkspaceFile("p", "p/inner")).rejects.toThrow(/into itself/);
  });
});

describe("link rewriting", () => {
  it("rewrites wiki links by name, keeping heading and label", () => {
    const md = "See [[Old Name]], [[old name#Intro|the intro]] and [[folder/Old Name]]. Not [[Other]].";
    expect(rewriteLinks(md, "x.md", "folder/Old Name.md", "folder/New.md")).toBe(
      "See [[New]], [[New#Intro|the intro]] and [[folder/New]]. Not [[Other]].",
    );
  });

  it("matches Hebrew names regardless of niqqud", () => {
    expect(rewriteLinks("ראו [[שָׁלוֹם]]", "x.md", "שלום.md", "ברכה.md")).toBe("ראו [[ברכה]]");
  });

  it("rewrites relative Markdown links that point at the old path", () => {
    const md = "[a](../notes/old.md#top) [b](old.md) [c](https://x.org/old.md)";
    expect(rewriteLinks(md, "docs/x.md", "notes/old.md", "notes/sub/new.md")).toBe(
      "[a](../notes/sub/new.md#top) [b](old.md) [c](https://x.org/old.md)",
    );
  });

  it("safeMove updates every linking note and reports them", async () => {
    await writeWorkspaceFile("Target.md", "# T");
    await writeWorkspaceFile("a.md", "→ [[Target]]");
    await writeWorkspaceFile("b.md", "nothing here");
    const r = await safeMove("Target.md", "Renamed.md");
    expect(r?.linksUpdated).toEqual(["a.md"]);
    expect(await readWorkspaceFile("a.md")).toBe("→ [[Renamed]]");
  });

  it("safeMove asks before replacing, and an accepted replace is undoable", async () => {
    await writeWorkspaceFile("a.md", "A");
    await writeWorkspaceFile("b.md", "B");
    const no = vi.fn(async () => false);
    expect(await safeMove("a.md", "b.md", { confirmReplace: no })).toBeNull();
    expect(no).toHaveBeenCalledWith("b.md");
    const r = await safeMove("a.md", "b.md", { confirmReplace: async () => true });
    expect(await readWorkspaceFile("b.md")).toBe("A");
    expect(r?.replaced).toBeTruthy();
    await restoreFromTrash(r!.replaced!.id);
    expect((await listWorkspace()).map((f) => f.path).sort()).toEqual(["b 2.md", "b.md"]);
  });
});

describe("trash", () => {
  it("delete moves to a hidden .trash and Undo restores", async () => {
    await writeWorkspaceFile("notes/keep.md", "K");
    const items = await trashPaths(["notes/keep.md"]);
    expect(await workspaceHasEntry("notes/keep.md")).toBe(false);
    // hidden from the vault listing
    expect((await listWorkspace()).map((f) => f.path)).toEqual([]);
    expect((await listTrash()).map((i) => i.originalPath)).toEqual(["notes/keep.md"]);
    await undoTrash(items);
    expect(await readWorkspaceFile("notes/keep.md")).toBe("K");
    expect(await listTrash()).toEqual([]);
  });

  it("restores next to a note that took the old name", async () => {
    await writeWorkspaceFile("a.md", "old");
    const [item] = await trashPaths(["a.md"]);
    await writeWorkspaceFile("a.md", "new");
    expect(await restoreFromTrash(item.id)).toBe("a 2.md");
    expect(await readWorkspaceFile("a 2.md")).toBe("old");
  });

  it("trashes and restores folders", async () => {
    await writeWorkspaceFile("p/x.md", "X");
    const items = await trashPaths(["p"], { p: "directory" });
    expect(await workspaceHasEntry("p")).toBe(false);
    await undoTrash(items);
    expect(await readWorkspaceFile("p/x.md")).toBe("X");
  });

  it("purges only items older than 30 days; empty removes for good", async () => {
    await writeWorkspaceFile("old.md", "o");
    await writeWorkspaceFile("new.md", "n");
    const { moveToTrash } = await import("../storage/trash");
    const now = Date.now();
    await moveToTrash(["old.md"], {}, now - TRASH_KEEP_MS - 1);
    await moveToTrash(["new.md"], {}, now);
    expect(await purgeExpiredTrash(now)).toBe(1);
    expect((await listTrash()).map((i) => i.originalPath)).toEqual(["new.md"]);
    expect(await emptyTrash()).toBe(1);
    expect(await listTrash()).toEqual([]);
  });
});
